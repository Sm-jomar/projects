// Attacks for the Legion AI, resolved with the app's dice (lib/dice) and
// the core attack sequence, simplified: pool from the minis in range,
// aim rerolls, surges, Critical/Impact/Pierce, Armor, cover and dodge,
// defense dice, wounds one mini at a time, and suppression.

import { rollAttack, rollDefense, tallyAttack, tallyDefense, type AttackPool } from "../dice";
import { normalizeSquads } from "../squads";
import type { TabletopState, Token } from "../tabletop";
import type { Unit, Weapon } from "../types";
import { center, coverAgainst, unitGap } from "./legionGeometry";

export const RANGE_INCHES = 6;

/** A keyword's number on a weapon or unit ("Pierce 2" -> 2, "Armor" -> 1),
 * or 0 when it doesn't have it. */
export function keyword(list: Weapon["keywords"] | string[] | undefined, name: string): number {
  if (!list) return 0;
  const want = name.toLowerCase();
  if (Array.isArray(list)) {
    for (const k of list) {
      const m = /^([a-z' -]+?)\s*(\d+)?(?::.*)?$/i.exec(k.trim());
      if (m && m[1]!.trim().toLowerCase() === want) return m[2] ? Number(m[2]) : 1;
    }
    return 0;
  }
  for (const [k, v] of Object.entries(list)) {
    if (k.toLowerCase() === want) return typeof v === "number" ? v : Number(v) || 1;
  }
  return 0;
}

/** The range band (1 = up to 6") of a gap in inches; 0 is base contact. */
export function rangeOf(gap: number): number {
  if (gap <= 0.05) return 0;
  return Math.ceil(gap / RANGE_INCHES - 1e-9);
}

export function weaponReaches(w: Weapon, gap: number): boolean {
  const r = rangeOf(gap);
  if ((w.max_range ?? 99) === 0) return r === 0; // melee
  return r >= Math.max(1, w.min_range) && r <= (w.max_range ?? 99);
}

const DICE_VALUE = { red: 0.75, black: 0.5, white: 0.25 } as const;

/** Dice in the pool if every mini that reaches fires this weapon. */
export function attackPool(w: Weapon, attackers: Token[], targets: Token[]): { pool: AttackPool; minis: number } {
  const minis = attackers.filter((a) => weaponReaches(w, unitGap([a], targets))).length;
  return {
    minis,
    pool: { red: (w.dice.red ?? 0) * minis, black: (w.dice.black ?? 0) * minis, white: (w.dice.white ?? 0) * minis },
  };
}

/** Rough wounds an attack should do, to rate options. */
export function expectedWounds(pool: AttackPool, target: Unit | undefined, cover: number): number {
  const hits = (pool.red ?? 0) * DICE_VALUE.red + (pool.black ?? 0) * DICE_VALUE.black + (pool.white ?? 0) * DICE_VALUE.white;
  const block = target?.defense === "red" ? 0.5 : 0.25;
  return Math.max(0, hits - cover * 0.6) * (1 - block);
}

export type AttackResult = { state: TabletopState; text: string; wounds: number; defeated: number; wiped: boolean };


/** Roll the attack and put the wounds and suppression on the board. */
export function resolveAttack(
  state: TabletopState,
  attacker: { tokens: Token[]; unit: Unit; name: string },
  defender: { tokens: Token[]; unit: Unit | undefined; name: string },
  w: Weapon,
): AttackResult {
  const { pool, minis } = attackPool(w, attacker.tokens, defender.tokens);
  let rolls = rollAttack(pool);
  // Aim: reroll up to 2 blanks (or unconverted surges) per aim token.
  const aim = Math.max(...attacker.tokens.map((t) => t.status?.aim ?? 0), 0);
  const surge = attacker.unit.attack_surge === "crit" || attacker.unit.attack_surge === "hit" ? attacker.unit.attack_surge : null;
  if (aim > 0) {
    let rerolls = 2 * aim + keyword(attacker.unit.keywords, "Precise") * aim;
    rolls = rolls.map((r) => {
      if (rerolls <= 0 || !(r.face === "blank" || (r.face === "surge" && !surge))) return r;
      rerolls--;
      return rollAttack({ [r.color]: 1 })[0]!;
    });
  }
  // Critical N turns surges into crits before the unit's own surge.
  let critical = keyword(w.keywords, "Critical");
  rolls = rolls.map((r) => (r.face === "surge" && critical-- > 0 ? { ...r, face: "crit" } : r));
  const t = tallyAttack(rolls, surge);
  let hits = t.hits, crits = t.crits;
  const rolled = `${pool.red ?? 0}R ${pool.black ?? 0}B ${pool.white ?? 0}W`.replace(/ ?\b0[RBW]/g, "").trim();

  const def = defender.unit;
  // Armor cancels every hit; Impact turns hits into crits first.
  if (keyword(def?.keywords, "Armor") > 0) {
    const impact = Math.min(hits, keyword(w.keywords, "Impact"));
    crits += impact;
    hits = 0;
  }
  // Cover (from terrain, +1 when suppressed), then dodge, cancel hits.
  const suppressed = Math.max(...defender.tokens.map((d) => d.suppression ?? 0), 0) > 0;
  let cover: number = keyword(w.keywords, "Blast") ? 0 : coverAgainst(state, center(attacker.tokens[0]!), defender.tokens);
  if (suppressed && cover > 0) cover = Math.min(2, cover + 1);
  cover = Math.max(0, cover - keyword(w.keywords, "Sharpshooter"));
  const coverCancel = Math.min(hits, cover);
  hits -= coverCancel;
  const dodges = Math.max(...defender.tokens.map((d) => d.status?.dodge ?? 0), 0);
  const dodgeCancel = keyword(w.keywords, "High Velocity") ? 0 : Math.min(hits, dodges);
  hits -= dodgeCancel;

  const landed = hits + crits;
  const color = def?.defense === "red" ? "red" : "white";
  const defense = landed > 0 ? tallyDefense(rollDefense({ [color]: landed }), !!def?.has_defense_surge) : { blocks: 0 };
  const pierce = keyword(def?.keywords, "Impervious") ? 0 : keyword(w.keywords, "Pierce");
  const blocks = Math.max(0, defense.blocks - pierce);
  const wounds = Math.max(0, landed - blocks);

  // Suppression: 1 if any hit or crit got through cover (+ Suppressive).
  const supp = (landed > 0 ? 1 : 0) + keyword(w.keywords, "Suppressive");
  let tokens = state.tokens.map((tk) => {
    if (!defender.tokens.some((d) => d.id === tk.id)) return tk;
    let out = tk;
    if (supp > 0 && !/vehicle/.test(def?.type ?? "")) out = { ...out, suppression: (out.suppression ?? 0) + supp };
    if (dodgeCancel > 0) out = { ...out, status: { ...out.status, dodge: Math.max(0, (out.status?.dodge ?? 0) - dodgeCancel) } };
    return out;
  });
  // The aim tokens are spent.
  if (aim > 0) {
    tokens = tokens.map((tk) => attacker.tokens.some((a) => a.id === tk.id)
      ? { ...tk, status: { ...tk.status, aim: 0 } } : tk);
  }

  // Wounds go on one mini at a time, the leader last.
  const threshold = Math.max(1, def?.wounds ?? 1);
  const order = [...defender.tokens].sort((a, b) => Number(!!a.squadLead) - Number(!!b.squadLead) || (b.wounds ?? 0) - (a.wounds ?? 0));
  const gone = new Set<string>();
  const woundsOn = new Map<string, number>();
  let left = wounds;
  for (const m of order) {
    if (left <= 0) break;
    const have = m.wounds ?? 0;
    const take = Math.min(left, threshold - have);
    left -= take;
    if (have + take >= threshold) gone.add(m.id); else woundsOn.set(m.id, have + take);
  }
  const removed = state.tokens.filter((tk) => gone.has(tk.id));
  tokens = tokens.filter((tk) => !gone.has(tk.id)).map((tk) => woundsOn.has(tk.id) ? { ...tk, wounds: woundsOn.get(tk.id) } : tk);
  for (const r of removed) tokens = normalizeSquads(tokens, r);
  const wiped = defender.tokens.every((d) => gone.has(d.id));

  const pl = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const text = `${attacker.name} fires ${w.name} at ${defender.name} (${pl(minis, "mini")}, ${rolled}): ` +
    `${pl(t.hits, "hit")}, ${pl(t.crits, "crit")}` +
    (coverCancel ? `, cover saves ${coverCancel}` : "") +
    (dodgeCancel ? `, dodge saves ${dodgeCancel}` : "") +
    (landed ? `, ${blocks} blocked` : "") +
    ` → ${pl(wounds, "wound")}` +
    (gone.size ? (wiped ? `. ${defender.name} is defeated!` : `, ${pl(gone.size, "mini")} down.`) : ".");
  return { state: { ...state, tokens }, text, wounds, defeated: gone.size, wiped };
}
