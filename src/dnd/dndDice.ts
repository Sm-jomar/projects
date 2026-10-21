// Dice helpers shared by the dice roller, the DM screen and roll requests.

import { ABILITIES, SKILLS, abilityModifier, formatModifier, type AbilityKey, type DndCharacter, type SkillKey } from "./dndTypes";
import type { RollPayload } from "./dndRoom";
import type { RollKind, RollMode, RollRequest } from "./dndProtocol";

// Standard D&D polyhedral set (d100 = percentile).
export const DICE = [4, 6, 8, 10, 12, 20, 100] as const;
export type Sides = (typeof DICE)[number];

// Fair single-die roll using the crypto RNG.
export function rollDie(sides: number): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0]! % sides) + 1;
}

export function poolLabel(pool: Record<number, number>, modifier: number): string {
  const parts = DICE.filter((s) => (pool[s] ?? 0) > 0).map((s) => `${pool[s]}d${s}`);
  let label = parts.join(" + ") || "—";
  if (modifier) label += ` ${modifier >= 0 ? "+" : "−"} ${Math.abs(modifier)}`;
  return label;
}

const critNote = (v: number) => (v === 20 ? "Natural 20!" : v === 1 ? "Natural 1…" : undefined);

/** A d20 test (normal / advantage / disadvantage) with a modifier. */
export function rollD20(mode: RollMode, modifier: number, label: string): RollPayload {
  if (mode === "normal") {
    const v = rollDie(20);
    return { label, rolls: [{ sides: 20, value: v }], modifier, total: v + modifier, note: critNote(v) };
  }
  const a = rollDie(20), b = rollDie(20);
  const chosen = mode === "adv" ? Math.max(a, b) : Math.min(a, b);
  const crit = critNote(chosen);
  return {
    label,
    rolls: [{ sides: 20, value: chosen }],
    modifier,
    total: chosen + modifier,
    note: `${mode === "adv" ? "Advantage" : "Disadvantage"} — rolled ${a} & ${b}${crit ? ` · ${crit}` : ""}`,
  };
}

/** "2d6+3", "d20 - 1", "4d6" → dice + flat modifier, or null if invalid. */
export function parseDiceExpr(expr: string): { dice: { count: number; sides: number }[]; modifier: number } | null {
  const s = expr.replace(/\s+/g, "").toLowerCase();
  if (!s || !/^[0-9d+-]+$/.test(s)) return null;
  const terms = s.match(/[+-]?[^+-]+/g);
  if (!terms) return null;
  const dice: { count: number; sides: number }[] = [];
  let modifier = 0;
  for (const raw of terms) {
    const sign = raw.startsWith("-") ? -1 : 1;
    const t = raw.replace(/^[+-]/, "");
    const m = /^(\d*)d(\d+)$/.exec(t);
    if (m) {
      const count = m[1] ? Number(m[1]) : 1;
      const sides = Number(m[2]);
      if (sign < 0 || count < 1 || count > 50 || sides < 2 || sides > 1000) return null;
      dice.push({ count, sides });
    } else if (/^\d+$/.test(t)) {
      modifier += sign * Number(t);
    } else {
      return null;
    }
  }
  return dice.length ? { dice, modifier } : null;
}

export function rollExpr(expr: string, label?: string): RollPayload | null {
  const parsed = parseDiceExpr(expr);
  if (!parsed) return null;
  const rolls: { sides: number; value: number }[] = [];
  for (const d of parsed.dice) for (let i = 0; i < d.count; i++) rolls.push({ sides: d.sides, value: rollDie(d.sides) });
  const sum = rolls.reduce((a, r) => a + r.value, 0);
  const note = rolls.length === 1 && rolls[0]!.sides === 20 ? critNote(rolls[0]!.value) : undefined;
  return { label: label ?? expr.replace(/\s+/g, ""), rolls, modifier: parsed.modifier, total: sum + parsed.modifier, note };
}

/** The bonus a character sheet gives to a check / save / initiative. */
export function checkModifier(c: DndCharacter, kind: RollKind, key?: string): number {
  if (kind === "initiative") return abilityModifier(c.abilities.dex);
  if (kind === "skill") {
    const sk = SKILLS.find((s) => s.key === key);
    if (!sk) return 0;
    return abilityModifier(c.abilities[sk.ability]) + (c.skillProf[sk.key as SkillKey] ? c.proficiencyBonus : 0);
  }
  if (kind === "save" || kind === "ability") {
    const ab = ABILITIES.find((a) => a.key === key);
    if (!ab) return 0;
    const base = abilityModifier(c.abilities[ab.key as AbilityKey]);
    return kind === "save" && c.saveProf[ab.key as AbilityKey] ? base + c.proficiencyBonus : base;
  }
  return 0;
}

/** Human label for a roll request ("Perception check", "DEX save", …). */
export function requestLabel(req: Pick<RollRequest, "kind" | "key" | "dice" | "label">): string {
  if (req.label) return req.label;
  if (req.kind === "skill") return `${SKILLS.find((s) => s.key === req.key)?.label ?? "Skill"} check`;
  if (req.kind === "save") return `${ABILITIES.find((a) => a.key === req.key)?.label ?? "Ability"} save`;
  if (req.kind === "ability") return `${ABILITIES.find((a) => a.key === req.key)?.label ?? "Ability"} check`;
  if (req.kind === "initiative") return "Initiative";
  return req.dice ? `Roll ${req.dice}` : "Roll";
}

/** Roll the answer to a request, using the sheet's modifier when there is one. */
export function answerRequest(req: RollRequest, c: DndCharacter | null, mode: RollMode, manualMod = 0): RollPayload | null {
  const label = requestLabel(req);
  if (req.kind === "custom") {
    const r = rollExpr(req.dice || "1d20", label);
    return r && manualMod ? { ...r, modifier: r.modifier + manualMod, total: r.total + manualMod } : r;
  }
  const mod = c ? checkModifier(c, req.kind, req.key) : manualMod;
  return rollD20(mode, mod, label);
}

export function modifierText(c: DndCharacter | null, req: RollRequest, manualMod: number): string {
  if (req.kind === "custom") return req.dice ?? "";
  return formatModifier(c ? checkModifier(c, req.kind, req.key) : manualMod);
}

export function outcome(total: number, dc: number): "pass" | "fail" {
  return total >= dc ? "pass" : "fail";
}
