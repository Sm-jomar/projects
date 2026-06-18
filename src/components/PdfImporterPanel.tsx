import { useEffect, useMemo, useRef, useState } from "react";
import {
  importPdf, toJsonString, toPlainText, toZipBlob, toRulebookBundle,
  downloadBlob, downloadText, slugFromFilename,
  DEFAULT_CARD_CUT,
  type ImportResult, type OcrMode, type Progress,
  type CardCutOptions, type CardCutMode, type RulebookManifestEntry,
} from "../lib/pdfImporter";
import rulebookManifest from "../data/rulebook-manifest.json";

type Props = { onClose: () => void };

const EXISTING_RULEBOOKS = rulebookManifest as RulebookManifestEntry[];

export function PdfImporterPanel({ onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [ocrMode, setOcrMode] = useState<OcrMode>("auto");
  const [includeImages, setIncludeImages] = useState(true);
  const [imageQuality, setImageQuality] = useState(0.8);
  const [imageMaxDim, setImageMaxDim] = useState(1400);
  const [ocrDpi, setOcrDpi] = useState(200);
  const [cardCut, setCardCut] = useState<CardCutOptions>({ ...DEFAULT_CARD_CUT });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewIdx, setPreviewIdx] = useState(0);

  // Save-as-rulebook flow. Slug pre-fills from the chosen filename; the
  // user can edit it before downloading the bundle. archivePrevious is
  // forced on if the typed slug matches an existing entry.
  const [rulebookSlug, setRulebookSlug] = useState("");
  const [rulebookTitle, setRulebookTitle] = useState("");
  const [archivePrevious, setArchivePrevious] = useState(true);
  const slugCollision = useMemo(
    () => EXISTING_RULEBOOKS.some((b) => b.slug === rulebookSlug && !b.archived),
    [rulebookSlug],
  );

  function chooseFile() { fileRef.current?.click(); }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setResult(null);
      setError(null);
      setProgress(null);
      // Pre-fill the rulebook fields from the filename so the user only
      // has to tweak rather than retype.
      const slug = slugFromFilename(f.name);
      setRulebookSlug(slug);
      setRulebookTitle(humanizeSlug(slug));
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && f.name.toLowerCase().endsWith(".pdf")) {
      setFile(f);
      setResult(null);
      setError(null);
      setProgress(null);
      const slug = slugFromFilename(f.name);
      setRulebookSlug(slug);
      setRulebookTitle(humanizeSlug(slug));
    } else if (f) {
      setError(`"${f.name}" doesn't look like a PDF.`);
    }
  }

  async function downloadRulebookBundle() {
    if (!result || !file || !rulebookSlug.trim() || !rulebookTitle.trim()) return;
    const zip = await toRulebookBundle(
      result, file,
      {
        slug: rulebookSlug.trim(),
        title: rulebookTitle.trim(),
        archivePrevious,
      },
      EXISTING_RULEBOOKS,
    );
    downloadBlob(zip, `${rulebookSlug.trim()}-rulebook-bundle.zip`);
  }

  async function run() {
    if (!file || running) return;
    setRunning(true);
    setResult(null);
    setError(null);
    setProgress({ phase: "loading", message: "Starting…" });
    try {
      const r = await importPdf(file, {
        ocrMode, includeImages, imageQuality, imageMaxDim, ocrDpi, cardCut,
        onProgress: setProgress,
      });
      setResult(r);
      setPreviewIdx(0);
    } catch (err) {
      setError((err as Error).message || String(err));
    } finally {
      setRunning(false);
    }
  }

  function downloadTxt() {
    if (!result) return;
    downloadText(toPlainText(result), baseName(result.source) + ".txt", "text/plain");
  }
  function downloadJson() {
    if (!result) return;
    downloadText(toJsonString(result), baseName(result.source) + ".json", "application/json");
  }
  async function downloadZip() {
    if (!result) return;
    const zip = await toZipBlob(result);
    downloadBlob(zip, baseName(result.source) + ".zip");
  }

  const ocrPages = result?.pages.filter((p) => p.textSource === "ocr").length ?? 0;
  const previewPage = result?.pages[previewIdx];

  // Page image URL, regenerated when the previewed page changes. Revoked
  // on unmount/swap so we don't leak blob URLs.
  const previewImageUrl = useObjectUrl(
    previewPage && result
      ? (() => {
          const imgName = previewPage.images[0]?.replace(/^images\//, "");
          return imgName ? result.images.get(imgName) ?? null : null;
        })()
      : null,
  );

  // Per-card preview URLs — built once per page so the carousel doesn't
  // recreate them on each render.
  const previewCards = useMemo(() => {
    if (!previewPage || !result) return [];
    return previewPage.cards
      .map((path) => {
        const name = path.replace(/^cards\//, "");
        const blob = result.cards.get(name);
        return blob ? { name, url: URL.createObjectURL(blob) } : null;
      })
      .filter(Boolean) as Array<{ name: string; url: string }>;
  }, [previewPage, result]);

  // Free those card URLs when leaving this page.
  useEffect(() => {
    return () => {
      for (const c of previewCards) URL.revokeObjectURL(c.url);
    };
  }, [previewCards]);

  // Cards-on-page rectangles overlaid on the preview image (in canvas pixels).
  const previewRects = useMemo(() => {
    if (!previewPage || !result) return [];
    return result.cardManifest
      .filter((c) => c.page === previewPage.page)
      .map((c) => c.rect);
  }, [previewPage, result]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="pdf-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>PDF Importer</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </header>

        <div className="pdf-body">
          <aside className="pdf-controls">
            <section>
              <h3>PDF</h3>
              <div className="pdf-dropzone"
                   onDragOver={(e) => e.preventDefault()}
                   onDrop={onDrop}
                   onClick={chooseFile}>
                {file ? (
                  <>
                    <strong>{file.name}</strong>
                    <span className="muted small">{(file.size / 1024 / 1024).toFixed(1)} MB · click to change</span>
                  </>
                ) : (
                  <>
                    <strong>Drop a PDF here</strong>
                    <span className="muted small">or click to choose a file</span>
                  </>
                )}
              </div>
              <input ref={fileRef} type="file" accept=".pdf,application/pdf" hidden onChange={onFile} />
            </section>

            <section>
              <h3>Text extraction</h3>
              <div className="pdf-opt-pills">
                {(["auto", "force", "off"] as OcrMode[]).map((m) => (
                  <button key={m}
                          className={"pdf-pill" + (ocrMode === m ? " active" : "")}
                          onClick={() => setOcrMode(m)}>
                    {m === "auto" ? "Auto OCR" : m === "force" ? "Force OCR" : "No OCR"}
                  </button>
                ))}
              </div>
              <p className="muted small">
                <b>Auto</b> reads the PDF's text layer, then OCRs pages with none.
                <b> Force</b> OCRs every page (slower, more accurate when text layers are garbled).
                <b> Off</b> skips OCR entirely.
              </p>
            </section>

            <section>
              <h3>Cut individual cards</h3>
              <div className="pdf-opt-pills">
                {(["off", "grid", "auto"] as CardCutMode[]).map((m) => (
                  <button key={m}
                          className={"pdf-pill" + (cardCut.mode === m ? " active" : "")}
                          onClick={() => setCardCut({ ...cardCut, mode: m })}>
                    {m === "off" ? "Off" : m === "grid" ? "Grid" : "Auto-detect"}
                  </button>
                ))}
              </div>
              {cardCut.mode === "grid" && (
                <>
                  <div className="pdf-num-row">
                    <label>Rows
                      <input type="number" min={1} max={10} value={cardCut.rows}
                             onChange={(e) => setCardCut({ ...cardCut, rows: Math.max(1, Number(e.target.value) || 1) })} />
                    </label>
                    <label>Cols
                      <input type="number" min={1} max={10} value={cardCut.cols}
                             onChange={(e) => setCardCut({ ...cardCut, cols: Math.max(1, Number(e.target.value) || 1) })} />
                    </label>
                  </div>
                  <div className="pdf-num-row">
                    <label>Margin
                      <input type="number" min={0} max={0.2} step={0.005} value={cardCut.marginFrac}
                             onChange={(e) => setCardCut({ ...cardCut, marginFrac: Number(e.target.value) || 0 })} />
                    </label>
                    <label>Gutter
                      <input type="number" min={0} max={0.1} step={0.005} value={cardCut.gutterFrac}
                             onChange={(e) => setCardCut({ ...cardCut, gutterFrac: Number(e.target.value) || 0 })} />
                    </label>
                  </div>
                  <p className="muted small">
                    Margin and gutter are fractions of the short page side. Defaults work for
                    3×3 unit-card sheets — bump margin to 0.06 if the outer cards get clipped.
                  </p>
                </>
              )}
              {cardCut.mode === "auto" && (
                <>
                  <div className="pdf-num-row">
                    <label>Threshold
                      <input type="number" min={150} max={255} step={5} value={cardCut.autoThreshold}
                             onChange={(e) => setCardCut({ ...cardCut, autoThreshold: Number(e.target.value) || 240 })} />
                    </label>
                    <label>Min card px
                      <input type="number" min={40} max={500} step={10} value={cardCut.autoMinSizePx}
                             onChange={(e) => setCardCut({ ...cardCut, autoMinSizePx: Number(e.target.value) || 120 })} />
                    </label>
                  </div>
                  <p className="muted small">
                    Looks for near-white gutter bands. Lower the threshold for cream/tan
                    backgrounds. If it can't find any, the importer falls back to the Grid
                    settings.
                  </p>
                </>
              )}
            </section>

            <section>
              <h3>Page images</h3>
              <label className="pdf-toggle">
                <input type="checkbox" checked={includeImages} onChange={(e) => setIncludeImages(e.target.checked)} />
                Render each page as a JPEG (in addition to any card cuts)
              </label>
              {includeImages && (
                <div className="pdf-num-row">
                  <label>Max dim
                    <input type="number" min={400} max={4000} step={100} value={imageMaxDim}
                           onChange={(e) => setImageMaxDim(Number(e.target.value) || 1400)} />
                  </label>
                  <label>Quality
                    <input type="number" min={0.3} max={1} step={0.05} value={imageQuality}
                           onChange={(e) => setImageQuality(Number(e.target.value) || 0.8)} />
                  </label>
                </div>
              )}
            </section>

            <section>
              <h3>OCR</h3>
              <label>DPI
                <input type="number" min={100} max={400} step={50} value={ocrDpi}
                       onChange={(e) => setOcrDpi(Number(e.target.value) || 200)} />
              </label>
              <p className="muted small">200 is the sweet spot. Raise for tiny fonts.</p>
            </section>

            <button className="pdf-run-btn" disabled={!file || running} onClick={run}>
              {running ? "Working…" : "Convert"}
            </button>

            {error && <div className="pdf-error">⚠ {error}</div>}

            {progress && !error && (
              <div className="pdf-progress">
                <div className="pdf-progress-msg">{progress.message ?? progress.phase}</div>
                {progress.totalPages && progress.page && (
                  <div className="pdf-progress-bar">
                    <div className="pdf-progress-fill"
                         style={{ width: `${(progress.page / progress.totalPages) * 100}%` }} />
                  </div>
                )}
                {progress.phase === "ocring" && (
                  <p className="muted small">OCR runs in your browser via WebAssembly. Expect roughly 10–30 sec per page.</p>
                )}
              </div>
            )}

            {result && (
              <section className="pdf-result-actions">
                <h3>Downloads</h3>
                <div className="pdf-result-summary muted small">
                  {result.pageCount} page{result.pageCount === 1 ? "" : "s"} ·
                  {" "}{result.imageCount} image{result.imageCount === 1 ? "" : "s"} ·
                  {" "}{result.cardCount} card{result.cardCount === 1 ? "" : "s"}
                  {ocrPages > 0 && <> · {ocrPages} OCR'd</>}
                </div>
                <div className="pdf-download-row">
                  <button onClick={downloadTxt}>.txt</button>
                  <button onClick={downloadJson}>.json</button>
                  <button onClick={downloadZip}>.zip (everything)</button>
                </div>
              </section>
            )}

            {result && file && (
              <section className="pdf-result-actions">
                <h3>Save as rulebook to repo</h3>
                <p className="muted small">
                  Produces a ZIP whose layout mirrors the repository: drop the
                  contents at the repo root and commit. The original PDF lands
                  at <code>pdfs/&lt;slug&gt;/source.pdf</code>, the page images
                  under <code>public/rulebooks/&lt;slug&gt;/</code>, and
                  <code> src/data/rulebook-manifest.json </code> is updated
                  so it appears in Reference → Rulebooks.
                </p>
                <div className="pdf-rulebook-fields">
                  <label>Slug
                    <input type="text" value={rulebookSlug}
                           onChange={(e) => setRulebookSlug(slugFromFilename(e.target.value))}
                           placeholder="battle-forces" />
                  </label>
                  <label>Title
                    <input type="text" value={rulebookTitle}
                           onChange={(e) => setRulebookTitle(e.target.value)}
                           placeholder="Battle Forces (Q3 2026)" />
                  </label>
                  {slugCollision && (
                    <div className="pdf-rulebook-warn">
                      A rulebook with slug "{rulebookSlug}" already exists.
                      <label className="pdf-toggle" style={{ marginTop: 4 }}>
                        <input type="checkbox" checked={archivePrevious}
                               onChange={(e) => setArchivePrevious(e.target.checked)} />
                        Archive the existing one (recommended) — uncheck to add this as a -v2 instead.
                      </label>
                    </div>
                  )}
                  <button className="pdf-run-btn" onClick={downloadRulebookBundle}
                          disabled={!rulebookSlug.trim() || !rulebookTitle.trim()}>
                    Download rulebook bundle (.zip)
                  </button>
                </div>
              </section>
            )}
          </aside>

          <div className="pdf-preview">
            {!result && !running && (
              <div className="pdf-preview-empty">
                <p>Drop a PDF on the left to get started.</p>
                <p className="muted small">
                  Everything runs in your browser — nothing is uploaded. Works offline once loaded.
                </p>
                <p className="muted small">
                  Turn on <b>Cut individual cards</b> for printable card-sheet PDFs and the
                  importer will slice them into one image per card.
                </p>
              </div>
            )}

            {result && previewPage && (
              <>
                <div className="pdf-preview-head">
                  <button disabled={previewIdx === 0} onClick={() => setPreviewIdx((i) => Math.max(0, i - 1))}>‹</button>
                  <span>Page {previewIdx + 1} of {result.pages.length}
                    {previewPage.textSource === "ocr" && <span className="pdf-ocr-tag"> OCR</span>}
                    {previewCards.length > 0 && <span className="pdf-ocr-tag pdf-card-tag"> {previewCards.length} cards</span>}
                  </span>
                  <button disabled={previewIdx === result.pages.length - 1}
                          onClick={() => setPreviewIdx((i) => Math.min(result.pages.length - 1, i + 1))}>›</button>
                </div>
                <div className="pdf-preview-cols">
                  <div className="pdf-preview-image">
                    {previewImageUrl ? (
                      <div className="pdf-preview-img-wrap">
                        <img src={previewImageUrl} alt={`Page ${previewIdx + 1}`} />
                        {previewRects.length > 0 && (
                          <svg className="pdf-preview-rects"
                               viewBox={`0 0 ${previewPage.width} ${previewPage.height}`}
                               preserveAspectRatio="xMidYMid meet">
                            {previewRects.map((r, i) => (
                              <g key={i}>
                                <rect x={r.x} y={r.y} width={r.w} height={r.h}
                                      fill="none" stroke="#ffd24a" strokeWidth={Math.max(2, previewPage.width * 0.003)} />
                                <rect x={r.x} y={r.y} width={Math.max(28, previewPage.width * 0.04)} height={Math.max(28, previewPage.width * 0.04)}
                                      fill="#ffd24a" />
                                <text x={r.x + Math.max(8, previewPage.width * 0.01)}
                                      y={r.y + Math.max(22, previewPage.width * 0.03)}
                                      fontSize={Math.max(18, previewPage.width * 0.024)}
                                      fill="#0e0f12" fontWeight={700}>{i + 1}</text>
                              </g>
                            ))}
                          </svg>
                        )}
                      </div>
                    ) : (
                      <p className="muted small">No page image — enable "Render each page as a JPEG".</p>
                    )}
                    {previewCards.length > 0 && (
                      <div className="pdf-card-strip">
                        {previewCards.map((c, i) => (
                          <figure key={c.name} className="pdf-card-thumb">
                            <img src={c.url} alt={`Card ${i + 1}`} />
                            <figcaption>{i + 1}</figcaption>
                          </figure>
                        ))}
                      </div>
                    )}
                  </div>
                  <pre className="pdf-preview-text">{previewPage.text || "(no text on this page)"}</pre>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Stable object URL for a Blob — created on change, revoked on swap or
 * unmount. Returns null when the source Blob is null. */
function useObjectUrl(blob: Blob | null): string | null {
  // useMemo creates the URL during render so we don't have to set state
  // from an effect; useEffect just owns the revoke cleanup.
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);
  return url;
}

function baseName(filename: string): string {
  return filename.replace(/\.pdf$/i, "");
}

/** "battle-forces" -> "Battle Forces" — a starting point for the user
 * to edit in the rulebook-title field. */
function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
