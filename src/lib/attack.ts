// The Legion attack sequence, one step at a time, kept on the board so
// both players (and the AI seats) see the same dice:
//
//   declared  the attacker names the target and its weapons
//   rolled    attack dice are rolled; each aim token rerolls up to 2 dice
//   defend    Critical, surges, Armor/Impact and cover are applied; the
//             defender may spend dodge tokens, then rolls defense
//   done      blocks, Pierce, wounds and suppression go on the board and
//             the blaster effects play (see attackFx.ts)
//
// Simplified like the AI rules: line of sight isn't checked, cover comes
// from terrain between the units, and wounds go on one mini at a time.

import { unitById } from "../data/catalog";
import {
  rollAttack, rollDefense, tallyAttack,
  type AttackColor, type AttackFace, type AttackPool, type DefenseColor, type DefenseFace,
} from "./dice";
import { otherSide, poolsOf, type Side } from "./orderPool";
import { normalizeSquads } from "./squads";
import { tokenSide, type FactionColor, type TabletopState, type Token } from "./tabletop";
import type { Unit, Weapon } from "./types";
import { expectedWounds, keyword, weaponReaches } from "./ai/legionCombat";
import { center, coverAgainst, unitGap } from "./ai/legionGeometry";

/** One unit on the table: a list entry's minis (or a lone token). */
export type BoardUnit = { key: string; entryId?: string; side: Side; tokens: Token[]; lead: Token; unit: Unit | undefined; name: string };

export function boardUnits(s: TabletopState): BoardUnit[] {
  const groups = new Map<string, Token[]>();
  for (const t of s.tokens) {
    if (t.kind !== "unit") continue;
    const side = tokenSide(t);
    if (side === "neutral") continue;
    const key = unitKey(t);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const names = new Map<string, number>();
  const out: BoardUnit[] = [];
  for (const [key, tokens] of groups) {
    const lead = tokens.find((t) => t.squadLead) ?? tokens[0]!;
    const unit = lead.unitId ? unitById(lead.unitId) : undefined;
    const base = unit?.name ?? lead.label ?? "Unit";
    const n = (names.get(base) ?? 0) + 1;
    names.set(base, n);
    out.push({ key, entryId: tokens[0]!.armyEntryId, side: tokenSide(lead) as Side, tokens, lead, unit, name: n > 1 ? `${base} ${n}` : base });
  }
  return out;
}

export const unitKey = (t: Token) => t.armyEntryId ?? (t.squadId ? `sq:${t.squadId}` : `tk:${t.id}`);

/** The board unit a token belongs to. */
export function unitOfToken(s: TabletopState, id: string): BoardUnit | undefined {
  const tk = s.tokens.find((t) => t.id === id);
  return tk ? boardUnits(s).find((u) => u.key === unitKey(tk)) : undefined;
}

export function weaponsOf(u: Unit | undefined): Weapon[] {
  return (u?.weapons ?? []).filter((w) => w.dice && (w.dice.red || w.dice.black || w.dice.white));
}

/** Minis of the attacker that are in range of the target with this weapon. */
export function minisInReach(w: Weapon, attackers: Token[], targets: Token[]): number {
  return attackers.filter((a) => weaponReaches(w, unitGap([a], targets))).length;
}

export type WeaponPick = { name: string; minis: number };

/** The best weapon each mini can fire: all of them on the one weapon
 * expected to do the most wounds. */
export function defaultWeapons(s: TabletopState, att: BoardUnit, def: BoardUnit): WeaponPick[] {
  let best: { pick: WeaponPick; score: number } | null = null;
  const cover = coverAgainst(s, center(att.lead), def.tokens);
  for (const w of weaponsOf(att.unit)) {
    const minis = minisInReach(w, att.tokens, def.tokens);
    if (!minis) continue;
    const score = expectedWounds(poolOf([{ name: w.name, minis }], att.unit), def.unit, cover);
    if (!best || score > best.score) best = { pick: { name: w.name, minis }, score };
  }
  return best ? [best.pick] : [];
}

export function poolOf(picks: WeaponPick[], u: Unit | undefined): AttackPool {
  const pool = { red: 0, black: 0, white: 0 };
  for (const p of picks) {
    const w = weaponsOf(u).find((x) => x.name === p.name);
    if (!w) continue;
    pool.red += (w.dice.red ?? 0) * p.minis;
    pool.black += (w.dice.black ?? 0) * p.minis;
    pool.white += (w.dice.white ?? 0) * p.minis;
  }
  return pool;
}

export type AttackDie = {
  color: AttackColor;
  face: AttackFace;
  /** Rerolled with an aim token. */
  rerolled?: boolean;
  /** A surge turned into this face (by Critical or the unit's surge). */
  surged?: boolean;
};
export type DefenseDie = { color: DefenseColor; face: DefenseFace; surged?: boolean };

export type AttackStage = "declared" | "rolled" | "defend" | "done";

type Party = { key: string; name: string; side: Side; ids: string[]; color: FactionColor };

export type AttackSeq = {
  id: string;
  stage: AttackStage;
  /** When the last step happened (ms). */
  ts: number;
  /** Who declared it (a player or AI name). */
  by?: string;
  attacker: Party;
  defender: Party;
  weapons: WeaponPick[];
  pool: AttackPool;
  melee: boolean;
  dice: AttackDie[];
  /** Aim tokens the attacker still has to spend, and rerolls each gives. */
  aimLeft: number;
  aimSpent: number;
  rerollsPerAim: number;
  // From "defend" on:
  hits: number;
  crits: number;
  cover: number;
  coverCancel: number;
  armorCancel: number;
  dodgeAvail: number;
  dodgeSpent: number;
  /** Why dodge can't be used (High Velocity), if so. */
  noDodge?: string;
  // From "done" on:
  defense: DefenseDie[];
  blocks: number;
  pierce: number;
  wounds: number;
  defeated: number;
  wiped: boolean;
  /** Lines for the chat / log, and what each step did. */
  notes: string[];
  text?: string;
  fx?: AttackFx;
};

export type ShotKind = "crit" | "hit" | "block" | "armor" | "dodge" | "cover" | "miss";

/** What the blaster effects need, kept with the attack so every client
 * plays the same show after the minis it hit are gone. */
export type AttackFx = {
  melee: boolean;
  color: string;
  from: { id: string; x: number; y: number }[];
  to: { id: string; x: number; y: number; size: number; color: FactionColor; label: string; portrait?: string; defeated: boolean }[];
  /** One per attack die: which mini fired it and which it went at. */
  shots: { kind: ShotKind; from: number; to: number }[];
};

const pl = (n: number, w: string) => `${n} ${n === 1 ? w : w.endsWith("die") ? `${w.slice(0, -3)}dice` : `${w}s`}`;
const diceText = (p: AttackPool) =>
  ([["red", "R"], ["black", "B"], ["white", "W"]] as const).map(([c, l]) => (p[c] ?? 0) ? `${p[c]}${l}` : "").filter(Boolean).join(" ");

function party(u: BoardUnit): Party {
  return { key: u.key, name: u.name, side: u.side, ids: u.tokens.map((t) => t.id), color: u.lead.color };
}

const maxOf = (ts: Token[], f: (t: Token) => number) => Math.max(0, ...ts.map(f));

/** The units in the sequence as they are on the board now. */
export function attackUnits(s: TabletopState, a: AttackSeq): { att?: BoardUnit; def?: BoardUnit } {
  const units = boardUnits(s);
  return { att: units.find((u) => u.key === a.attacker.key), def: units.find((u) => u.key === a.defender.key) };
}

function put(s: TabletopState, a: AttackSeq): TabletopState {
  return { ...s, attack: { ...a, ts: Date.now() } };
}

// --- Steps -------------------------------------------------------------------

export function declareAttack(s: TabletopState, att: BoardUnit, def: BoardUnit, weapons: WeaponPick[], by?: string): TabletopState {
  const picks = weapons.filter((w) => w.minis > 0);
  const melee = picks.length > 0 && picks.every((p) => weaponsOf(att.unit).find((w) => w.name === p.name)?.max_range === 0);
  const pool = poolOf(picks, att.unit);
  const a: AttackSeq = {
    id: `atk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    stage: "declared", ts: Date.now(), by,
    attacker: party(att), defender: party(def),
    weapons: picks, pool, melee, dice: [],
    aimLeft: 0, aimSpent: 0, rerollsPerAim: 2 + keyword(att.unit?.keywords, "Precise"),
    hits: 0, crits: 0, cover: 0, coverCancel: 0, armorCancel: 0, dodgeAvail: 0, dodgeSpent: 0,
    defense: [], blocks: 0, pierce: 0, wounds: 0, defeated: 0, wiped: false,
    notes: [`${att.name} attacks ${def.name} with ${picks.map((p) => `${p.name} ×${p.minis}`).join(", ")} (${diceText(pool)}).`],
  };
  return put(s, a);
}

/** Can this die be rerolled by aim? Blanks, and surges the unit can't use. */
export function rerollable(a: AttackSeq, d: AttackDie, s: TabletopState): boolean {
  if (d.face === "blank") return true;
  return d.face === "surge" && !surgeOf(s, a);
}

function surgeOf(s: TabletopState, a: AttackSeq): "hit" | "crit" | null {
  const u = attackUnits(s, a).att?.unit;
  return u?.attack_surge === "hit" || u?.attack_surge === "crit" ? u.attack_surge : null;
}

export function rollAttackStep(s: TabletopState): TabletopState {
  const a = s.attack;
  if (!a || a.stage !== "declared") return s;
  const { att } = attackUnits(s, a);
  const dice: AttackDie[] = rollAttack(a.pool);
  const aimLeft = att ? maxOf(att.tokens, (t) => t.status?.aim ?? 0) : 0;
  const t = tallyAttack(dice, null);
  return put(s, {
    ...a, stage: "rolled", dice, aimLeft,
    notes: [...a.notes, `Rolled ${pl(dice.length, "die")}: ${pl(t.crits, "crit")}, ${pl(t.hits, "hit")}, ${pl(t.surges, "surge")}, ${pl(t.blanks, "blank")}.`],
  });
}

/** Spend one aim token to reroll `picks` (die indexes), or the best dice
 * to reroll when none are given. */
export function aimRerollStep(s: TabletopState, picks?: number[]): TabletopState {
  const a = s.attack;
  if (!a || a.stage !== "rolled" || a.aimLeft <= 0) return s;
  const want = (picks ?? a.dice.map((_, i) => i).filter((i) => rerollable(a, a.dice[i]!, s))).slice(0, a.rerollsPerAim);
  if (!want.length) return s;
  const dice = a.dice.map((d, i) => want.includes(i) ? { ...rollAttack({ [d.color]: 1 })[0]!, rerolled: true } : d);
  const ids = new Set(a.attacker.ids);
  const tokens = s.tokens.map((t) => ids.has(t.id) ? { ...t, status: { ...t.status, aim: Math.max(0, (t.status?.aim ?? 0) - 1) } } : t);
  const now = want.map((i) => dice[i]!.face);
  return put({ ...s, tokens }, {
    ...a, dice, aimLeft: a.aimLeft - 1, aimSpent: a.aimSpent + 1,
    notes: [...a.notes, `Aim: rerolled ${pl(want.length, "die")} → ${now.join(", ")}.`],
  });
}

/** Done rolling: surges, Critical, Armor/Impact and cover. */
export function toDefenseStep(s: TabletopState): TabletopState {
  const a = s.attack;
  if (!a || a.stage !== "rolled") return s;
  const { att, def } = attackUnits(s, a);
  const ws = weaponsOf(att?.unit).filter((w) => a.weapons.some((p) => p.name === w.name));
  const kw = (name: string) => Math.max(0, ...ws.map((w) => keyword(w.keywords, name)));
  const surge = surgeOf(s, a);
  let critical = kw("Critical");
  const dice = a.dice.map((d): AttackDie => {
    if (d.face !== "surge") return d;
    if (critical-- > 0) return { ...d, face: "crit", surged: true };
    if (surge) return { ...d, face: surge, surged: true };
    return d;
  });
  const t = tallyAttack(dice, null);
  let hits = t.hits, crits = t.crits;
  const notes: string[] = [];
  let armorCancel = 0;
  // Armor cancels every hit; Impact turns hits into crits first.
  if (keyword(def?.unit?.keywords, "Armor") > 0) {
    const impact = Math.min(hits, kw("Impact"));
    crits += impact;
    armorCancel = hits - impact;
    hits = 0;
    notes.push(`Armor cancels ${pl(armorCancel, "hit")}${impact ? ` (Impact makes ${impact} a crit)` : ""}.`);
  }
  // Cover (from terrain, +1 when suppressed) cancels hits.
  let cover = 0;
  if (att && def && !kw("Blast") && !a.melee) {
    cover = coverAgainst(s, center(att.lead), def.tokens);
    if (cover > 0 && maxOf(def.tokens, (d) => d.suppression ?? 0) > 0) cover = Math.min(2, cover + 1);
    cover = Math.max(0, cover - kw("Sharpshooter"));
  }
  const coverCancel = Math.min(hits, cover);
  hits -= coverCancel;
  if (coverCancel) notes.push(`${cover === 2 ? "Heavy" : "Light"} cover cancels ${pl(coverCancel, "hit")}.`);
  const dodgeAvail = def ? maxOf(def.tokens, (d) => d.status?.dodge ?? 0) : 0;
  const noDodge = kw("High Velocity") ? "High Velocity: dodge can't be used" : undefined;
  notes.push(`${pl(hits + crits, "hit")} go${hits + crits === 1 ? "es" : ""} through (${pl(crits, "crit")}).`);
  return put(s, {
    ...a, stage: "defend", dice, hits, crits, cover, coverCancel, armorCancel,
    dodgeAvail, dodgeSpent: 0, noDodge, notes: [...a.notes, ...notes],
  });
}

/** How many dodge tokens the defender can usefully spend. */
export function maxDodge(a: AttackSeq): number {
  return a.noDodge ? 0 : Math.min(a.dodgeAvail, a.hits);
}

export function setDodgeStep(s: TabletopState, n: number): TabletopState {
  const a = s.attack;
  if (!a || a.stage !== "defend") return s;
  return put(s, { ...a, dodgeSpent: Math.max(0, Math.min(maxDodge(a), n)) });
}

/** Defense dice the defender rolls now. */
export function defenseDice(a: AttackSeq): number {
  return Math.max(0, a.hits - a.dodgeSpent) + a.crits;
}

/** Roll defense, then put wounds and suppression on the board. */
export function rollDefenseStep(s: TabletopState): TabletopState {
  const a = s.attack;
  if (!a || a.stage !== "defend") return s;
  const { att, def } = attackUnits(s, a);
  const dodges = Math.min(a.dodgeSpent, maxDodge(a));
  const hits = a.hits - dodges;
  const landed = hits + a.crits;
  const color: DefenseColor = def?.unit?.defense === "red" ? "red" : "white";
  const dsurge = !!def?.unit?.has_defense_surge;
  const defense: DefenseDie[] = rollDefense({ [color]: landed }).map((d) =>
    d.face === "surge" && dsurge ? { ...d, face: "block", surged: true } : d);
  const ws = weaponsOf(att?.unit).filter((w) => a.weapons.some((p) => p.name === w.name));
  const kw = (name: string) => Math.max(0, ...ws.map((w) => keyword(w.keywords, name)));
  const rawBlocks = defense.filter((d) => d.face === "block").length;
  const pierce = keyword(def?.unit?.keywords, "Impervious") ? 0 : Math.min(rawBlocks, kw("Pierce"));
  const blocks = rawBlocks - pierce;
  const wounds = Math.max(0, landed - blocks);
  const notes = [
    ...(dodges ? [`Dodge cancels ${pl(dodges, "hit")}.`] : []),
    ...(landed ? [`Defense rolls ${pl(landed, `${color} die`)}: ${pl(rawBlocks, "block")}${pierce ? `, Pierce cancels ${pierce}` : ""}.`] : []),
  ];

  // Suppression: 1 if any hit or crit got through cover (+ Suppressive).
  const supp = (a.hits + a.crits > 0 ? 1 : 0) + kw("Suppressive");
  const dIds = new Set(def?.tokens.map((t) => t.id) ?? []);
  let tokens = s.tokens.map((tk) => {
    if (!dIds.has(tk.id)) return tk;
    let out = tk;
    if (supp > 0 && !/vehicle/.test(def?.unit?.type ?? "")) out = { ...out, suppression: (out.suppression ?? 0) + supp };
    if (dodges > 0) out = { ...out, status: { ...out.status, dodge: Math.max(0, (out.status?.dodge ?? 0) - dodges) } };
    return out;
  });

  // Wounds go on one mini at a time, the leader last.
  const threshold = Math.max(1, def?.unit?.wounds ?? 1);
  const order = [...(def?.tokens ?? [])].sort((x, y) => Number(!!x.squadLead) - Number(!!y.squadLead) || (y.wounds ?? 0) - (x.wounds ?? 0));
  const gone = new Set<string>();
  const woundsOn = new Map<string, number>();
  const woundTargets: string[] = [];
  let left = wounds;
  for (const m of order) {
    if (left <= 0) break;
    const have = m.wounds ?? 0;
    const take = Math.min(left, threshold - have);
    left -= take;
    for (let i = 0; i < take; i++) woundTargets.push(m.id);
    if (have + take >= threshold) gone.add(m.id); else woundsOn.set(m.id, have + take);
  }
  const removed = s.tokens.filter((tk) => gone.has(tk.id));
  tokens = tokens.filter((tk) => !gone.has(tk.id)).map((tk) => woundsOn.has(tk.id) ? { ...tk, wounds: woundsOn.get(tk.id) } : tk);
  for (const r of removed) tokens = normalizeSquads(tokens, r);
  const wiped = !!def && def.tokens.every((d) => gone.has(d.id));
  let next: TabletopState = { ...s, tokens };

  if (wiped && def) {
    // Its order token leaves the game; with no objectives on the table, a
    // defeated unit is worth 1 VP.
    const fo = poolsOf(next)[def.side];
    if (fo && def.entryId) {
      next = { ...next, orders: { ...poolsOf(next), [def.side]: { ...fo, tokens: fo.tokens.map((t) => t.entryId === def.entryId ? { ...t, out: true } : t) } } };
    }
    if (!next.tokens.some((t) => t.kind === "objective")) {
      const side = otherSide(def.side);
      next = { ...next, vp: { ...next.vp, [side]: next.vp[side] + 1 } };
      notes.push(`${side === "blue" ? "Blue" : "Red"} +1 VP for defeating ${def.name}.`);
    }
  }

  const done: AttackSeq = {
    ...a, stage: "done", dodgeSpent: dodges, defense, blocks, pierce, wounds,
    defeated: gone.size, wiped, notes: [...a.notes, ...notes],
  };
  done.text = summary(done);
  done.fx = buildFx(done, woundTargets, gone, att, def);
  return put(next, done);
}

export function closeAttack(s: TabletopState): TabletopState {
  return s.attack ? { ...s, attack: null } : s;
}

/** One line for the chat and the log. */
export function summary(a: AttackSeq): string {
  const t = { crits: a.dice.filter((d) => d.face === "crit").length, hits: a.dice.filter((d) => d.face === "hit").length };
  const minis = a.weapons.reduce((n, w) => n + w.minis, 0);
  return `${a.attacker.name} ${a.melee ? "strikes" : "fires"} ${a.weapons.map((w) => w.name).join(" + ")} at ${a.defender.name} (${pl(minis, "mini")}, ${diceText(a.pool)}): ` +
    `${pl(t.hits, "hit")}, ${pl(t.crits, "crit")}` +
    (a.aimSpent ? `, ${pl(a.aimSpent, "aim")} spent` : "") +
    (a.armorCancel ? `, armor stops ${a.armorCancel}` : "") +
    (a.coverCancel ? `, cover saves ${a.coverCancel}` : "") +
    (a.dodgeSpent ? `, dodge saves ${a.dodgeSpent}` : "") +
    (a.hits + a.crits ? `, ${a.blocks} blocked` : "") +
    ` → ${pl(a.wounds, "wound")}` +
    (a.defeated ? (a.wiped ? `. ${a.defender.name} is defeated!` : `, ${pl(a.defeated, "mini")} down.`) : ".");
}

// --- Effects -------------------------------------------------------------------

const BOLT: Record<FactionColor, string> = {
  rebels: "#ff4a3a", imperials: "#ff3a2a", republic: "#4aa8ff", separatists: "#ff5a3a", mercenary: "#ff9a3a", neutral: "#ff4a3a",
};

/** Same order on every client: shuffled by the attack's id. */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function buildFx(a: AttackSeq, woundTargets: string[], gone: Set<string>, att?: BoardUnit, def?: BoardUnit): AttackFx | undefined {
  if (!att || !def) return undefined;
  // The minis that fired: the ones nearest the target, as many as declared.
  const firing = a.weapons.reduce((n, w) => n + w.minis, 0);
  const shooters = [...att.tokens].sort((x, y) => unitGap([x], def.tokens) - unitGap([y], def.tokens)).slice(0, Math.max(1, firing));
  const from = shooters.map((t) => ({ id: t.id, ...center(t) }));
  const to = def.tokens.map((t) => ({ id: t.id, ...center(t), size: t.size, color: t.color, label: t.label, portrait: t.portraitUrl, defeated: gone.has(t.id) }));
  const idx = (id: string) => Math.max(0, to.findIndex((t) => t.id === id));
  const rnd = seededRandom(a.id);
  const anyTo = () => Math.floor(rnd() * to.length);

  // Final faces: crits wound first, then hits, then what stopped the rest.
  const crits = a.dice.filter((d) => d.face === "crit").length;
  const misses = a.dice.length - crits - a.dice.filter((d) => d.face === "hit").length;
  const kinds: { kind: ShotKind; to: number }[] = [];
  const landed = Math.max(0, a.hits - a.dodgeSpent) + a.crits;
  woundTargets.forEach((id, i) => kinds.push({ kind: i < Math.min(crits, a.wounds) ? "crit" : "hit", to: idx(id) }));
  for (let i = 0; i < landed - a.wounds; i++) kinds.push({ kind: "block", to: i % to.length });
  for (let i = 0; i < a.dodgeSpent; i++) kinds.push({ kind: "dodge", to: anyTo() });
  for (let i = 0; i < a.coverCancel; i++) kinds.push({ kind: "cover", to: anyTo() });
  for (let i = 0; i < a.armorCancel; i++) kinds.push({ kind: "armor", to: anyTo() });
  for (let i = 0; i < misses; i++) kinds.push({ kind: "miss", to: anyTo() });
  // A mini's last shot to land is the one that drops it.
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j]!, kinds[i]!];
  }
  const shots = kinds.map((k, i) => ({ ...k, from: i % from.length }));
  return { melee: a.melee, color: a.melee ? "#ffe6a0" : BOLT[a.attacker.color], from, to, shots };
}

/** A unit that can start an attack: it has weapons and enemies on the table. */
export function canStartAttack(state: TabletopState, u: BoardUnit | undefined): boolean {
  return !!u && weaponsOf(u.unit).length > 0 && boardUnits(state).some((o) => o.side !== u.side);
}

// --- Who acts ------------------------------------------------------------------

/** The side whose turn it is in the sequence, or null once it's done. */
export function attackTurn(a: AttackSeq): Side | null {
  if (a.stage === "declared" || a.stage === "rolled") return a.attacker.side;
  if (a.stage === "defend") return a.defender.side;
  return null;
}

export function stageLabel(a: AttackSeq): string {
  switch (a.stage) {
    case "declared": return "Roll attack dice";
    case "rolled": return a.aimLeft > 0 ? "Aim rerolls, then on to defense" : "On to defense";
    case "defend": return "Defender: dodge, then roll defense";
    default: return "Done";
  }
}
