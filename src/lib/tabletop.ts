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
  /** Optional small badge text (e.g. wound count, suppression). */
  badge?: string;
};

export type TabletopState = {
  gameType: GameType;
  map: MapSize;
  terrain: Terrain[];
  tokens: Token[];
};

export function newTabletop(gameType: GameType = "standard"): TabletopState {
  return {
    gameType,
    map: { ...GAME_TYPES[gameType].size },
    terrain: [],
    tokens: [],
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
// For now we describe deployment as zones the player visualizes themselves;
// future phases can render these on the canvas.
export type DeploymentZone = {
  name: string;
  blue: { x: number; y: number; w: number; h: number };
  red:  { x: number; y: number; w: number; h: number };
};

export function defaultDeployment(map: MapSize): DeploymentZone {
  // Long edges, 12" deep each side, leaving a 12" neutral strip down the
  // middle for a 36"-tall board (matches Standard play).
  return {
    name: "Long edges",
    blue: { x: 0, y: 0, w: map.widthInches, h: 12 },
    red:  { x: 0, y: map.heightInches - 12, w: map.widthInches, h: 12 },
  };
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
