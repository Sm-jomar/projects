// Which sub-app to render, and the canonical cross-app links.
//
// Everything is served from one origin (eslegion.com, plus the workers.dev
// URL) by the Cloudflare Worker, routed by PATH:
//
//   /         -> the game-chooser hub (home)
//   /legion   -> Star Wars: Legion
//   /dnd      -> Dungeons & Dragons   (matched case-insensitively, e.g. /DnD)
//   /model    -> hidden 3D-model studio — intentionally undiscoverable: no
//                nav link, no helper exported for it anywhere in this file.
//                Reachable only by typing the URL, and password-gated on
//                top of that (see ModelStudio.tsx).
//   /upload/<session_id> -> the Tripo Forge Custom GPT's browser upload
//                page, reached only via a one-time link the GPT hands the
//                user (see src/upload/UploadPage.tsx). Access control is
//                the session's own random ?token=, not this routing.
//
// Legacy subdomains (legion.*, dragons.*) and the ?app= override still
// resolve, so older links keep working during and after the cutover.

export type AppKind = "home" | "legion" | "dnd" | "model" | "upload";

// A guaranteed multiplayer-capable origin (the Worker serves /api/room).
// Used only when the current page is NOT itself Worker-served — e.g. the old
// GitHub Pages site while the Cloudflare cutover is in progress. Once
// eslegion.com is on the Worker this is effectively never needed.
const WORKER_ORIGIN = "https://projects.sm-af6.workers.dev";

export function resolveApp(): AppKind {
  const params = new URLSearchParams(window.location.search);
  const override = params.get("app");
  if (override === "home" || override === "legion" || override === "dnd" || override === "model") {
    return override;
  }

  const path = window.location.pathname.toLowerCase().replace(/\/+$/, "");
  if (path === "/legion" || path.startsWith("/legion/")) return "legion";
  if (path === "/dnd" || path.startsWith("/dnd/")) return "dnd";
  if (path === "/model" || path.startsWith("/model/")) return "model";
  if (path.startsWith("/upload/")) return "upload";

  // Root path: legacy subdomains still open their app; otherwise the hub.
  if (path === "" ) {
    const host = window.location.hostname.toLowerCase();
    if (host.startsWith("dragons.")) return "dnd";
    if (host.startsWith("legion.")) return "legion";
  }
  return "home";
}

// In-app navigation is same-origin PATHS, so links work identically on
// eslegion.com, the workers.dev URL, and localhost.
export function homeUrl(): string { return "/"; }
export function legionUrl(): string { return "/legion"; }
export function dndUrl(): string { return "/dnd"; }

// True when the current page is served by the Worker, so /api/room (live
// multiplayer) is reachable on this same origin.
export function roomsAvailableHere(): boolean {
  const h = window.location.hostname.toLowerCase();
  return (
    h.endsWith(".workers.dev") ||
    h === "eslegion.com" || h === "www.eslegion.com" ||
    h === "localhost" || h === "127.0.0.1"
  );
}

// Absolute multiplayer URL for a sub-app (for invite links + the "open
// multiplayer site" button). Same-origin when rooms are available here;
// otherwise the guaranteed Worker origin.
function playUrl(path: string, room?: string): string {
  const origin = roomsAvailableHere() ? window.location.origin : WORKER_ORIGIN;
  const q = room ? `?room=${encodeURIComponent(room)}` : "";
  return `${origin}${path}${q}`;
}
export function legionPlayUrl(room?: string): string { return playUrl("/legion", room); }
export function dndPlayUrl(room?: string): string { return playUrl("/dnd", room); }
