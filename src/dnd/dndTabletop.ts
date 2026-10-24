// State model + persistence for the D&D dungeon tabletop.

import type { TableMusic } from "../lib/media";
import { logId, type LogActor, type LogEntry } from "../lib/auditLog";
import type { DndCharacter } from "./dndTypes";

export type TokenKind = "pc" | "monster" | "marker";

// A player's shared character sheet in a multiplayer game, keyed by their
// connection id. The full sheet snapshot travels so everyone can view it.
export type PlayerProfile = {
  name: string;
  color: string;
  charId: string;
  character: DndCharacter;
};

export type DndToken = {
  id: string;
  name: string;
  // Position in GRID CELLS (top-left of the token's footprint). Fractional
  // allowed unless snapped.
  x: number;
  y: number;
  size: number; // footprint in cells (1 = med/small, 2 = large, 3 = huge)
  color: string; // hex
  kind: TokenKind;
  hpCurrent?: number;
  hpMax?: number;
  initiative?: number;
  /** Linked saved-character id, if this token came from a sheet. */
  charId?: string;
  /** User-uploaded icon (data URL), rendered in place of the color disc. */
  avatarUrl?: string;
  /** Campaign NPC this token was placed from (DM screen). */
  npcId?: string;
  /** Walking speed in feet per move (3D move readout). Undefined = 30. */
  speed?: number;
  /** Height above the ground in feet (3D view): flying, or standing on a
   * floating floor that starts at or below it. 0 / undefined = on the ground. */
  elevation?: number;
  /** Uploaded STL miniature, simplified + encoded (see lib/stlModel). */
  modelStl?: string;
  /** Original file name of the uploaded model, for the editor. */
  modelName?: string;
  /** Fog of war: how far this token sees, in feet. Undefined = no limit
   * (a lit map); set it for darkness, darkvision or a torch's radius. */
  sight?: number;
};

// A terrain block on the board: walls, buildings, pillars, platforms,
// trees. Drawn flat in 2D and extruded to its height in the 3D view, or
// replaced there by an uploaded STL model stretched to fill the block.
export type DndTerrainKind = "wall" | "building" | "pillar" | "platform" | "tree" | "rock";

export type DndTerrain = {
  id: string;
  kind: DndTerrainKind;
  shape: "rect" | "circle";
  label: string;
  /** Top-left in GRID CELLS; for circles w is the diameter. */
  x: number;
  y: number;
  w: number;
  d: number;
  rotation: number; // degrees
  /** Height in feet. */
  height: number;
  /** Floats this many feet off the ground: an upper floor, a balcony, a
   * floating rock. Tokens under it stay on the ground; a token whose
   * elevation reaches it stands on top. Undefined / 0 = on the ground. */
  float?: number;
  color: string;
  /** Uploaded STL (lib/stlModel encoding) shown instead of the block. */
  modelStl?: string;
  modelName?: string;
};

export const DND_TERRAIN_PRESETS: Array<Omit<DndTerrain, "id" | "x" | "y">> = [
  { kind: "wall",     shape: "rect",   label: "Wall",     w: 4, d: 0.5, rotation: 0, height: 10, color: "#6b6f7a" },
  { kind: "building", shape: "rect",   label: "Building", w: 3, d: 3,   rotation: 0, height: 15, color: "#7a6448" },
  { kind: "pillar",   shape: "circle", label: "Pillar",   w: 1, d: 1,   rotation: 0, height: 10, color: "#8a8e98" },
  { kind: "platform", shape: "rect",   label: "Platform", w: 3, d: 2,   rotation: 0, height: 5,  color: "#5e5a52" },
  { kind: "rock",     shape: "circle", label: "Boulder",  w: 2, d: 2,   rotation: 0, height: 5,  color: "#5d6878" },
  { kind: "tree",     shape: "circle", label: "Trees",    w: 3, d: 3,   rotation: 0, height: 25, color: "#2f5237" },
];

export function makeTerrain(s: DndTabletopState, preset: Omit<DndTerrain, "id" | "x" | "y">): DndTerrain {
  return {
    ...preset,
    id: newId("tr"),
    x: Math.round(s.map.cols / 2 - preset.w / 2),
    y: Math.round(s.map.rows / 2 - preset.d / 2),
  };
}

export type DndMap = {
  /** Data URL or remote URL of the dungeon map image. */
  imageUrl: string | null;
  cols: number;
  rows: number;
  showGrid: boolean;
  /** Grid opacity 0..1. */
  gridOpacity: number;
};

// Fog of war. The DM sees the whole map; each player sees only what their
// own PC tokens have line of sight to (see dndFog).
export type DndFog = {
  on: boolean;
  /** Players see through every PC on the board, not just their own. */
  sharedVision?: boolean;
};

export type DndTabletopState = {
  map: DndMap;
  fog?: DndFog;
  tokens: DndToken[];
  terrain?: DndTerrain[];
  round: number;
  /** Id of the token whose turn it is (initiative order), or null. */
  activeTokenId: string | null;
  /** Shared audit log (synced + persisted with the board). */
  log?: LogEntry[];
  /** Players' shared character sheets, keyed by connection id. */
  profiles?: Record<string, PlayerProfile>;
  /** Players' uploaded avatar images (data URLs), keyed by connection id.
   * Shown in the party roster and defaulted onto a "+ My token". */
  avatars?: Record<string, string>;
  /** Table music: the YouTube playlist everyone in the game hears. */
  music?: TableMusic | null;
};

export function newDndTabletop(): DndTabletopState {
  return {
    map: { imageUrl: null, cols: 24, rows: 16, showGrid: true, gridOpacity: 0.35 },
    tokens: [],
    terrain: [],
    round: 1,
    activeTokenId: null,
    log: [],
    profiles: {},
    avatars: {},
  };
}

// Diff two board snapshots into audit-log entries, attributed to `actor`.
// Covers piece moves (with from/to for ghost replay), adds/removes, HP
// changes and round/turn changes. Ignores the log field itself.
export function diffDnd(prev: DndTabletopState, next: DndTabletopState, actor: LogActor): LogEntry[] {
  const out: LogEntry[] = [];
  const prevById = new Map(prev.tokens.map((t) => [t.id, t]));
  const nextById = new Map(next.tokens.map((t) => [t.id, t]));
  const mk = (kind: LogEntry["kind"], text: string, move?: LogEntry["move"]): LogEntry =>
    ({ id: logId(), ts: Date.now(), actor, kind, text, ...(move ? { move } : {}) });

  for (const t of next.tokens) {
    const p = prevById.get(t.id);
    if (!p) { out.push(mk("add", `added ${t.name || "a token"}`)); continue; }
    if (p.x !== t.x || p.y !== t.y) {
      out.push(mk("move", `moved ${t.name || "a token"}`, {
        from: { x: p.x, y: p.y }, to: { x: t.x, y: t.y }, size: t.size, color: t.color,
      }));
    }
    if ((p.hpCurrent ?? null) !== (t.hpCurrent ?? null)) {
      const d = (t.hpCurrent ?? 0) - (p.hpCurrent ?? 0);
      out.push(mk("hp", `${t.name || "token"} HP ${d >= 0 ? "+" : ""}${d} (${t.hpCurrent ?? "?"}${t.hpMax != null ? "/" + t.hpMax : ""})`));
    }
  }
  for (const p of prev.tokens) {
    if (!nextById.has(p.id)) out.push(mk("remove", `removed ${p.name || "a token"}`));
  }
  if (prev.round !== next.round) out.push(mk("round", `advanced to round ${next.round}`));
  if (prev.activeTokenId !== next.activeTokenId && next.activeTokenId) {
    const t = nextById.get(next.activeTokenId);
    out.push(mk("turn", `${t?.name || "a token"}'s turn`));
  }
  return out;
}

let idc = 0;
export function newId(prefix = "tk"): string {
  idc = (idc + 1) % 10000;
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${idc}`;
}

// Distinct default token colors, cycled as tokens are added.
export const TOKEN_COLORS = [
  "#4a86c8", "#c84a4a", "#4ac86a", "#c8a34a", "#9a4ac8",
  "#4ac8c8", "#c86a4a", "#c84a9a", "#6a6a6a",
];

// A new token centred on the map, colour cycled from the palette; any
// field can be overridden.
export function makeToken(s: DndTabletopState, partial: Partial<DndToken>): DndToken {
  return {
    id: newId(),
    name: "Token",
    x: Math.round(s.map.cols / 2) - 0.5,
    y: Math.round(s.map.rows / 2) - 0.5,
    size: 1,
    color: TOKEN_COLORS[s.tokens.length % TOKEN_COLORS.length]!,
    kind: "monster",
    ...partial,
  };
}

// Initiative order: tokens with an initiative value, highest first; ties by
// name. Tokens without initiative are dropped from the tracker.
export function initiativeOrder(tokens: DndToken[]): DndToken[] {
  return tokens
    .filter((t) => t.initiative != null && !Number.isNaN(t.initiative))
    .sort((a, b) => (b.initiative! - a.initiative!) || a.name.localeCompare(b.name));
}

// --- Persistence ----------------------------------------------------------
const KEY = "dnd.tabletop.v1";

export function loadDndTabletop(): DndTabletopState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DndTabletopState>;
    if (!parsed || !Array.isArray(parsed.tokens)) return null;
    const base = newDndTabletop();
    return {
      ...base,
      ...parsed,
      map: { ...base.map, ...(parsed.map ?? {}) },
    };
  } catch {
    return null;
  }
}

export function saveDndTabletop(s: DndTabletopState): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    // Quota exceeded — most likely a large map image data URL.
    return false;
  }
}

// Downscaling uploads lives in lib/image (shared with the Legion board).
export { downscaleImage } from "../lib/image";

// Re-encode an existing data-URL image smaller (e.g. before saving a board
// into a campaign). Remote http(s) images are left as-is — they can't be
// read back from a tainted canvas, and they don't count against storage.
export function downscaleDataUrl(src: string, maxDim: number, quality: number): Promise<string> {
  if (!src.startsWith("data:")) return Promise.resolve(src);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const long = Math.max(img.width, img.height);
      const scale = long > maxDim ? maxDim / long : 1;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("no 2d context")); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const out = canvas.toDataURL("image/jpeg", quality);
      resolve(out.length < src.length ? out : src);
    };
    img.onerror = () => reject(new Error("could not load image"));
    img.src = src;
  });
}

// Serialized size, measured the same way the room server enforces its
// MAX_STATE_BYTES cap (JSON string length).
export function boardBytes(s: DndTabletopState): number {
  return JSON.stringify(s).length;
}
// Leave headroom under the server's 2,000,000 cap for log growth etc.
export const BOARD_BYTES_SAFE = 1_850_000;
