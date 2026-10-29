import commandCardsRaw from "../data/command-cards.json";
import { unitById } from "../data/catalog";
import { BATTLE_FORCES } from "./factions";
import type { ArmyEntry, FactionId, Weapon } from "./types";

// Command cards from Legion Helper (scripts/import_legion_helper_card_text.py)
// and the 2024 command hand rules: two 1-, two 2- and two 3-pip cards, no
// duplicates, plus Standing Orders. A card naming units, a faction or a
// battle force needs them in the army.

export type CommandRequirement = {
  faction?: FactionId;
  battleForce?: string;
  /** Unit ids per named unit; any printing of a name counts. */
  units?: string[][];
  /** All named units are needed ("A and B"), not just one. */
  all?: boolean;
  /** Printed text we can't check (an affiliation or a unit we don't list). */
  text?: string;
};

export type CommandCardDef = {
  id: string;
  name: string;
  pips: number;
  /** Who the card issues orders to, as printed ("2 Units", "Jyn Erso"). */
  orders: string;
  requirement: CommandRequirement;
  requirementText?: string;
  text: string;
  weapon?: Weapon;
};

export const COMMAND_CARDS = commandCardsRaw as unknown as CommandCardDef[];
export const COMMAND_BY_ID = new Map(COMMAND_CARDS.map((c) => [c.id, c]));
export const STANDING_ORDERS = COMMAND_BY_ID.get("standing-orders")!;
export const HAND_PIPS = [1, 2, 3] as const;
export const PER_PIP = 2;

export type HandArmy = { faction: FactionId; battleForce?: string; entries: ArmyEntry[] };

const FACTION_OF_BF: Record<string, FactionId> = Object.fromEntries(
  Object.entries(BATTLE_FORCES).flatMap(([f, list]) => list.map((bf) => [bf, f as FactionId])),
);

/** The factions a card can be played by (none = any). */
export function cardFactions(c: CommandCardDef): FactionId[] {
  const r = c.requirement;
  if (r.faction) return [r.faction];
  if (r.battleForce) return FACTION_OF_BF[r.battleForce] ? [FACTION_OF_BF[r.battleForce]!] : [];
  if (r.units) {
    const set = new Set<FactionId>();
    for (const id of r.units.flat()) {
      const u = unitById(id);
      if (u) [u.faction, ...(u.also_factions ?? [])].forEach((f) => set.add(f));
    }
    return [...set];
  }
  return [];
}

/** Whether the army meets the card's requirement: true, false, or
 * "unchecked" when the requirement names something we can't check. */
export function meetsRequirement(c: CommandCardDef, army: HandArmy): boolean | "unchecked" {
  const r = c.requirement;
  if (r.faction && r.faction !== army.faction) return false;
  if (r.battleForce) return r.battleForce === army.battleForce;
  if (r.units) {
    const have = new Set(army.entries.map((e) => e.unitId));
    const hit = (ids: string[]) => ids.some((id) => have.has(id));
    return r.all ? r.units.every(hit) : r.units.some(hit);
  }
  if (r.text) {
    const fs = cardFactions(c);
    return fs.length && !fs.includes(army.faction) ? false : "unchecked";
  }
  return true;
}

/** Cards worth offering for this army's faction: generic cards, the
 * faction's own, and unit cards whose units the faction can field. */
export function cardsForFaction(faction: FactionId): CommandCardDef[] {
  return COMMAND_CARDS.filter((c) => {
    if (c.pips < 1 || c.pips > 3) return false;
    const fs = cardFactions(c);
    return fs.length === 0 ? !c.requirement.text || !!c.requirement.faction : fs.includes(faction);
  });
}

export function handIssues(ids: string[], army: HandArmy): string[] {
  const issues: string[] = [];
  const cards = ids.map((id) => COMMAND_BY_ID.get(id)).filter((c): c is CommandCardDef => !!c);
  if (cards.length === 0) return issues;
  for (const p of HAND_PIPS) {
    const n = cards.filter((c) => c.pips === p).length;
    if (n !== PER_PIP) issues.push(`Command hand needs two ${p}-pip cards (have ${n}).`);
  }
  for (const c of cards) {
    if (meetsRequirement(c, army) === false) {
      issues.push(`Command card "${c.name}" needs ${c.requirementText ?? "a unit you don't have"}.`);
    }
  }
  return issues;
}

/** True when the picks make a full hand: two cards of each pip value. */
export function handComplete(ids: string[]): boolean {
  return ids.length === HAND_PIPS.length * PER_PIP &&
    HAND_PIPS.every((p) => ids.filter((id) => COMMAND_BY_ID.get(id)?.pips === p).length === PER_PIP);
}
