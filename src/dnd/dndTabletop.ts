// State model + persistence for the D&D dungeon tabletop.

export type TokenKind = "pc" | "monster" | "marker";

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
};

export type DndMap = {
  /** Data URL or remote URL of the dungeon map image. */
  imageUrl: string | null;
  cols: number;
  rows: number;
  showGrid: boolean;
  /** Grid opacity 0..1. */
  gridOpacity: number;
};

export type DndTabletopState = {
  map: DndMap;
  tokens: DndToken[];
  round: number;
  /** Id of the token whose turn it is (initiative order), or null. */
  activeTokenId: string | null;
};

export function newDndTabletop(): DndTabletopState {
  return {
    map: { imageUrl: null, cols: 24, rows: 16, showGrid: true, gridOpacity: 0.35 },
    tokens: [],
    round: 1,
    activeTokenId: null,
  };
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

// Downscale an uploaded image to keep it inside localStorage's ~5MB budget
// (and, later, syncable over the room server). Returns a JPEG data URL.
export function downscaleImage(file: File, maxDim = 1600, quality = 0.82): Promise<string> {
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
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("could not load image")); };
    img.src = url;
  });
}
