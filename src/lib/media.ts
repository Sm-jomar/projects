// Table music, shared by the Legion and D&D tabletops: a YouTube playlist
// (or single video) that rides along in the board state, so whoever sets
// it sets it for everyone in the game. Each viewer plays it in their own
// embedded player, and can mute it or play something else just for them.

/** What's queued in the player: a playlist, a video, or a video within a playlist. */
export type MediaRef = { list?: string; video?: string };

/** The table's music, stored on the board. */
export type TableMusic = MediaRef & {
  /** Shown in the player's header. */
  label?: string;
  /** Display name of whoever set it. */
  by?: string;
  /** When it was set — a new value restarts everyone's player. */
  at: number;
};

const LIST_RE = /^[A-Za-z0-9_-]{12,64}$/;
const VIDEO_RE = /^[A-Za-z0-9_-]{11}$/;

/** Read a YouTube link (playlist, watch, youtu.be, shorts, embed, music.youtube)
 * or a bare playlist / video id. Null when there's nothing playable in it. */
export function parseYouTube(input: string): MediaRef | null {
  const s = input.trim();
  if (!s) return null;
  if (VIDEO_RE.test(s)) return { video: s };
  if (LIST_RE.test(s)) return { list: s };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  if (host !== "youtube.com" && host !== "youtu.be" && host !== "youtube-nocookie.com") return null;
  const out: MediaRef = {};
  const list = url.searchParams.get("list");
  if (list && LIST_RE.test(list)) out.list = list;
  let video: string | null = url.searchParams.get("v");
  if (!video) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (host === "youtu.be") video = parts[0] ?? null;
    else if (["embed", "shorts", "live", "v"].includes(parts[0] ?? "")) video = parts[1] ?? null;
  }
  if (video && video !== "videoseries" && VIDEO_RE.test(video)) out.video = video;
  return out.list || out.video ? out : null;
}

/** The embed URL for a ref. Autoplays (the viewer already clicked to get here). */
export function embedUrl(m: MediaRef, opts: { autoplay?: boolean; loop?: boolean } = {}): string {
  const p = new URLSearchParams();
  if (m.list) p.set("list", m.list);
  if (opts.autoplay !== false) p.set("autoplay", "1");
  // Looping a playlist starts it over at the end; a lone video needs itself as its playlist.
  if (opts.loop !== false) {
    p.set("loop", "1");
    if (!m.list && m.video) p.set("playlist", m.video);
  }
  p.set("rel", "0");
  p.set("modestbranding", "1");
  const path = m.video ?? "videoseries";
  return `https://www.youtube.com/embed/${path}?${p.toString()}`;
}

/** Link to open the ref on YouTube itself. */
export function watchUrl(m: MediaRef): string {
  if (m.video) return `https://www.youtube.com/watch?v=${m.video}${m.list ? `&list=${m.list}` : ""}`;
  return `https://www.youtube.com/playlist?list=${m.list}`;
}

export function sameMedia(a: MediaRef | null | undefined, b: MediaRef | null | undefined): boolean {
  return (a?.list ?? null) === (b?.list ?? null) && (a?.video ?? null) === (b?.video ?? null);
}

/** Validate table music from a board (it came over the network). */
export function parseTableMusic(raw: unknown): TableMusic | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const list = typeof r.list === "string" && LIST_RE.test(r.list) ? r.list : undefined;
  const video = typeof r.video === "string" && VIDEO_RE.test(r.video) ? r.video : undefined;
  if (!list && !video) return null;
  return {
    ...(list ? { list } : {}),
    ...(video ? { video } : {}),
    ...(typeof r.label === "string" && r.label ? { label: r.label.slice(0, 80) } : {}),
    ...(typeof r.by === "string" && r.by ? { by: r.by.slice(0, 40) } : {}),
    at: typeof r.at === "number" ? r.at : 0,
  };
}

// --- Saved playlists (per device) ----------------------------------------

export type SavedMedia = MediaRef & { label: string };

const SAVED_KEY = "media.saved.v1";
const SAVED_MAX = 30;

export function loadSavedMedia(): SavedMedia[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((x) => {
      const m = parseTableMusic({ ...(x as object), at: 0 });
      return m ? [{ ...(m.list ? { list: m.list } : {}), ...(m.video ? { video: m.video } : {}), label: m.label || "Playlist" }] : [];
    });
  } catch {
    return [];
  }
}

export function saveSavedMedia(items: SavedMedia[]): void {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(items.slice(0, SAVED_MAX))); } catch { /* storage unavailable */ }
}

/** A starting label for a ref, before the user names it. */
export function defaultLabel(m: MediaRef): string {
  return m.list ? "YouTube playlist" : "YouTube video";
}
