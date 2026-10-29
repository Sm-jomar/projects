// Ranges, keywords and attack ratings for Legion. The attack itself is
// rolled step by step in lib/attack, by people and AI seats alike.

import type { AttackPool } from "../dice";
import type { Token } from "../tabletop";
import type { Unit, Weapon } from "../types";
import { unitGap } from "./legionGeometry";

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
