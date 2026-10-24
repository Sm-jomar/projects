// D&D 5e conditions (blinded, charmed, ... unconscious) on tabletop
// tokens. Anyone who can move pieces can set them: the DM on monsters,
// players on their own PCs. Each condition has a colour, and the token's
// base ring is split into those colours on the 2D map and in 3D.
//
// Rules text follows the 2014 Basic Rules, Appendix A (D&D Beyond), which
// matches the SRD on Roll20, trimmed to the parts that matter at the table.

import type { DndToken } from "./dndTabletop";

export const CONDITIONS_URL = "https://www.dndbeyond.com/sources/dnd/basic-rules-2014/appendix-a-conditions";

export type ConditionId =
  | "blinded" | "charmed" | "deafened" | "exhaustion" | "frightened"
  | "grappled" | "incapacitated" | "invisible" | "paralyzed" | "petrified"
  | "poisoned" | "prone" | "restrained" | "stunned" | "unconscious";

export type ConditionDef = {
  id: ConditionId;
  label: string;
  color: string;
  info: string;
  /** Conditions this one brings with it (paralyzed → incapacitated). */
  includes?: ConditionId[];
  url: string;
};

const rules = (anchor: string) => `${CONDITIONS_URL}#${anchor}`;

export const EXHAUSTION_MAX = 6;

export const EXHAUSTION_LEVELS = [
  "Disadvantage on ability checks",
  "Speed halved",
  "Disadvantage on attack rolls and saving throws",
  "Hit point maximum halved",
  "Speed reduced to 0",
  "Death",
];

export const CONDITIONS: ConditionDef[] = [
  { id: "blinded", label: "Blinded", color: "#b0bec5", url: rules("Blinded"),
    info: "Can't see and automatically fails any ability check that requires sight. Attack rolls against it have advantage; its attack rolls have disadvantage." },
  { id: "charmed", label: "Charmed", color: "#f06292", url: rules("Charmed"),
    info: "Can't attack the charmer or target them with harmful abilities or magical effects. The charmer has advantage on ability checks to interact socially with it." },
  { id: "deafened", label: "Deafened", color: "#26a69a", url: rules("Deafened"),
    info: "Can't hear and automatically fails any ability check that requires hearing." },
  { id: "exhaustion", label: "Exhaustion", color: "#ff9800", url: rules("Exhaustion"),
    info: "Measured in six levels, and each level adds to the ones before: 1 disadvantage on ability checks, 2 speed halved, 3 disadvantage on attacks and saves, 4 HP maximum halved, 5 speed 0, 6 death. A long rest with food and drink removes one level." },
  { id: "frightened", label: "Frightened", color: "#ab47bc", url: rules("Frightened"),
    info: "Disadvantage on ability checks and attack rolls while the source of its fear is in line of sight. Can't willingly move closer to the source." },
  { id: "grappled", label: "Grappled", color: "#c6a700", url: rules("Grappled"),
    info: "Speed becomes 0 and can't benefit from bonuses to speed. Ends if the grappler is incapacitated, or an effect moves it out of the grappler's reach." },
  { id: "incapacitated", label: "Incapacitated", color: "#607d8b", url: rules("Incapacitated"),
    info: "Can't take actions or reactions." },
  { id: "invisible", label: "Invisible", color: "#e1f5fe", url: rules("Invisible"),
    info: "Impossible to see without magic or a special sense; heavily obscured for hiding, though noise and tracks can give away its location. Attack rolls against it have disadvantage; its attack rolls have advantage." },
  { id: "paralyzed", label: "Paralyzed", color: "#ffee58", includes: ["incapacitated"], url: rules("Paralyzed"),
    info: "Incapacitated, can't move or speak. Automatically fails Strength and Dexterity saves. Attacks against it have advantage, and any hit from within 5 feet is a critical hit." },
  { id: "petrified", label: "Petrified", color: "#795548", includes: ["incapacitated"], url: rules("Petrified"),
    info: "Turned to stone, weight ×10, stops aging. Incapacitated, can't move or speak, unaware of its surroundings. Attacks against it have advantage; auto-fails Strength and Dexterity saves; resistance to all damage; immune to poison and disease." },
  { id: "poisoned", label: "Poisoned", color: "#43a047", url: rules("Poisoned"),
    info: "Disadvantage on attack rolls and ability checks." },
  { id: "prone", label: "Prone", color: "#a1887f", url: rules("Prone"),
    info: "Can only crawl unless it stands up (costs half its speed). Disadvantage on attack rolls. Attacks against it have advantage from within 5 feet, disadvantage from farther away." },
  { id: "restrained", label: "Restrained", color: "#e53935", url: rules("Restrained"),
    info: "Speed becomes 0. Attack rolls against it have advantage; its attack rolls have disadvantage. Disadvantage on Dexterity saving throws." },
  { id: "stunned", label: "Stunned", color: "#29b6f6", includes: ["incapacitated"], url: rules("Stunned"),
    info: "Incapacitated, can't move, and can speak only falteringly. Automatically fails Strength and Dexterity saves. Attack rolls against it have advantage." },
  { id: "unconscious", label: "Unconscious", color: "#3949ab", includes: ["incapacitated", "prone"], url: rules("Unconscious"),
    info: "Incapacitated, can't move or speak, unaware of its surroundings. Drops what it's holding and falls prone. Auto-fails Strength and Dexterity saves. Attacks against it have advantage, and any hit from within 5 feet is a critical hit." },
];

const BY_ID = new Map(CONDITIONS.map((c) => [c.id, c]));
export const conditionDef = (id: ConditionId) => BY_ID.get(id)!;

/** The token's conditions in list order, with exhaustion when it has levels. */
export function tokenConditions(t: Pick<DndToken, "conditions" | "exhaustion">): ConditionDef[] {
  const on = new Set(t.conditions ?? []);
  return CONDITIONS.filter((c) => c.id === "exhaustion" ? (t.exhaustion ?? 0) > 0 : on.has(c.id));
}

/** Ring colours for the token's base, one per condition. */
export function conditionColors(t: Pick<DndToken, "conditions" | "exhaustion">): string[] {
  return tokenConditions(t).map((c) => c.color);
}

/** Short label for tooltips and the log: "Prone, Exhaustion 2". */
export function conditionSummary(t: Pick<DndToken, "conditions" | "exhaustion">): string {
  return tokenConditions(t).map((c) => c.id === "exhaustion" ? `Exhaustion ${t.exhaustion}` : c.label).join(", ");
}

/** Token patch that turns a condition on or off. Exhaustion uses levels. */
export function toggleCondition(t: DndToken, id: ConditionId, on: boolean): Partial<DndToken> {
  if (id === "exhaustion") return { exhaustion: on ? Math.max(1, t.exhaustion ?? 0) : undefined };
  const set = new Set(t.conditions ?? []);
  if (on) set.add(id); else set.delete(id);
  // Keep list order so every client renders the ring the same way.
  const next = CONDITIONS.map((c) => c.id).filter((c) => set.has(c));
  return { conditions: next.length ? next : undefined };
}

export function setExhaustion(level: number): Partial<DndToken> {
  const n = Math.max(0, Math.min(EXHAUSTION_MAX, Math.round(level)));
  return { exhaustion: n || undefined };
}

// SVG arc path for one slice of a ring centred on (cx, cy), from angle a0
// to a1 (radians, 0 = 12 o'clock, clockwise).
export function ringArc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const pt = (a: number) => `${cx + r * Math.sin(a)} ${cy - r * Math.cos(a)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${pt(a0)} A ${r} ${r} 0 ${large} 1 ${pt(a1)}`;
}
