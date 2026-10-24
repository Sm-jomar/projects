// Legion status tokens (aim, dodge, suppression, ion, ...) on tabletop
// units. Tokens belong to the unit, so when a token is in a squad (see
// lib/squads) every member carries the same counts: applying a token to
// one member applies it to the whole squad, and a unit that joins a squad
// pools its tokens with the squad's.
//
// Info text and token art come from Legion Helper (RULES_URL), the
// community rules reference for the current (2024) rules, trimmed to a
// sentence or two. Each token links to its own page there.

import type { Rank } from "./types";
import type { TabletopState, Token } from "./tabletop";

export const RULES_URL = "https://legion.takras.net";
const rules = (page: string) => `${RULES_URL}/${page}/`;

export type StatusId =
  | "aim" | "dodge" | "surge" | "standby" | "observation"
  | "suppression" | "panic" | "ion" | "immobilize" | "poison" | "shield" | "stagger"
  | "wheelMode" | "incognito" | "commander"
  | "vehicleDamage";

export type StatusGroup = "green" | "status" | "vehicle";

export type StatusDef = {
  id: StatusId;
  label: string;
  group: StatusGroup;
  /** Token art in public/tokens, or a glyph chip when there's none. */
  icon?: string;
  glyph: string;
  color: string;
  /** Most a unit can hold (standby, vehicle damage, ... are one at a time). */
  max?: number;
  /** Removed in the End Phase ("End round"). */
  endPhase?: boolean;
  info: string;
  /** Rules page for the token. */
  url: string;
};

export const STATUS_GROUPS: { id: StatusGroup; label: string }[] = [
  { id: "green", label: "Green tokens" },
  { id: "status", label: "Status tokens" },
  { id: "vehicle", label: "Vehicle" },
];

const icon = (name: string) => `/tokens/${name}.png`;

export const STATUS_TOKENS: StatusDef[] = [
  { id: "aim", label: "Aim", group: "green", icon: icon("aim"), glyph: "⌖", color: "#4fd06b", endPhase: true, url: rules("aim"),
    info: "Spend while attacking to reroll up to two attack dice per token. Gained with the Aim action. Green token: removed in the End Phase." },
  { id: "dodge", label: "Dodge", group: "green", icon: icon("dodge"), glyph: "⬡", color: "#4fd06b", endPhase: true, url: rules("dodge"),
    info: "Spend while defending to cancel one hit result per token. Gained with the Dodge action. Green token: removed in the End Phase." },
  { id: "surge", label: "Surge", group: "green", icon: icon("surge"), glyph: "◆", color: "#4fd06b", endPhase: true, url: rules("surge_token"),
    info: "Spend while attacking or defending to convert a surge result to a hit or a block. Gained from Reliable X, Bolster X, and cards. Green token: removed in the End Phase." },
  { id: "standby", label: "Standby", group: "green", icon: icon("standby"), glyph: "S", color: "#4fd06b", max: 1, endPhase: true, url: rules("standby"),
    info: "After an enemy unit within 2 and in line of sight attacks, moves, or performs an action, spend it for a free Move or Attack action. One at a time; lost if the unit moves, attacks, acts, or gains suppression. Removed in the End Phase." },
  { id: "observation", label: "Observation", group: "green", icon: icon("observation"), glyph: "◉", color: "#4fd06b", endPhase: true, url: rules("observe_x"),
    info: "Placed on an enemy unit by Observe X. A friendly unit attacking it may spend them to reroll one attack die each. Removed in the End Phase." },

  { id: "suppression", label: "Suppression", group: "status", glyph: "!", color: "#ffb02e", url: rules("suppression"),
    info: "At suppression equal to its courage a trooper unit is Suppressed (1 fewer action); at double its courage it is Panicked. Roll a white die per token to Rally at activation. One is removed in the End Phase." },
  { id: "panic", label: "Panic", group: "status", glyph: "✕", color: "#ff5a5a", max: 1, url: rules("rally"),
    info: "A unit with suppression at or above double its courage is Panicked: it makes no actions or free actions, then removes suppression equal to its courage. In the 2024 rules this is a state, not a token; mark it here to keep track." },
  { id: "ion", label: "Ion", group: "status", icon: icon("ion"), glyph: "ϟ", color: "#5aa8ff", url: rules("ion_x"),
    info: "Gained by vehicles and droid troopers wounded by an Ion X weapon. At the start of its activation, roll a white die per token; on any blank it makes 1 fewer action. Removed at the end of its activation." },
  { id: "immobilize", label: "Immobilize", group: "status", icon: icon("immobilize"), glyph: "⊗", color: "#ff5a5a", url: rules("immobilize_x"),
    info: "Gained when wounded by an Immobilize X weapon. Speed is reduced by 1 per token when moving; at speed 0 the unit cannot move. Removed at the end of its activation." },
  { id: "poison", label: "Poison", group: "status", icon: icon("poison"), glyph: "☠", color: "#d6d63c", url: rules("poison_x"),
    info: "Gained by non-droid troopers wounded by a Poison X weapon. At the end of its activation the unit suffers 1 wound per token, then removes them all." },
  { id: "shield", label: "Shield", group: "status", icon: icon("shield"), glyph: "◖", color: "#4dd8ff", url: rules("shielded_x"),
    info: "Shielded X units have X shield tokens, owned by the unit rather than a mini. While defending against a ranged attack, flip active shields to cancel 1 hit or crit each. Ion X flips them too." },
  { id: "stagger", label: "Stagger", group: "status", glyph: "≈", color: "#e39bff", url: rules("tokens"),
    info: "Not listed in the Legion Helper rules or on the Legion wiki, so there's no official text yet. Use it to track whatever card or house rule applied it." },
  { id: "wheelMode", label: "Wheel Mode", group: "status", icon: icon("wheel-mode"), glyph: "◎", color: "#f0a830", max: 1, endPhase: true, url: rules("wheel_mode"),
    info: "Droidekas using Wheel Mode: speed 3, AI: Move, and Cover 2 until the end of the round, but they can't attack or flip shields." },
  { id: "incognito", label: "Incognito", group: "status", icon: icon("incognito"), glyph: "?", color: "#e05a7a", max: 1, url: rules("incognito"),
    info: "Can't be attacked by enemies that aren't within 1, can't contest objectives, and can't provide Backup. Lost for the rest of the game once the unit attacks or defends." },
  { id: "commander", label: "Commander", group: "status", icon: icon("commander"), glyph: "★", color: "#f0a830", max: 1, url: rules("field_commander"),
    info: "Marks the active commander, such as a Field Commander or a unit promoted after the last commander was defeated." },

  { id: "vehicleDamage", label: "Vehicle damage", group: "vehicle", icon: icon("vehicle-damage"), glyph: "✸", color: "#ff8a5a", max: 1, url: rules("resiliency"),
    info: "Gained once per game when a vehicle's wounds reach its resilience. At the start of its activation roll a white die; on a blank it makes 1 fewer action." },
];

export const STATUS_BY_ID = Object.fromEntries(STATUS_TOKENS.map((d) => [d.id, d])) as Record<StatusId, StatusDef>;

/** Rules text for the counters that aren't status tokens. */
export const WOUND_INFO = "Wounds are assigned to one mini at a time until it reaches its wound threshold and is defeated, so they stay on this token rather than the whole squad.";
export const WOUND_URL = rules("wounds");
export const ORDER_INFO = "When a unit is issued an order in the Command Phase, place a faceup order token matching its rank next to it. One order per unit each round; it's flipped facedown when the unit activates.";
export const ORDER_URL = rules("issue_order");
export const ORDER_ICON = icon("order");

export const RANK_LABEL: Record<Rank, string> = {
  commander: "Commander", operative: "Operative", corps: "Corps",
  "special-forces": "Special Forces", support: "Support", heavy: "Heavy",
};

export type StatusCounts = Partial<Record<StatusId, number>>;

/** How many of a status token this unit has. Suppression lives in the
 * older `suppression` field so existing boards keep their counts. */
export function statusCount(tk: Token, id: StatusId): number {
  return (id === "suppression" ? tk.suppression : tk.status?.[id]) ?? 0;
}

/** Every status token on the unit with a count above zero, in list order. */
export function activeStatus(tk: Token): { def: StatusDef; count: number }[] {
  return STATUS_TOKENS.map((def) => ({ def, count: statusCount(tk, def.id) })).filter((s) => s.count > 0);
}

function withCount(tk: Token, id: StatusId, n: number): Token {
  const v = Math.max(0, Math.min(n, STATUS_BY_ID[id].max ?? Infinity));
  if (id === "suppression") return { ...tk, suppression: v };
  const status = { ...tk.status };
  if (v > 0) status[id] = v; else delete status[id];
  return { ...tk, status: Object.keys(status).length ? status : undefined };
}

const sameUnit = (a: Token, b: Token) => a.id === b.id || (!!a.squadId && a.squadId === b.squadId);

/** Set a status token's count on a unit, and on every member of its squad. */
export function setStatus(state: TabletopState, tokenId: string, id: StatusId, n: number): TabletopState {
  const tk = state.tokens.find((t) => t.id === tokenId);
  if (!tk) return state;
  return { ...state, tokens: state.tokens.map((t) => sameUnit(t, tk) ? withCount(t, id, n) : t) };
}

/** Give or take a unit's order token, for the whole squad. */
export function setOrdered(state: TabletopState, tokenId: string, ordered: boolean): TabletopState {
  const tk = state.tokens.find((t) => t.id === tokenId);
  if (!tk) return state;
  return { ...state, tokens: state.tokens.map((t) => sameUnit(t, tk) ? { ...t, ordered } : t) };
}

/** Pool the tokens of every member of a squad (the highest count of each
 * kind) and give the result to all of them. Used when a unit joins. */
export function poolSquadStatus(tokens: Token[], squadId: string): Token[] {
  const members = tokens.filter((t) => t.squadId === squadId);
  if (members.length < 2) return tokens;
  const pooled: StatusCounts = {};
  for (const def of STATUS_TOKENS) {
    const n = Math.max(...members.map((m) => statusCount(m, def.id)));
    if (n > 0) pooled[def.id] = n;
  }
  const ordered = members.some((m) => m.ordered);
  return tokens.map((t) => {
    if (t.squadId !== squadId) return t;
    let out: Token = { ...t, ordered, status: undefined, suppression: 0 };
    for (const [id, n] of Object.entries(pooled)) out = withCount(out, id as StatusId, n);
    return out;
  });
}

/** End Phase clean-up: drop green tokens (and Wheel Mode, which lasts the
 * round) and remove 1 suppression. */
export function endPhaseStatus(tk: Token): Token {
  let out = tk;
  for (const def of STATUS_TOKENS) if (def.endPhase) out = withCount(out, def.id, 0);
  return withCount(out, "suppression", statusCount(out, "suppression") - 1);
}

/** Whether a token draws its unit's status chips on the board. A squad
 * shows them once, for its leader. */
export function showsUnitStatus(tk: Token): boolean {
  return !tk.squadId || !!tk.squadLead;
}

export type StatusChip = { id: string; icon?: string; glyph: string; color: string; count: number };

/** What the board draws under a unit: its order token, then each status
 * token it holds. Empty for squad members other than the leader. */
export function statusChips(tk: Token): StatusChip[] {
  if (!showsUnitStatus(tk)) return [];
  return [
    ...(tk.ordered ? [{ id: "order", icon: ORDER_ICON, glyph: "◈", color: "#e9e4d4", count: 1 }] : []),
    ...activeStatus(tk).map(({ def, count }) => ({ id: def.id, icon: def.icon, glyph: def.glyph, color: def.color, count })),
  ];
}
