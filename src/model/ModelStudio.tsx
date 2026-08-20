import { useEffect, useRef, useState } from "react";
import "@google/model-viewer";
import "./model.css";

// Hidden 3D-model studio at /model. Not linked from anywhere in the UI —
// reachable only by typing the URL — and gated by a shared password on
// top of that, since it drives billed third-party API calls.
//
// Pipeline: an image (uploaded here directly, or produced by whatever
// separate ChatGPT-side tool feeds an image in) -> Tripo AI's
// image-to-model API -> a downloadable/previewable 3D model (GLB).
// This page only ever needs an image as input; it makes no OpenAI calls
// itself.

const SECRET_KEY = "model-studio.secret";

type Phase = "idle" | "uploading" | "queued" | "running" | "success" | "failed";

type StatusResponse = {
  status: string;
  progress: number;
  modelUrl: string | null;
  renderedImageUrl: string | null;
  raw: unknown;
};

async function authHeaders(secret: string): Promise<HeadersInit> {
  return { "X-Model-Secret": secret, "content-type": "application/json" };
}

// Downscale + re-encode an uploaded image before it ever leaves the
// browser. Tripo doesn't need a huge source photo, and this keeps the
// request body small.
function fileToDataUrl(file: File, maxDim = 1600, quality = 0.88): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const long = Math.max(img.width, img.height);
      const scale = long > maxDim ? maxDim / long : 1;
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("no 2d context")); return; }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("could not read that file as an image")); };
    img.src = url;
  });
}

export function ModelStudio() {
  const [secret, setSecret] = useState<string | null>(() => sessionStorage.getItem(SECRET_KEY));
  const [checkingAuth, setCheckingAuth] = useState(!!secret);
  const [passwordInput, setPasswordInput] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);

  // Re-validate a cached secret on load rather than trusting it blindly —
  // it may be stale if the server-side password ever changes.
  useEffect(() => {
    if (!secret) return;
    let cancelled = false;
    fetch("/api/model/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: secret }) })
      .then((r) => r.json())
      .then((body: { ok?: boolean }) => {
        if (cancelled) return;
        if (!body.ok) { sessionStorage.removeItem(SECRET_KEY); setSecret(null); }
        setCheckingAuth(false);
      })
      .catch(() => { if (!cancelled) setCheckingAuth(false); });
    return () => { cancelled = true; };
  }, [secret]);

  async function submitPassword() {
    setAuthError(null);
    try {
      const res = await fetch("/api/model/auth", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: passwordInput }),
      });
      const body = (await res.json()) as { ok?: boolean };
      if (body.ok) {
        sessionStorage.setItem(SECRET_KEY, passwordInput);
        setSecret(passwordInput);
      } else {
        setAuthError("Wrong password.");
      }
    } catch {
      setAuthError("Couldn't reach the server — try again.");
    }
  }

  if (checkingAuth) return null; // brief, avoids a password-form flash on a valid cached session

  if (!secret) {
    return (
      <div className="model-gate">
        <form className="model-gate-box" onSubmit={(e) => { e.preventDefault(); void submitPassword(); }}>
          <h1>/model</h1>
          <input type="password" autoFocus placeholder="Password" value={passwordInput}
                 onChange={(e) => setPasswordInput(e.target.value)} />
          <button type="submit" className="model-primary">Enter</button>
          {authError && <p className="model-error">{authError}</p>}
        </form>
      </div>
    );
  }

  return <Studio secret={secret} onSignOut={() => { sessionStorage.removeItem(SECRET_KEY); setSecret(null); }} />;
}

function Studio({ secret, onSignOut }: { secret: string; onSignOut: () => void }) {
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    try {
      const dataUrl = await fileToDataUrl(f);
      setImageDataUrl(dataUrl);
      setImageName(f.name);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function generate() {
    if (!imageDataUrl) return;
    setError(null);
    setStatus(null);
    setPhase("uploading");
    try {
      const res = await fetch("/api/model/generate", {
        method: "POST",
        headers: await authHeaders(secret),
        body: JSON.stringify({ imageDataUrl, prompt: prompt.trim() || undefined }),
      });
      const body = (await res.json()) as { taskId?: string; error?: string };
      if (!res.ok || !body.taskId) throw new Error(body.error ?? `request failed (${res.status})`);
      setPhase("queued");
      startPolling(body.taskId);
    } catch (err) {
      setError((err as Error).message);
      setPhase("failed");
    }
  }

  function startPolling(taskId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    const tick = async () => {
      try {
        const res = await fetch(`/api/model/status/${encodeURIComponent(taskId)}`, { headers: await authHeaders(secret) });
        const body = (await res.json()) as StatusResponse & { error?: string };
        if (!res.ok) throw new Error(body.error ?? `status check failed (${res.status})`);
        setStatus(body);
        if (body.status === "success") {
          setPhase("success");
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (body.status === "failed" || body.status === "banned" || body.status === "cancelled") {
          setPhase("failed");
          setError(`Tripo reported: ${body.status}`);
          if (pollRef.current) clearInterval(pollRef.current);
        } else {
          setPhase(body.status === "running" ? "running" : "queued");
        }
      } catch (err) {
        setError((err as Error).message);
        setPhase("failed");
        if (pollRef.current) clearInterval(pollRef.current);
      }
    };
    void tick();
    pollRef.current = setInterval(tick, 2500);
  }

  function reset() {
    if (pollRef.current) clearInterval(pollRef.current);
    setImageDataUrl(null);
    setImageName("");
    setPrompt("");
    setPhase("idle");
    setStatus(null);
    setError(null);
  }

  const busy = phase === "uploading" || phase === "queued" || phase === "running";

  return (
    <div className="model-page">
      <header className="model-head">
        <h1>Model Studio</h1>
        <button className="model-ghost" onClick={onSignOut}>Sign out</button>
      </header>

      <div className="model-body">
        <section className="model-panel">
          <h2>1. Image</h2>
          <p className="model-hint">
            Upload an image directly, or drop in one produced elsewhere (e.g. a ChatGPT-generated
            concept image) — either way, this is the exact photo Tripo will build the model from.
          </p>
          {imageDataUrl ? (
            <div className="model-preview-wrap">
              <img className="model-preview" src={imageDataUrl} alt={imageName || "selected"} />
              <button className="model-ghost" onClick={() => fileRef.current?.click()} disabled={busy}>Change image</button>
            </div>
          ) : (
            <button className="model-primary" onClick={() => fileRef.current?.click()}>Choose image…</button>
          )}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onFile} />

          <label className="model-field">
            Refinement prompt for Tripo (optional)
            <textarea rows={2} maxLength={1024} value={prompt} onChange={(e) => setPrompt(e.target.value)}
                      placeholder="e.g. clean game-ready topology, matte plastic material" disabled={busy} />
          </label>

          <div className="model-actions">
            <button className="model-primary" onClick={generate} disabled={!imageDataUrl || busy}>
              {busy ? "Working…" : "Generate 3D model"}
            </button>
            <button className="model-ghost" onClick={reset} disabled={busy}>Reset</button>
          </div>

          {phase !== "idle" && (
            <div className="model-status">
              <span className={"model-status-dot " + phase} />
              <span>
                {phase === "uploading" && "Uploading to Tripo…"}
                {phase === "queued" && "Queued…"}
                {phase === "running" && `Generating… ${status?.progress ?? 0}%`}
                {phase === "success" && "Done."}
                {phase === "failed" && "Failed."}
              </span>
            </div>
          )}
          {error && <p className="model-error">{error}</p>}
          {status?.raw != null && (
            <>
              <button className="model-ghost small" onClick={() => setShowRaw((v) => !v)}>
                {showRaw ? "Hide" : "Show"} raw Tripo response
              </button>
              {showRaw && <pre className="model-raw">{JSON.stringify(status.raw, null, 2)}</pre>}
            </>
          )}
        </section>

        <section className="model-panel">
          <h2>2. Result</h2>
          {!status?.modelUrl ? (
            <p className="model-hint">Nothing generated yet.</p>
          ) : (
            <>
              <model-viewer
                src={status.modelUrl}
                alt={imageName || "generated model"}
                camera-controls
                auto-rotate
                shadow-intensity="1"
                className="model-viewer"
              />
              <div className="model-actions">
                <a className="model-primary" href={status.modelUrl} download target="_blank" rel="noopener noreferrer">
                  Download model (GLB)
                </a>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
