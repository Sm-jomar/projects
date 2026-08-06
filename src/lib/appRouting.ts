// Which sub-app to render, decided from the ?app= param (with a hostname
// fallback). For now everything runs on the existing deployment under
// ?app=; the dedicated subdomains aren't wired yet.
//
//   ?app=home   -> the game-chooser hub
//   ?app=legion -> Star Wars: Legion   (also the default)
//   ?app=dnd    -> Dungeons & Dragons
//
// Hostname is still honored (dragons.* -> dnd, etc.) so switching to real
// subdomains later needs no code change.

export type AppKind = "home" | "legion" | "dnd";

// Canonical base for cross-app links while everything lives on one domain.
const BASE = "https://legion.eslegion.com";
// The deployment that can actually run multiplayer (has /api/room). The
// static site can't, so multiplayer buttons point here.
const MP_BASE = "https://projects.sm-af6.workers.dev";

export function resolveApp(): AppKind {
  const params = new URLSearchParams(window.location.search);
  const override = params.get("app");
  if (override === "home" || override === "legion" || override === "dnd") {
    return override;
  }
  const host = window.location.hostname.toLowerCase();
  if (host.startsWith("dragons.")) return "dnd";
  if (host.startsWith("legion.")) return "legion";
  if (host === "eslegion.com" || host === "www.eslegion.com") return "home";
  return "legion";
}

export function homeUrl(): string { return `${BASE}/?app=home`; }
export function legionUrl(): string { return `${BASE}/?app=legion`; }
export function dndUrl(): string { return `${BASE}/?app=dnd`; }

// Multiplayer-capable destinations (Worker), optionally carrying a room code.
export function legionPlayUrl(room?: string): string {
  return room ? `${MP_BASE}/?app=legion&room=${encodeURIComponent(room)}` : `${MP_BASE}/?app=legion`;
}
export function dndPlayUrl(room?: string): string {
  return room ? `${MP_BASE}/?app=dnd&room=${encodeURIComponent(room)}` : `${MP_BASE}/?app=dnd`;
}
