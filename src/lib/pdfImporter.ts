// Browser-side PDF importer: text extraction + per-page image rendering +
// optional OCR via tesseract.js + optional per-card cropping. Produces the
// same shape of content.json and content.txt as the Python pdf_to_json.py
// script, plus a cards/ folder with one image per detected card.
//
// Heavy deps (pdfjs-dist, tesseract.js, jszip) are only loaded when this
// module is loaded — the parent component should React.lazy() the panel
// so the main app bundle stays small.

import * as pdfjsLib from "pdfjs-dist";
// Vite resolves this to a hashed URL at build time so the worker is
// served alongside the rest of the app.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import JSZip from "jszip";
import Tesseract from "tesseract.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type OcrMode = "auto" | "force" | "off";

// Pages with this many text-layer chars or fewer trigger the OCR fallback
// when ocrMode is "auto". Matches the Python script's threshold.
const OCR_MIN_TEXT_CHARS = 10;

export type CardCutMode = "off" | "grid" | "auto";

export type CardCutOptions = {
  mode: CardCutMode;
  /** Grid rows/cols when mode === "grid"; ignored otherwise. */
  rows: number;
  cols: number;
  /** Outer margin to trim from the page edges before slicing the grid,
   * expressed as a fraction of the page's short side (0..0.2). */
  marginFrac: number;
  /** Gutter between cards, same units as marginFrac. */
  gutterFrac: number;
  /** Brightness threshold (0..255) for auto-detect: a row/column whose
   * mean luminance is above this counts as a gutter. Default 240. */
  autoThreshold: number;
  /** Minimum card size in pixels (auto-detect rejects regions smaller
   * than this; prevents detecting page numbers as cards). */
  autoMinSizePx: number;
};

export const DEFAULT_CARD_CUT: CardCutOptions = {
  mode: "off",
  rows: 3,
  cols: 3,
  marginFrac: 0.04,
  gutterFrac: 0.02,
  autoThreshold: 240,
  autoMinSizePx: 120,
};

export type CardCutRect = {
  /** Pixel coords within the page's rendered canvas. */
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Card = {
  page: number;
  index: number; // 1-based within the page
  filename: string; // relative to cards/
  rect: CardCutRect;
};

export type PageResult = {
  page: number;
  text: string;
  textSource: "pdf" | "ocr";
  images: string[]; // filenames relative to images/
  cards: string[]; // filenames relative to cards/
  /** Rendered page width/height in canvas pixels — lets the preview
   * overlay the cut rectangles on the page image at the right scale. */
  width: number;
  height: number;
};

export type ImportResult = {
  source: string;
  pageCount: number;
  imageCount: number;
  cardCount: number;
  pages: PageResult[];
  // Per-page rendered JPEGs, keyed by filename ("p001.jpg" etc.).
  images: Map<string, Blob>;
  // Per-card rendered JPEGs, keyed by filename ("p001_c01.jpg" etc.).
  cards: Map<string, Blob>;
  // Manifest of every card across the document.
  cardManifest: Card[];
};

export type Progress = {
  phase: "loading" | "extracting" | "ocring" | "cutting" | "done";
  page?: number;
  totalPages?: number;
  message?: string;
};

// Minimal duck type for the Tesseract worker — see comment in importPdf.
type TWorker = {
  recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};

type Options = {
  ocrMode: OcrMode;
  includeImages: boolean;
  imageQuality: number;   // 0..1 for JPEG
  imageMaxDim: number;    // px cap on long side of the page render
  ocrDpi: number;         // render DPI for OCR pass
  cardCut: CardCutOptions;
  onProgress?: (p: Progress) => void;
};

export async function importPdf(file: File, opts: Options): Promise<ImportResult> {
  const { ocrMode, includeImages, imageQuality, imageMaxDim, ocrDpi, cardCut, onProgress } = opts;
  onProgress?.({ phase: "loading", message: "Reading PDF…" });
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: buffer });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  const pages: PageResult[] = [];
  const images = new Map<string, Blob>();
  const cardBlobs = new Map<string, Blob>();
  const cardManifest: Card[] = [];
  let imageCount = 0;
  let cardCount = 0;

  // One reusable Tesseract worker — much cheaper than spinning one up
  // per page. Holder object so the inner getTesseract() closure can
  // mutate w.value without TypeScript widening the variable type to
  // `never` on the finally-block reference.
  const ws: { value: TWorker | null } = { value: null };
  async function getTesseract(): Promise<TWorker> {
    if (ws.value) return ws.value;
    onProgress?.({ phase: "ocring", message: "Loading OCR engine (one-time, ~10 MB)…" });
    ws.value = (await Tesseract.createWorker("eng")) as unknown as TWorker;
    return ws.value;
  }

  try {
    for (let pi = 1; pi <= totalPages; pi++) {
      onProgress?.({ phase: "extracting", page: pi, totalPages, message: `Reading page ${pi} of ${totalPages}` });
      const page = await pdf.getPage(pi);

      // --- Text layer extraction --------------------------------------
      const textContent = await page.getTextContent();
      let text = textContent.items
        .map((it) => ("str" in it ? it.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      let textSource: "pdf" | "ocr" = "pdf";

      const needsOcr =
        ocrMode === "force" || (ocrMode === "auto" && text.length < OCR_MIN_TEXT_CHARS);
      const needsCanvas = needsOcr || includeImages || cardCut.mode !== "off";

      // --- Page render (for image output, OCR, or card cutting) -------
      // pdf.js viewport at scale=1 is "PDF points" (72 dpi). We want
      // either OCR DPI or a user-capped pixel size.
      const baseViewport = page.getViewport({ scale: 1 });
      const ocrScale = ocrDpi / 72;
      const longSide = Math.max(baseViewport.width, baseViewport.height);
      const imageScale = Math.min(imageMaxDim / longSide, ocrScale);
      const scale = needsCanvas ? Math.max(needsOcr ? ocrScale : 0, imageScale) : 0;

      let canvas: HTMLCanvasElement | null = null;
      let pageW = 0, pageH = 0;
      if (scale > 0) {
        const viewport = page.getViewport({ scale });
        canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        pageW = canvas.width;
        pageH = canvas.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Could not get 2D canvas context");
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      }

      // --- OCR fallback -----------------------------------------------
      if (needsOcr && canvas) {
        const tess = await getTesseract();
        onProgress?.({ phase: "ocring", page: pi, totalPages, message: `OCR’ing page ${pi}…` });
        const recog = await tess.recognize(canvas);
        const ocrText = recog.data.text.trim();
        if (ocrText) {
          text = ocrText;
          textSource = "ocr";
        }
      }

      // --- Image output (whole page) ----------------------------------
      const imageFiles: string[] = [];
      if (includeImages && canvas) {
        const fname = `p${String(pi).padStart(3, "0")}.jpg`;
        const blob = await canvasToJpegBlob(canvas, imageQuality);
        images.set(fname, blob);
        imageFiles.push(`images/${fname}`);
        imageCount++;
      }

      // --- Card cutting -----------------------------------------------
      const cardFiles: string[] = [];
      if (cardCut.mode !== "off" && canvas) {
        onProgress?.({ phase: "cutting", page: pi, totalPages, message: `Cutting cards from page ${pi}…` });
        const rects = computeCardRects(canvas, cardCut);
        for (let ci = 0; ci < rects.length; ci++) {
          const rect = rects[ci]!;
          const cardCanvas = cropToCanvas(canvas, rect);
          const fname = `p${String(pi).padStart(3, "0")}_c${String(ci + 1).padStart(2, "0")}.jpg`;
          const blob = await canvasToJpegBlob(cardCanvas, imageQuality);
          cardBlobs.set(fname, blob);
          cardFiles.push(`cards/${fname}`);
          cardManifest.push({ page: pi, index: ci + 1, filename: fname, rect });
          cardCount++;
        }
      }

      pages.push({
        page: pi, text, textSource,
        images: imageFiles, cards: cardFiles,
        width: pageW, height: pageH,
      });

      // Free the canvas eagerly — large PDFs can otherwise pin a lot of
      // memory across iterations.
      canvas = null;
    }
  } finally {
    if (ws.value) await ws.value.terminate();
    await loadingTask.destroy();
  }

  onProgress?.({ phase: "done", totalPages });
  return {
    source: file.name, pageCount: totalPages,
    imageCount, cardCount,
    pages, images, cards: cardBlobs, cardManifest,
  };
}

// --- Card-cut geometry ----------------------------------------------------

/** Compute the bounding boxes (in canvas pixels) for every card on a page.
 * Returned in reading order: rows top-to-bottom, columns left-to-right. */
export function computeCardRects(
  canvas: HTMLCanvasElement,
  opts: CardCutOptions,
): CardCutRect[] {
  if (opts.mode === "grid") return gridRects(canvas.width, canvas.height, opts);
  if (opts.mode === "auto") {
    const auto = autoDetectRects(canvas, opts);
    // If auto fails (no gutters found), fall back to the configured grid
    // so the user always gets *something* sensible.
    return auto.length > 0 ? auto : gridRects(canvas.width, canvas.height, opts);
  }
  return [];
}

function gridRects(W: number, H: number, opts: CardCutOptions): CardCutRect[] {
  const margin = Math.min(W, H) * opts.marginFrac;
  const gutter = Math.min(W, H) * opts.gutterFrac;
  const innerW = W - 2 * margin;
  const innerH = H - 2 * margin;
  const cardW = (innerW - gutter * (opts.cols - 1)) / opts.cols;
  const cardH = (innerH - gutter * (opts.rows - 1)) / opts.rows;
  const out: CardCutRect[] = [];
  for (let r = 0; r < opts.rows; r++) {
    for (let c = 0; c < opts.cols; c++) {
      out.push({
        x: Math.round(margin + c * (cardW + gutter)),
        y: Math.round(margin + r * (cardH + gutter)),
        w: Math.round(cardW),
        h: Math.round(cardH),
      });
    }
  }
  return out;
}

/** Find row/column bands by scanning for high-brightness gutter strips,
 * then return the cross product as card rectangles. */
function autoDetectRects(canvas: HTMLCanvasElement, opts: CardCutOptions): CardCutRect[] {
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  const W = canvas.width, H = canvas.height;
  const data = ctx.getImageData(0, 0, W, H).data;

  // Sub-sample each row to a single mean-brightness scalar, then mark
  // rows whose mean > threshold as "white". A run of >= minGutterPx
  // white rows is a horizontal gutter. The strips between are card rows.
  const minGutterPx = Math.round(Math.min(W, H) * 0.005); // 0.5% of short side
  const minCardPx = opts.autoMinSizePx;
  const thr = opts.autoThreshold;

  const rowBrightness = sampleRowBrightness(data, W, H);
  const colBrightness = sampleColBrightness(data, W, H);

  const cardRows = bandsBetweenGutters(rowBrightness, thr, minGutterPx, minCardPx);
  const cardCols = bandsBetweenGutters(colBrightness, thr, minGutterPx, minCardPx);

  if (cardRows.length === 0 || cardCols.length === 0) return [];

  const out: CardCutRect[] = [];
  for (const row of cardRows) {
    for (const col of cardCols) {
      out.push({
        x: col.start,
        y: row.start,
        w: col.end - col.start,
        h: row.end - row.start,
      });
    }
  }
  return out;
}

function sampleRowBrightness(data: Uint8ClampedArray, W: number, H: number): Float32Array {
  // Step horizontally to keep this fast on big pages; one sample every
  // 8 pixels is plenty for finding wide gutter bands.
  const step = 8;
  const out = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    let sum = 0, n = 0;
    const rowStart = y * W * 4;
    for (let x = 0; x < W; x += step) {
      const i = rowStart + x * 4;
      // Rec. 601 luminance; good enough for white-gutter detection.
      sum += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      n++;
    }
    out[y] = sum / n;
  }
  return out;
}

function sampleColBrightness(data: Uint8ClampedArray, W: number, H: number): Float32Array {
  const step = 8;
  const out = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    let sum = 0, n = 0;
    for (let y = 0; y < H; y += step) {
      const i = (y * W + x) * 4;
      sum += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      n++;
    }
    out[x] = sum / n;
  }
  return out;
}

type Band = { start: number; end: number };

/** Given a brightness profile, find the bands BETWEEN high-brightness
 * gutter runs. Filters out bands shorter than minCardPx. */
function bandsBetweenGutters(
  profile: Float32Array,
  threshold: number,
  minGutterPx: number,
  minCardPx: number,
): Band[] {
  const N = profile.length;
  // Step 1: collect gutter ranges (contiguous runs above threshold).
  const gutters: Band[] = [];
  let gStart = -1;
  for (let i = 0; i <= N; i++) {
    const isGutter = i < N && profile[i]! > threshold;
    if (isGutter) {
      if (gStart === -1) gStart = i;
    } else if (gStart !== -1) {
      if (i - gStart >= minGutterPx) gutters.push({ start: gStart, end: i });
      gStart = -1;
    }
  }

  // Step 2: card bands sit BETWEEN consecutive gutters. We also treat
  // the page edge as an implicit gutter (otherwise a card flush against
  // the edge would be excluded).
  const bounds: Band[] = [{ start: 0, end: 0 }, ...gutters, { start: N, end: N }];
  const bands: Band[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i]!.end;
    const b = bounds[i + 1]!.start;
    if (b - a >= minCardPx) bands.push({ start: a, end: b });
  }
  return bands;
}

function cropToCanvas(source: HTMLCanvasElement, rect: CardCutRect): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = rect.w;
  out.height = rect.h;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context");
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  return out;
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))),
      "image/jpeg",
      quality,
    );
  });
}

// --- Output formatters ----------------------------------------------------

export function toJsonString(result: ImportResult): string {
  // Strip the in-memory Blobs from the JSON; only the manifest goes in.
  const { images: _images, cards: _cards, ...rest } = result;
  void _images;
  void _cards;
  return JSON.stringify(rest, null, 2);
}

export function toPlainText(result: ImportResult): string {
  const lines: string[] = [`# ${result.source}`, ""];
  for (const p of result.pages) {
    const tag = p.textSource === "ocr" ? " (OCR)" : "";
    lines.push(`=== Page ${p.page}${tag} ===`);
    if (p.text) lines.push(p.text);
    lines.push("");
  }
  return lines.join("\n");
}

export async function toZipBlob(result: ImportResult): Promise<Blob> {
  const zip = new JSZip();
  zip.file("content.json", toJsonString(result));
  zip.file("content.txt", toPlainText(result));
  if (result.images.size > 0) {
    const folder = zip.folder("images");
    if (folder) {
      for (const [name, blob] of result.images) folder.file(name, blob);
    }
  }
  if (result.cards.size > 0) {
    const folder = zip.folder("cards");
    if (folder) {
      for (const [name, blob] of result.cards) folder.file(name, blob);
    }
  }
  return zip.generateAsync({ type: "blob" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revocation a tick so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, filename: string, mime: string): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}
