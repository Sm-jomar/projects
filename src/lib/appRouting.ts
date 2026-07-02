// Which sub-app to render, decided from the hostname (with a ?app=
// override for local/dev testing). One SPA build serves all three:
//
//   eslegion.com / www.eslegion.com   -> "home"   (the game-chooser hub)
//   legion.eslegion.com               -> "legion" (Star Wars: Legion)
//   dragons.eslegion.com              -> "dnd"    (Dungeons & Dragons)
//
// Anything else (localhost, the *.workers.dev deploy, github.io) defaults
// to "legion" so the existing Legion experience and its multiplayer URL
// are unchanged. Append ?app=home|legion|dnd to force one anywhere.

export type AppKind = "home" | "legion" | "dnd";

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
  // Dev / preview hosts keep the current Legion default.
  return "legion";
}

// Canonical destinations for the hub's game cards. On production these are
// the real subdomains; elsewhere we fall back to a same-origin ?app= link
// so the hub is still navigable on localhost / workers.dev.
export function legionUrl(): string {
  const host = window.location.hostname.toLowerCase();
  if (host.endsWith("eslegion.com")) return "https://legion.eslegion.com";
  return `${window.location.origin}${window.location.pathname}?app=legion`;
}

export function dndUrl(): string {
  const host = window.location.hostname.toLowerCase();
  if (host.endsWith("eslegion.com")) return "https://dragons.eslegion.com";
  return `${window.location.origin}${window.location.pathname}?app=dnd`;
}

export function homeUrl(): string {
  const host = window.location.hostname.toLowerCase();
  if (host.endsWith("eslegion.com")) return "https://eslegion.com";
  return `${window.location.origin}${window.location.pathname}?app=home`;
}
