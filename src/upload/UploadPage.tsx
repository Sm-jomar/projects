import { useEffect, useState } from "react";
import "./upload.css";

// The Tripo Forge Custom GPT's browser upload page. The GPT hands the
// user a one-time link like /upload/us_abc123?token=... when it needs an
// actual image file it doesn't already have a public URL for. Access
// control is the session's own random, single-purpose, short-lived
// token — this page carries no password of its own.

type Mode = "single" | "multiview";
type SessionInfo = { session_id: string; mode: Mode; status: string; requiredSlots: string[] };
const SLOTS = ["front", "left", "back", "right"] as const;

function parseLocation(): { sessionId: string; token: string } {
  const m = /^\/upload\/([^/]+)/.exec(window.location.pathname);
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  return { sessionId: m?.[1] ?? "", token };
}

export function UploadPage() {
  const [{ sessionId, token }] = useState(parseLocation);
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(() => (sessionId ? null : "No upload session in this link."));
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const [slotFiles, setSlotFiles] = useState<Record<string, File | null>>({ front: null, left: null, back: null, right: null });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/upload-page/${encodeURIComponent(sessionId)}?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const body = (await res.json()) as SessionInfo & { message?: string };
        if (!res.ok) throw new Error(body.message ?? "This upload link isn't valid.");
        setInfo(body);
        if (body.status === "submitted") setDone(true);
      })
      .catch((err) => setLoadError((err as Error).message));
  }, [sessionId, token]);

  async function submit() {
    if (!info) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const form = new FormData();
      if (info.mode === "single") {
        if (!singleFile) throw new Error("Choose an image first.");
        form.append("image", singleFile);
      } else {
        for (const slot of SLOTS) {
          const f = slotFiles[slot];
          if (!f) throw new Error(`Missing the ${slot.toUpperCase()} image.`);
          form.append(slot, f);
        }
      }
      const res = await fetch(`/api/upload-page/${encodeURIComponent(sessionId)}/submit?token=${encodeURIComponent(token)}`, {
        method: "POST", body: form,
      });
      const body = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !body.ok) throw new Error(body.message ?? "Upload failed.");
      setDone(true);
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return <div className="upload-page"><div className="upload-box"><h1>Upload link</h1><p className="upload-error">{loadError}</p></div></div>;
  }
  if (done) {
    return (
      <div className="upload-page">
        <div className="upload-box">
          <h1>Uploaded ✓</h1>
          <p>Your image{info?.mode === "multiview" ? "s are" : " is"} on its way to Tripo. Return to ChatGPT and say “Done” to continue.</p>
        </div>
      </div>
    );
  }
  if (!info) return null;

  return (
    <div className="upload-page">
      <div className="upload-box">
        <h1>Upload for Tripo Forge</h1>
        {info.mode === "single" ? (
          <label className="upload-slot">
            <span>Image</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setSingleFile(e.target.files?.[0] ?? null)} />
            {singleFile && <span className="upload-filename">{singleFile.name}</span>}
          </label>
        ) : (
          <div className="upload-slots">
            {SLOTS.map((slot) => (
              <label key={slot} className="upload-slot">
                <span>{slot.toUpperCase()}</span>
                <input type="file" accept="image/png,image/jpeg,image/webp"
                       onChange={(e) => setSlotFiles((s) => ({ ...s, [slot]: e.target.files?.[0] ?? null }))} />
                {slotFiles[slot] && <span className="upload-filename">{slotFiles[slot]!.name}</span>}
              </label>
            ))}
          </div>
        )}
        <button className="upload-primary" onClick={submit} disabled={submitting}>
          {submitting ? "Uploading…" : "Submit"}
        </button>
        {submitError && <p className="upload-error">{submitError}</p>}
      </div>
    </div>
  );
}
