// Browser-side PDF importer: text extraction + per-page image rendering +
// optional OCR via tesseract.js. Produces the same shape of content.json
// and content.txt as the Python pdf_to_json.py script.
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

export type PageResult = {
  page: number;
  text: string;
  textSource: "pdf" | "ocr";
  images: string[]; // filenames relative to images/
};

export type ImportResult = {
  source: string;
  pageCount: number;
  imageCount: number;
  pages: PageResult[];
  // Per-page rendered JPEGs, keyed by filename ("p001.jpg" etc.).
  images: Map<string, Blob>;
};

export type Progress = {
  phase: "loading" | "extracting" | "ocring" | "done";
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
  onProgress?: (p: Progress) => void;
};

export async function importPdf(file: File, opts: Options): Promise<ImportResult> {
  const { ocrMode, includeImages, imageQuality, imageMaxDim, ocrDpi, onProgress } = opts;
  onProgress?.({ phase: "loading", message: "Reading PDF…" });
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: buffer });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  const pages: PageResult[] = [];
  const images = new Map<string, Blob>();
  let imageCount = 0;

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

      // --- Page render (for image output and/or OCR) ------------------
      // Compute a scale that respects imageMaxDim. pdf.js viewport at
      // scale=1 is "PDF points" (72 dpi). We want either OCR DPI or a
      // user-capped pixel size.
      const baseViewport = page.getViewport({ scale: 1 });
      const ocrScale = ocrDpi / 72;
      const longSide = Math.max(baseViewport.width, baseViewport.height);
      const imageScale = Math.min(imageMaxDim / longSide, ocrScale);
      const scale = needsOcr ? ocrScale : (includeImages ? imageScale : 0);

      let canvas: HTMLCanvasElement | null = null;
      if (scale > 0) {
        const viewport = page.getViewport({ scale });
        canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
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

      // --- Image output (one image per page) --------------------------
      const imageFiles: string[] = [];
      if (includeImages && canvas) {
        const fname = `p${String(pi).padStart(3, "0")}.jpg`;
        const blob = await canvasToJpegBlob(canvas, imageQuality);
        images.set(fname, blob);
        imageFiles.push(`images/${fname}`);
        imageCount++;
      }

      pages.push({ page: pi, text, textSource, images: imageFiles });

      // Free the canvas eagerly — large PDFs can otherwise pin a lot of
      // memory across iterations.
      canvas = null;
    }
  } finally {
    if (ws.value) await ws.value.terminate();
    await loadingTask.destroy();
  }

  onProgress?.({ phase: "done", totalPages });
  return { source: file.name, pageCount: totalPages, imageCount, pages, images };
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
  const { images: _omit, ...rest } = result;
  void _omit;
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
