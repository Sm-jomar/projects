// Tabletop session model. Everything the canvas needs to render a game state.

import { logId, type LogActor, type LogEntry } from "./auditLog";
import { STATUS_TOKENS, type StatusCounts } from "./statusTokens";
import type { TableMusic } from "./media";
import { missionById, missionTerritories, type MissionId } from "./missions";
import type { OrderPools } from "./orderPool";
import { RANK_LABEL } from "./factions";
import type { AttackSeq } from "./attack";
import { COMMAND_BY_ID, STANDING_ORDERS, type CommandCardDef } from "./commandCards";

export type GameType = "skirmish" | "standard" | "grand-army" | "custom";

export type MapSize = { widthInches: number; heightInches: number };

export const GAME_TYPES: Record<GameType, { label: string; size: MapSize; defaultPoints: number; description: string }> = {
  skirmish:     { label: "Skirmish",    size: { widthInches: 36, heightInches: 36 }, defaultPoints: 500,  description: "3' × 3' — fast 500-point games" },
  standard:     { label: "Standard",    size: { widthInches: 72, heightInches: 36 }, defaultPoints: 800,  description: "6' × 3' — tournament play" },
  "grand-army": { label: "Grand Army",  size: { widthInches: 96, heightInches: 48 }, defaultPoints: 1500, description: "8' × 4' — big battles" },
  custom:       { label: "Custom",      size: { widthInches: 72, heightInches: 36 }, defaultPoints: 800,  description: "Pick your own size" },
};

/** A picture laid on the table as the map (a battle mat photo, a printed
 * map...). Drawn under deployment zones, the grid, terrain and tokens. */
export type MapImage = {
  /** JPEG data URL from an upload, or a pasted http(s) URL. */
  url: string;
  /** "stretch" fills the board exactly; "cover" keeps the picture's shape
   * and crops what overhangs the board. */
  fit: "stretch" | "cover";
  /** 0..0.8: darkens the picture so pieces stand out on a busy map. */
  dim: number;
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
  /** How tall the piece stands, in inches (3D view + hover clearance).
   * Undefined = the default for its kind (TERRAIN_ELEVATION). */
  elevation?: number;
  /** Floats this many inches off the table (3D view): floating rocks,
   * gantries, upper floors. Undefined / 0 = on the ground. */
  float?: number;
  /** Uploaded STL in TabletopState.models, shown in 3D instead of the block. */
  modelId?: string;
};

/** An uploaded STL (lib/stlModel encoding). Stored once per board and
 * referenced by id, so a squad of identical minis costs one model. */
export type BoardModel = { name: string; data: string };

// Default terrain heights in inches. A hovering or flying unit (Speeder,
// Hover: Air, repulsor craft) clears terrain whose height is at or below
// its own elevation; anything taller blocks it.
export const TERRAIN_ELEVATION: Record<Terrain["kind"], number> = {
  barricade: 1,
  wall: 2,
  rock: 1.5,
  forest: 4,
  building: 5,
  objective: 0.25,
};

export function terrainElevation(t: Terrain): number {
  return t.elevation ?? TERRAIN_ELEVATION[t.kind];
}

/** Whether a unit flying at `fly` inches gets past this terrain. Floating
 * terrain never stops it: it passes underneath, or lands on top once it
 * reaches the underside. Grounded terrain must be no taller than `fly`. */
export function terrainClears(t: Terrain, fly: number): boolean {
  return (t.float ?? 0) > 0 || terrainElevation(t) <= fly;
}

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
  /** Height the unit flies/hovers above the surface it's over, in inches.
   * 0 / undefined = on the ground. Repulsor vehicles get a default. */
  elevation?: number;
  /** Uploaded STL in TabletopState.models, shown in 3D instead of the
   * faction shape. */
  modelId?: string;
  /** Squad this token is bundled into (see lib/squads). Squads are base
   * locked: every member must link back to the leader by base contact. */
  squadId?: string;
  /** True on the squad leader; moving the leader carries the squad. */
  squadLead?: boolean;
  /** Status tokens (aim, dodge, ion, ...) by kind, see lib/statusTokens.
   * Suppression is kept in `suppression` above. Squad members share them. */
  status?: StatusCounts;
  /** The army-list entry this mini was deployed from (ArmyEntry.entryId),
   * so the deploy tray knows which squads are already on the table. */
  armyEntryId?: string;
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
  /** Map picture under everything else, or null for the plain table. */
  mapImage?: MapImage | null;
  terrain: Terrain[];
  tokens: Token[];
  round: number;
  vp: { blue: number; red: number };
  deployment: DeploymentKey | null;
  /** Battle Card mission (Objective + Map Card); when set, its Territories
   * replace the deployment preset. */
  mission?: MissionId | null;
  /** Secondary Objective Card name (reference only; no fixed tokens). */
  secondary?: string | null;
  /** Only one template at a time — like having one template in hand. */
  moveTemplate: MoveTemplate | null;
  /** Command-card hand state per side. Each entry tracks pip + played. */
  hands: { blue: CommandHand; red: CommandHand };
  /** Shared audit log (synced + persisted with the board). */
  log?: LogEntry[];
  /** Uploaded 3D models, keyed by id (see Token/Terrain.modelId). */
  models?: Record<string, BoardModel>;
  /** Table music: the YouTube playlist both players hear. */
  music?: TableMusic | null;
  /** Each player's order token pool (see lib/orderPool). */
  orders?: OrderPools;
  /** Roll-off for priority when both revealed cards have the same pips. */
  priorityRoll?: { blue: number; red: number } | null;
  /** The attack being rolled now, or the last one (see lib/attack). */
  attack?: AttackSeq | null;
  /** Set when the game is over (round 6 ended or a side was wiped out). */
  result?: GameResult | null;
};

export type GameResult = { winner: "blue" | "red" | "draw"; text: string };

/** Drop models no token or terrain refers to any more. */
export function pruneModels(s: TabletopState): TabletopState {
  if (!s.models) return s;
  const used = new Set<string>();
  for (const t of s.tokens) if (t.modelId) used.add(t.modelId);
  for (const t of s.terrain) if (t.modelId) used.add(t.modelId);
  const kept = Object.fromEntries(Object.entries(s.models).filter(([id]) => used.has(id)));
  return Object.keys(kept).length === Object.keys(s.models).length ? s : { ...s, models: kept };
}

export type CommandCard = {
  /** 1..4 — the activation pip count. */
  pips: number;
  /** True once the user has marked the card as played this game. */
  played: boolean;
  /** The real card (commandCards.ts id) when the hand was picked from a
   * list; a bare pip card otherwise. */
  id?: string;
  name?: string;
};

export type CommandHand = {
  /** The seven cards in hand; the standard Legion deck is 1,1,2,2,3,3,4. */
  cards: CommandCard[];
  /** Index of the card the player revealed this round, or null. Only set
   * once both players have locked in (see `locked`). */
  thisRound: number | null;
  /** The player has locked in a card, face down. Which card stays on the
   * player's own device until both sides have locked in. */
  locked?: boolean;
  /** The list the cards were picked for. */
  listName?: string;
};

export function newCommandHand(): CommandHand {
  return {
    cards: [1, 1, 2, 2, 3, 3, 4].map((pips) => ({ pips, played: false })),
    thisRound: null,
  };
}

/** A hand of picked command cards (ids from commandCards.ts), lowest pips
 * first, plus Standing Orders. */
export function handFromCards(ids: string[], listName: string): CommandHand {
  const cards = ids.map((id) => COMMAND_BY_ID.get(id)).filter((c): c is CommandCardDef => !!c)
    .sort((a, b) => a.pips - b.pips || a.name.localeCompare(b.name));
  return {
    cards: [...cards, STANDING_ORDERS].map((c) => ({ pips: c.pips, played: false, id: c.id, name: c.name })),
    thisRound: null,
    listName,
  };
}

/** The same cards, all back in hand (a new game). */
export function freshHand(h: CommandHand): CommandHand {
  return { ...h, cards: h.cards.map((c) => ({ ...c, played: false })), thisRound: null, locked: false };
}

/** Standing Orders goes back to hand after it's played. */
export const isStandingOrders = (c: CommandCard) => c.id ? c.id === STANDING_ORDERS.id : c.pips === 4;

/** Both players have locked in a card this round. */
export const bothLocked = (s: Pick<TabletopState, "hands">) => !!s.hands.blue.locked && !!s.hands.red.locked;

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
    log: [],
  };
}

// Diff two Legion boards into audit-log entries. Covers token moves (with
// from/to for ghost replay), adds/removes, wound and status token changes, VP
// and round changes. Positions are in inches.
export function diffLegion(prev: TabletopState, next: TabletopState, actor: LogActor): LogEntry[] {
  const out: LogEntry[] = [];
  const prevById = new Map(prev.tokens.map((t) => [t.id, t]));
  const nextById = new Map(next.tokens.map((t) => [t.id, t]));
  const mk = (kind: LogEntry["kind"], text: string, move?: LogEntry["move"]): LogEntry =>
    ({ id: logId(), ts: Date.now(), actor, kind, text, ...(move ? { move } : {}) });

  for (const t of next.tokens) {
    const p = prevById.get(t.id);
    if (!p) {
      // A squad deployed in one go is logged once, on its leader.
      const fresh = t.squadId ? next.tokens.filter((o) => o.squadId === t.squadId && !prevById.has(o.id)) : [];
      if (fresh.length > 1) {
        if (t.squadLead) out.push(mk("add", `deployed ${t.label || "a squad"} (${fresh.length} minis)`));
      } else out.push(mk("add", `added ${t.label || "a token"}`));
      continue;
    }
    if (p.x !== t.x || p.y !== t.y) {
      out.push(mk("move", `moved ${t.label || "a token"}`, {
        from: { x: p.x, y: p.y }, to: { x: t.x, y: t.y }, size: t.size, color: FACTION_STROKE[t.color],
      }));
    }
    if ((p.wounds ?? 0) !== (t.wounds ?? 0)) {
      const d = (t.wounds ?? 0) - (p.wounds ?? 0);
      out.push(mk("hp", `${t.label || "token"} wounds ${d >= 0 ? "+" : ""}${d}`));
    }
    // A squad shares its status tokens, so log them once, on the leader.
    if (t.squadId && !t.squadLead) continue;
    for (const def of STATUS_TOKENS) {
      const key = def.id === "suppression" ? undefined : def.id;
      const was = (key ? p.status?.[key] : p.suppression) ?? 0;
      const now = (key ? t.status?.[key] : t.suppression) ?? 0;
      if (was === now) continue;
      const d = now - was;
      out.push(mk("hp", `${t.label || "token"} ${def.label.toLowerCase()} ${d >= 0 ? "+" : ""}${d}`));
    }
  }
  for (const p of prev.tokens) {
    if (!nextById.has(p.id)) out.push(mk("remove", `removed ${p.label || "a token"}`));
  }
  if (prev.vp.blue !== next.vp.blue) out.push(mk("vp", `Blue VP → ${next.vp.blue}`));
  if (prev.vp.red !== next.vp.red) out.push(mk("vp", `Red VP → ${next.vp.red}`));
  if (prev.round !== next.round) out.push(mk("round", `advanced to round ${next.round}`));
  for (const side of ["blue", "red"] as const) {
    const was = new Map((prev.orders?.[side]?.tokens ?? []).map((t) => [t.id, t]));
    for (const t of next.orders?.[side]?.tokens ?? []) {
      const p = was.get(t.id);
      if (!p) continue;
      const name = side === "blue" ? "Blue" : "Red";
      if (t.used && !p.used) {
        const unit = next.orders![side]!.tokens.find((o) => o.entryId === t.assignedTo)?.unitName ?? "a unit";
        out.push(mk("turn", `${name} drew a ${RANK_LABEL[t.rank]} order token for ${unit}`));
      }
      if (t.out && !p.out) out.push(mk("turn", `${name} took a ${RANK_LABEL[t.rank]} order token out of the game`));
    }
  }
  return out;
}

// Faction ring colors, reused for ghost-replay tinting and the 3D view.
export const FACTION_STROKE: Record<FactionColor, string> = {
  rebels: "#f6c14a", imperials: "#9bc1ec", republic: "#f6c14a",
  separatists: "#c19be0", mercenary: "#e0c477", neutral: "#888",
};

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

/** Blue and red Territories to shade on the mat: the mission's Map Card
 * when one is chosen, else the deployment preset, else none. */
export function territories(s: Pick<TabletopState, "deployment" | "mission" | "map">): { blue: Zone[]; red: Zone[] } | null {
  const m = missionById(s.mission);
  if (m) return missionTerritories(m, s.map);
  if (!s.deployment) return null;
  const z = deploymentZones(s.deployment, s.map);
  return { blue: [z.blue], red: [z.red] };
}

// --- Range ------------------------------------------------------------------
// Legion's Range Tool is built from 6" segments: Range 1 is up to 6",
// Range 2 up to 12" ... Range 5 up to 30", plus a 3" Half-Range Tool.
export const RANGE_INCHES = 6;
export const MAX_RANGE = 5;

/** The Range band a distance falls in, e.g. "range ½", "range 3",
 * "beyond range 5". */
export function rangeBand(inches: number): string {
  if (inches <= RANGE_INCHES / 2) return "range ½";
  const r = Math.ceil(inches / RANGE_INCHES - 1e-9);
  return r > MAX_RANGE ? `beyond range ${MAX_RANGE}` : `range ${r}`;
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

// Serialized size, measured the way the room server enforces its
// MAX_STATE_BYTES cap (JSON string length). Leave headroom under 2,000,000.
export function boardBytes(s: TabletopState): number {
  return JSON.stringify(s).length;
}
export const BOARD_BYTES_SAFE = 1_850_000;

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

// Repulsor craft and speeder bikes hover; airspeeders fly well above the table. Values are
// inches and line up with TERRAIN_ELEVATION: a speeder bike (1.5") skims
// over barricades and rocks but not walls or buildings.
export function defaultUnitElevation(unit: UnitLike): number {
  if (unit.type !== "repulsor-vehicle" && unit.type !== "ground-vehicle") return 0;
  if (/airspeeder|gunship/i.test(unit.name)) return 4;
  // Some speeders are catalogued as ground vehicles; catch them by name.
  if (unit.type === "repulsor-vehicle" || /speeder|swoop|stap|barc/i.test(unit.name)) return 1.5;
  return 0;
}

/** Token fields for one mini of a catalog unit: label, faction colour,
 * base size, card portrait, facing for vehicles and hover height. */
export function unitTokenFields(unit: UnitLike, portraitUrl: string | null): Partial<Token> {
  const partial: Partial<Token> = {
    unitId: unit.id,
    label: unit.name,
    color: unit.faction as FactionColor,
    size: unitBaseSize(unit),
  };
  if (portraitUrl) partial.portraitUrl = portraitUrl;
  // Vehicles care about facing; give them an arrow from the start.
  if (unit.type === "ground-vehicle" || unit.type === "repulsor-vehicle") {
    partial.rotation = 0;
  }
  const lift = defaultUnitElevation(unit);
  if (lift) partial.elevation = lift;
  return partial;
}

export function addTokenForUnit(
  state: TabletopState,
  unit: UnitLike,
  portraitUrl: string | null,
  position?: { x: number; y: number },
): TabletopState {
  const partial = unitTokenFields(unit, portraitUrl);
  const size = partial.size!;
  if (position) { partial.x = position.x - size / 2; partial.y = position.y - size / 2; }
  return addToken(state, partial);
}
