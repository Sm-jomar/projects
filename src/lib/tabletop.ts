// Tabletop session model. Everything the canvas needs to render a game state.

export type GameType = "skirmish" | "standard" | "grand-army" | "custom";

export type MapSize = { widthInches: number; heightInches: number };

export const GAME_TYPES: Record<GameType, { label: string; size: MapSize; defaultPoints: number; description: string }> = {
  skirmish:     { label: "Skirmish",    size: { widthInches: 36, heightInches: 36 }, defaultPoints: 500,  description: "3' × 3' — fast 500-point games" },
  standard:     { label: "Standard",    size: { widthInches: 72, heightInches: 36 }, defaultPoints: 800,  description: "6' × 3' — tournament play" },
  "grand-army": { label: "Grand Army",  size: { widthInches: 96, heightInches: 48 }, defaultPoints: 1500, description: "8' × 4' — big battles" },
  custom:       { label: "Custom",      size: { widthInches: 72, heightInches: 36 }, defaultPoints: 800,  description: "Pick your own size" },
};

export type TerrainShape = "rect" | "circle";

export type Terrain = {
  id: string;
  shape: TerrainShape;
  // Position is in inches relative to the map's top-left.
  x: number;
  y: number;
  // For rect: width/height. For circle: width is the diameter (height ignored).
  width: number;
  height: number;
  rotation: number; // degrees
  label: string;
  // Visual style — informational; rules treatment is up to players.
  kind: "rock" | "wall" | "building" | "forest" | "barricade" | "objective";
};

export type FactionColor = "rebels" | "imperials" | "republic" | "separatists" | "mercenary" | "neutral";

export type TokenKind = "unit" | "objective" | "marker";

export type Token = {
  id: string;
  kind: TokenKind;
  // Top-left in inches.
  x: number;
  y: number;
  // Footprint in inches. Square for v1.
  size: number;
  label: string;
  color: FactionColor;
  /** Optional small badge text (free-form, top-right). */
  badge?: string;
  /** If set, this token represents a specific catalog unit. Used to render
   * the unit's card-portrait inside the token circle. */
  unitId?: string;
  /** Pre-resolved URL of the unit's card image (kept here so the canvas
   * doesn't have to re-query the manifest on every render). */
  portraitUrl?: string;
  /** Facing in degrees (0 = up). Rendered as an arrow on the token rim.
   * Undefined = no facing shown (most trooper units don't need one). */
  rotation?: number;
  /** Wound counter (bottom-right red badge when > 0). */
  wounds?: number;
  /** Suppression counter (bottom-left orange badge when > 0). */
  suppression?: number;
  /** True once the unit has activated this round; rendered dimmed with a
   * check mark. Cleared by "End round". */
  activated?: boolean;
};

export type TabletopState = {
  gameType: GameType;
  map: MapSize;
  terrain: Terrain[];
  tokens: Token[];
  round: number;
  vp: { blue: number; red: number };
  deployment: DeploymentKey | null;
};

export function newTabletop(gameType: GameType = "standard"): TabletopState {
  return {
    gameType,
    map: { ...GAME_TYPES[gameType].size },
    terrain: [],
    tokens: [],
    round: 1,
    vp: { blue: 0, red: 0 },
    deployment: null,
  };
}

// --- Token footprints (Legion base sizes, in inches) ----------------------
// These are approximate "footprint" widths that work as table tokens, not
// exact AMG base diameters. Small enough to drag, large enough to see.
export const BASE_SIZE: Record<string, number> = {
  trooper: 1,           // 27mm round ≈ 1.06"
  heavy: 1.25,          // 50mm round
  vehicle: 2,           // ~50x80mm notch base
  emplacement: 1.5,
  marker: 0.6,
  objective: 1.2,
};

// --- Deployment zone presets ---------------------------------------------
// Geometric play aids rendered on the mat — not exact AMG deployment-card
// shapes, but close enough to set up a fair game. Depth scales down on
// small boards so the zones never overlap.
export type DeploymentKey = "long-edges" | "short-edges" | "corners";

export const DEPLOYMENTS: Record<DeploymentKey, string> = {
  "long-edges": "Long edges",
  "short-edges": "Short edges",
  corners: "Opposite corners",
};

export type Zone = { x: number; y: number; w: number; h: number };

export function deploymentZones(
  key: DeploymentKey,
  map: MapSize,
): { blue: Zone; red: Zone } {
  const W = map.widthInches;
  const H = map.heightInches;
  const depth = Math.min(12, Math.floor(Math.min(W, H) / 3));
  switch (key) {
    case "long-edges":
      return {
        blue: { x: 0, y: 0, w: W, h: depth },
        red: { x: 0, y: H - depth, w: W, h: depth },
      };
    case "short-edges":
      return {
        blue: { x: 0, y: 0, w: depth, h: H },
        red: { x: W - depth, y: 0, w: depth, h: H },
      };
    case "corners":
      return {
        blue: { x: 0, y: 0, w: W * 0.4, h: H * 0.4 },
        red: { x: W * 0.6, y: H * 0.6, w: W * 0.4, h: H * 0.4 },
      };
  }
}

// --- Persistence ------------------------------------------------------------
// The whole board auto-saves so closing the Tabletop (or the tab) doesn't
// lose a game in progress.
const STORAGE_KEY = "legion-builder.tabletop.v1";

export function loadTabletop(): TabletopState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TabletopState>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.tokens)) {
      return null;
    }
    // Merge over fresh defaults so states saved by older versions of the
    // app pick up new fields (round, vp, deployment, ...).
    const base = newTabletop(parsed.gameType ?? "standard");
    return {
      ...base,
      ...parsed,
      map: { ...base.map, ...(parsed.map ?? {}) },
      vp: { ...base.vp, ...(parsed.vp ?? {}) },
    };
  } catch {
    return null;
  }
}

export function saveTabletop(s: TabletopState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Quota exceeded / private browsing — losing autosave isn't fatal.
  }
}

// --- ID helper ------------------------------------------------------------
export function newId(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

// --- Spawning helpers -----------------------------------------------------
// Pure functions that take a state and return a new state with one item
// added at the center of the map. Kept here (not in the canvas component)
// so the canvas file only exports React components.

export function addToken(state: TabletopState, partial: Partial<Token> = {}): TabletopState {
  const t: Token = {
    id: newId("tk"),
    kind: "unit",
    x: state.map.widthInches / 2 - 1,
    y: state.map.heightInches / 2 - 1,
    size: 1,
    label: "Unit",
    color: "neutral",
    ...partial,
  };
  return { ...state, tokens: [...state.tokens, t] };
}

export function addTerrain(state: TabletopState, partial: Partial<Terrain> = {}): TabletopState {
  const t: Terrain = {
    id: newId("tr"),
    shape: "rect",
    x: state.map.widthInches / 2 - 3,
    y: state.map.heightInches / 2 - 1.5,
    width: 6,
    height: 3,
    rotation: 0,
    label: "",
    kind: "rock",
    ...partial,
  };
  return { ...state, terrain: [...state.terrain, t] };
}

// --- Unit -> token helpers -----------------------------------------------
// Pick a base size based on the unit's catalog type/rank. Trooper units get
// 1", heavies 1.25", vehicles 2", emplacements 1.5".
type UnitLike = { id: string; name: string; faction: string; type: string; rank: string };

export function unitBaseSize(unit: UnitLike): number {
  if (unit.type === "ground-vehicle" || unit.type === "repulsor-vehicle") return BASE_SIZE.vehicle ?? 2;
  if (unit.type === "emplacement-trooper") return BASE_SIZE.emplacement ?? 1.5;
  if (unit.rank === "heavy") return BASE_SIZE.heavy ?? 1.25;
  return BASE_SIZE.trooper ?? 1;
}

export function addTokenForUnit(
  state: TabletopState,
  unit: UnitLike,
  portraitUrl: string | null,
  position?: { x: number; y: number },
): TabletopState {
  const size = unitBaseSize(unit);
  const partial: Partial<Token> = {
    unitId: unit.id,
    label: unit.name,
    color: unit.faction as FactionColor,
    size,
  };
  if (portraitUrl) partial.portraitUrl = portraitUrl;
  // Vehicles care about facing; give them an arrow from the start.
  if (unit.type === "ground-vehicle" || unit.type === "repulsor-vehicle") {
    partial.rotation = 0;
  }
  if (position) { partial.x = position.x - size / 2; partial.y = position.y - size / 2; }
  return addToken(state, partial);
}
