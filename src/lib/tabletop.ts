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
  /** True if the unit has an order this round (independent of activation).
   * Cleared by "End round". */
  ordered?: boolean;
  /** Which side this token belongs to for status tallies. Defaults derived
   * from color (rebels/republic = blue, imperials/separatists = red, etc.)
   * if not set explicitly. */
  side?: "blue" | "red";
};

// --- Movement templates ---------------------------------------------------
// Legion uses jointed movement templates (60mm per "speed" segment, ~15mm
// wide). The official ones bend independently at every joint. We model the
// same shape: an anchor point on the token and one angle per segment.
//
// Real templates are 60mm = 2.36"; we round to 2.5" so dimensions feel
// natural on an inch-based grid. Players can compare against a physical
// template by counting segments rather than reading off exact inches.
export const TEMPLATE_SEGMENT_INCHES = 2.5;
export const TEMPLATE_WIDTH_INCHES = 0.6;

export type MoveTemplate = {
  /** Token the template is attached to. */
  tokenId: string;
  /** 1, 2, or 3 segments — matches the speed value. */
  speed: 1 | 2 | 3;
  /** Per-segment heading in degrees, where 0 = up. Each segment is
   * independent (segment N starts at the end of segment N-1; its heading
   * is angles[N]). Defaults to [0, 0, 0]. */
  angles: number[];
};

/** Walk the joints starting from `anchor`, returning every point along
 * the template (start, joint1, joint2, ..., end). Used by the canvas to
 * render and by the panel to compute where Apply moves the token. */
export function templatePoints(
  anchor: { x: number; y: number },
  angles: number[],
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [{ ...anchor }];
  let p = { ...anchor };
  for (const deg of angles) {
    const rad = (deg * Math.PI) / 180;
    p = {
      x: p.x + Math.sin(rad) * TEMPLATE_SEGMENT_INCHES,
      y: p.y - Math.cos(rad) * TEMPLATE_SEGMENT_INCHES,
    };
    pts.push({ ...p });
  }
  return pts;
}

export type TabletopState = {
  gameType: GameType;
  map: MapSize;
  terrain: Terrain[];
  tokens: Token[];
  round: number;
  vp: { blue: number; red: number };
  deployment: DeploymentKey | null;
  /** Only one template at a time — like having one template in hand. */
  moveTemplate: MoveTemplate | null;
  /** Command-card hand state per side. Each entry tracks pip + played. */
  hands: { blue: CommandHand; red: CommandHand };
};

export type CommandCard = {
  /** 1..4 — the activation pip count. */
  pips: number;
  /** True once the user has marked the card as played this game. */
  played: boolean;
};

export type CommandHand = {
  /** The seven cards in hand; the standard Legion deck is 1,1,2,2,3,3,4. */
  cards: CommandCard[];
  /** Index of the card the player set as their pick this round, or null. */
  thisRound: number | null;
};

export function newCommandHand(): CommandHand {
  return {
    cards: [1, 1, 2, 2, 3, 3, 4].map((pips) => ({ pips, played: false })),
    thisRound: null,
  };
}

export function newTabletop(gameType: GameType = "standard"): TabletopState {
  return {
    gameType,
    map: { ...GAME_TYPES[gameType].size },
    terrain: [],
    tokens: [],
    round: 1,
    vp: { blue: 0, red: 0 },
    deployment: null,
    moveTemplate: null,
    hands: { blue: newCommandHand(), red: newCommandHand() },
  };
}

// Heuristic for which side a token belongs to when not set explicitly.
// Rebels and Republic default to Blue (the "good guys"); Imperials and
// Separatists to Red; everything else stays neutral.
export function tokenSide(t: Token): "blue" | "red" | "neutral" {
  if (t.side) return t.side;
  if (t.color === "rebels" || t.color === "republic") return "blue";
  if (t.color === "imperials" || t.color === "separatists") return "red";
  return "neutral";
}

/** The point on a token's edge where its movement template is anchored
 * (the front of the base, given its facing). */
export function templateAnchor(token: Token): { x: number; y: number } {
  const cx = token.x + token.size / 2;
  const cy = token.y + token.size / 2;
  const r = token.size / 2;
  const rad = ((token.rotation ?? 0) * Math.PI) / 180;
  return { x: cx + Math.sin(rad) * r, y: cy - Math.cos(rad) * r };
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
    // app pick up new fields (round, vp, deployment, moveTemplate, hands, ...).
    const base = newTabletop(parsed.gameType ?? "standard");
    return {
      ...base,
      ...parsed,
      map: { ...base.map, ...(parsed.map ?? {}) },
      vp: { ...base.vp, ...(parsed.vp ?? {}) },
      // Movement templates are transient — drop any that got serialized.
      moveTemplate: null,
      hands: parsed.hands
        ? {
            blue: { ...base.hands.blue, ...parsed.hands.blue, cards: parsed.hands.blue?.cards ?? base.hands.blue.cards },
            red:  { ...base.hands.red,  ...parsed.hands.red,  cards: parsed.hands.red?.cards  ?? base.hands.red.cards },
          }
        : base.hands,
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
