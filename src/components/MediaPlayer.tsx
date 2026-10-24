import { useEffect, useState } from "react";
import type { MediaPlayback, MediaToggle } from "./useMediaPlayer";
import {
  defaultLabel, embedUrl, loadSavedMedia, parseYouTube, sameMedia, saveSavedMedia, watchUrl,
  type MediaRef, type SavedMedia, type TableMusic,
} from "../lib/media";
import "./media.css";

// Table music, shared by both tabletops: a toolbar button that opens a
// floating YouTube player over the board. Whoever may set it picks a
// playlist for the whole table (it's saved on the board); anyone can mute
// it for themselves or play something else just for them. Minimizing only
// hides the window — the player stays mounted so the music keeps going.

/** Toolbar button that shows or hides the player. */
export function MediaButton({ toggle, playing, className }: { toggle: MediaToggle; playing: boolean; className?: string }) {
  const { open, setOpen } = toggle;
  return (
    <button className={"media-toggle " + (open ? "active " : "") + (className ?? "")}
            onClick={() => setOpen(!open)}
            title={open ? "Hide the music player" : "Open the music player"}>
      🎵 Music{playing && <span className="media-live" aria-label="(playing)" />}
    </button>
  );
}

type Props = {
  /** The table's music, from the board. */
  music: TableMusic | null;
  /** May this viewer change the table's music? */
  canSet: boolean;
  /** Why not, when they can't (shown under the form). */
  cantSetWhy?: string;
  onSet: (m: TableMusic | null) => void;
  myName: string;
  toggle: MediaToggle;
  className?: string;
};

export function MediaDock({ music, canSet, cantSetWhy, onSet, myName, toggle, className, playback }: Props & { playback: MediaPlayback }) {
  const { open, setOpen } = toggle;
  const { mine, setMine, muted, setMuted, current, playing } = playback;
  const [draft, setDraft] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedMedia[]>(() => loadSavedMedia());

  // A new table pick replaces a "just me" pick of the same thing.
  useEffect(() => {
    if (mine && music && sameMedia(mine, music)) {
      const t = setTimeout(() => setMine(null), 0);
      return () => clearTimeout(t);
    }
  }, [mine, music, setMine]);

  function read(): (MediaRef & { label: string }) | null {
    const ref = parseYouTube(draft);
    if (!ref) {
      setError(draft.trim() ? "That doesn't look like a YouTube playlist or video link." : "Paste a YouTube playlist link first.");
      return null;
    }
    setError(null);
    return { ...ref, label: label.trim() || defaultLabel(ref) };
  }

  function playForTable(ref: MediaRef & { label: string }) {
    onSet({ ...pick(ref), label: ref.label, by: myName || undefined, at: Date.now() });
    setMine(null);
    setMuted(false);
  }
  function playForMe(ref: MediaRef & { label: string }) {
    setMine({ ...pick(ref), label: ref.label, at: Date.now() });
    setMuted(false);
  }

  function submit(forTable: boolean) {
    const ref = read();
    if (!ref) return;
    if (forTable) playForTable(ref); else playForMe(ref);
    setDraft("");
    setLabel("");
  }

  function saveCurrent() {
    if (!current) return;
    const item: SavedMedia = { ...pick(current), label: current.label || defaultLabel(current) };
    const next = [item, ...saved.filter((s) => !sameMedia(s, item))];
    setSaved(next);
    saveSavedMedia(next);
  }
  function unsave(item: SavedMedia) {
    const next = saved.filter((s) => !sameMedia(s, item));
    setSaved(next);
    saveSavedMedia(next);
  }

  const currentSaved = !!current && saved.some((s) => sameMedia(s, current));
  // Remount the player when the pick changes, or the table restarts it.
  const frameKey = playing ? `${playing.list ?? ""}/${playing.video ?? ""}/${playing.at}` : "";

  // Nothing to keep alive and nothing to show.
  if (!open && !playing) return null;

  return (
    <div className={"media-dock " + (open ? "" : "minimized ") + (className ?? "")}
         role="dialog" aria-label="Music player" aria-hidden={!open}>
      <div className="media-head">
        <b className="media-title">🎵 {mine ? "Your music" : "Table music"}</b>
        <button className="ghost-btn small" onClick={() => setOpen(false)}
                title="Minimize — the music keeps playing" aria-label="Minimize music player">–</button>
      </div>

      <div className="media-now">
        {current ? (
          <>
            <div className="media-now-text">
              <b title={current.label}>{current.label || defaultLabel(current)}</b>
              <span className="muted small">
                {mine ? "Just for you" : music?.by ? `Set by ${music.by} for the table` : "For the table"}
                {muted && " · muted for you"}
              </span>
            </div>
            <button className="ghost-btn small" onClick={saveCurrent} disabled={currentSaved}
                    title={currentSaved ? "Saved on this device" : "Keep this in your saved list on this device"}>
              {currentSaved ? "★" : "☆"}
            </button>
          </>
        ) : (
          <span className="muted small">Nothing playing. Paste a YouTube playlist below.</span>
        )}
      </div>

      {playing ? (
        <div className="media-frame">
          <iframe key={frameKey} src={embedUrl(playing)} title={playing.label || "YouTube player"}
                  allow="autoplay; encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen />
        </div>
      ) : current && (
        <div className="media-frame media-frame-off">
          <span className="muted small">Muted for you.</span>
        </div>
      )}

      {current && (
        <div className="media-controls">
          <button className="ghost-btn small" onClick={() => setMuted(!muted)}
                  title={muted ? "Hear the music again" : "Stop the music on this device only"}>
            {muted ? "🔈 Unmute" : "🔇 Mute for me"}
          </button>
          {mine && music && (
            <button className="ghost-btn small" onClick={() => setMine(null)} title="Go back to what the table is playing">
              ↩ Table music
            </button>
          )}
          {mine && !music && (
            <button className="ghost-btn small" onClick={() => setMine(null)}>■ Stop</button>
          )}
          {!mine && music && canSet && (
            <button className="ghost-btn small" onClick={() => onSet(null)} title="Stop the music for everyone">■ Stop for table</button>
          )}
          <a className="ghost-btn small media-yt" href={watchUrl(current)} target="_blank" rel="noreferrer">YouTube ↗</a>
        </div>
      )}

      <form className="media-form" onSubmit={(e) => { e.preventDefault(); submit(canSet); }}>
        <input value={draft} onChange={(e) => { setDraft(e.target.value); setError(null); }}
               placeholder="YouTube playlist or video link"
               onKeyDown={(e) => e.stopPropagation()} aria-label="YouTube link" />
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80}
               placeholder="Name (optional), e.g. Tavern, Battle"
               onKeyDown={(e) => e.stopPropagation()} aria-label="Name" />
        <div className="media-form-btns">
          <button type="submit" disabled={!canSet} title={canSet ? "Everyone in the game hears it" : cantSetWhy}>▶ Play for table</button>
          <button type="button" className="ghost-btn" onClick={() => submit(false)} title="Only you hear it">▶ Just me</button>
        </div>
        {error && <div className="media-error small">{error}</div>}
        {!canSet && cantSetWhy && <div className="muted small">{cantSetWhy}</div>}
      </form>

      {saved.length > 0 && (
        <ul className="media-saved">
          {saved.map((s) => (
            <li key={`${s.list ?? ""}/${s.video ?? ""}`} className={current && sameMedia(s, current) ? "on" : ""}>
              <span className="media-saved-label" title={s.label}>{s.label}</span>
              {canSet && <button className="ghost-btn small" onClick={() => playForTable(s)} title="Play for the table">▶ Table</button>}
              <button className="ghost-btn small" onClick={() => playForMe(s)} title="Play just for you">▶ Me</button>
              <button className="ghost-btn small" onClick={() => unsave(s)} title="Remove from saved" aria-label={`Remove ${s.label}`}>✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function pick(m: MediaRef): MediaRef {
  return { ...(m.list ? { list: m.list } : {}), ...(m.video ? { video: m.video } : {}) };
}
