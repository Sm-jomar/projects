import { useRef, useState } from "react";
import {
  importPdf, toJsonString, toPlainText, toZipBlob, downloadBlob, downloadText,
  type ImportResult, type OcrMode, type Progress,
} from "../lib/pdfImporter";

type Props = { onClose: () => void };

export function PdfImporterPanel({ onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [ocrMode, setOcrMode] = useState<OcrMode>("auto");
  const [includeImages, setIncludeImages] = useState(true);
  const [imageQuality, setImageQuality] = useState(0.8);
  const [imageMaxDim, setImageMaxDim] = useState(1400);
  const [ocrDpi, setOcrDpi] = useState(200);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewIdx, setPreviewIdx] = useState(0);

  function chooseFile() { fileRef.current?.click(); }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setResult(null);
      setError(null);
      setProgress(null);
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
    } else if (f) {
      setError(`"${f.name}" doesn't look like a PDF.`);
    }
  }

  async function run() {
    if (!file || running) return;
    setRunning(true);
    setResult(null);
    setError(null);
    setProgress({ phase: "loading", message: "Starting…" });
    try {
      const r = await importPdf(file, {
        ocrMode, includeImages, imageQuality, imageMaxDim, ocrDpi,
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
  const previewImageUrl =
    previewPage && previewPage.images[0] && result
      ? (() => {
          const imgName = previewPage.images[0].replace(/^images\//, "");
          const blob = result.images.get(imgName);
          return blob ? URL.createObjectURL(blob) : null;
        })()
      : null;

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
              <h3>Images</h3>
              <label className="pdf-toggle">
                <input type="checkbox" checked={includeImages} onChange={(e) => setIncludeImages(e.target.checked)} />
                Render each page as a JPEG
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
                  {result.pageCount} page{result.pageCount === 1 ? "" : "s"} · {result.imageCount} image{result.imageCount === 1 ? "" : "s"}
                  {ocrPages > 0 && <> · {ocrPages} OCR'd</>}
                </div>
                <div className="pdf-download-row">
                  <button onClick={downloadTxt}>.txt</button>
                  <button onClick={downloadJson}>.json</button>
                  <button onClick={downloadZip}>.zip (everything)</button>
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
              </div>
            )}

            {result && previewPage && (
              <>
                <div className="pdf-preview-head">
                  <button disabled={previewIdx === 0} onClick={() => setPreviewIdx((i) => Math.max(0, i - 1))}>‹</button>
                  <span>Page {previewIdx + 1} of {result.pages.length}
                    {previewPage.textSource === "ocr" && <span className="pdf-ocr-tag"> OCR</span>}
                  </span>
                  <button disabled={previewIdx === result.pages.length - 1}
                          onClick={() => setPreviewIdx((i) => Math.min(result.pages.length - 1, i + 1))}>›</button>
                </div>
                <div className="pdf-preview-cols">
                  {previewImageUrl && (
                    <div className="pdf-preview-image">
                      <img src={previewImageUrl} alt={`Page ${previewIdx + 1}`} />
                    </div>
                  )}
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

function baseName(filename: string): string {
  return filename.replace(/\.pdf$/i, "");
}
