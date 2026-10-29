// Armies for the Legion AI: a starter force from the catalog when it has
// no list, deploying a list into its Territory, its order token pool and
// its command hand.

import { unitById, upgradeById, CATALOG } from "../../data/catalog";
import { cardForUnit } from "../cardLookup";
import { cardsForFaction, handComplete, HAND_PIPS, meetsRequirement, PER_PIP } from "../commandCards";
import { RANK_ORDER } from "../factions";
import { buildPool, setPool, type Side } from "../orderPool";
import { deploySquad, squadMinis } from "../squads";
import {
  deploymentZones, handFromCards, territories, unitTokenFields,
  type TabletopState, type Zone,
} from "../tabletop";
import type { ArmyEntry, FactionId, SavedArmy, Unit, Upgrade } from "../types";

export type ArmyChoice =
  | { kind: "starter"; faction: FactionId }
  | { kind: "saved"; army: SavedArmy };

export const FACTION_NAME: Record<FactionId, string> = {
  rebels: "Rebels", imperials: "Empire", republic: "Republic", separatists: "Separatists", mercenary: "Mercenaries",
};

const usable = (u: Unit) => (u.weapons?.length ?? 0) > 0 && u.points > 0 && !u.revamp_only;

/** A small, legal-looking force: a commander, three corps, a special
 * forces and a support unit, the cheapest of each with weapons. Squads
 * (3+ minis) for corps and special forces, so a lone heavy-weapon card
 * isn't picked as a unit, and a generic commander before a named one. */
export function starterArmy(faction: FactionId, side: Side): SavedArmy {
  const pool = CATALOG.units.filter((u) => u.faction === faction && usable(u));
  const cheapest = (rank: string, minMinis: number) =>
    pool.filter((u) => u.rank === rank && u.miniatures >= minMinis)
      .sort((a, b) => Number(a.is_unique) - Number(b.is_unique) || b.miniatures - a.miniatures || a.points - b.points)[0];
  const corps = cheapest("corps", 4) ?? cheapest("corps", 3);
  const picks = [
    cheapest("commander", 1),
    corps, corps, corps,
    cheapest("special-forces", 3),
    cheapest("support", 1),
  ].filter((u): u is Unit => !!u);
  const entries: ArmyEntry[] = picks.map((u, i) => ({ entryId: `ai-${side}-${i}`, unitId: u.id }));
  return {
    id: `ai-starter-${side}`,
    name: `${FACTION_NAME[faction]} starter force`,
    faction,
    pointsCap: 800,
    entries,
    updatedAt: Date.now(),
  };
}

export function armyPoints(army: SavedArmy): number {
  return army.entries.reduce((n, e) => n + (unitById(e.unitId)?.points ?? 0) +
    (e.upgrades ?? []).reduce((m, id) => m + (upgradeById(id)?.points ?? 0), 0), 0);
}

/** Two command cards of each pip value the army can play: generic ones
 * first, then the faction's own. */
export function pickCommandHand(army: SavedArmy): string[] | null {
  if (army.commandCards && handComplete(army.commandCards)) return army.commandCards;
  const hand = { faction: army.faction, battleForce: army.battleForce, entries: army.entries };
  const ids: string[] = [];
  for (const p of HAND_PIPS) {
    const fits = cardsForFaction(army.faction)
      .filter((c) => c.pips === p && meetsRequirement(c, hand) === true)
      .sort((a, b) => Number(!!a.requirement.units) - Number(!!b.requirement.units) || a.name.localeCompare(b.name));
    ids.push(...fits.slice(0, PER_PIP).map((c) => c.id));
  }
  return handComplete(ids) ? ids : null;
}

/** The side's Territory: the mission's, the deployment preset's, or the
 * long edges (blue along the top) when neither is set. */
export function homeZone(s: TabletopState, side: Side): Zone {
  const zones = territories(s)?.[side] ?? [deploymentZones("long-edges", s.map)[side]];
  return zones.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
}

/** Deploy every entry of the list into the side's Territory, spread along
 * it, then make its order token pool and (if it has none yet) its hand. */
export function deployArmy(s: TabletopState, side: Side, army: SavedArmy): TabletopState {
  const zone = homeZone(s, side);
  const rows = army.entries
    .map((e) => ({ e, u: unitById(e.unitId) }))
    .filter((r): r is { e: ArmyEntry; u: Unit } => !!r.u)
    .sort((a, b) => RANK_ORDER.indexOf(a.u.rank) - RANK_ORDER.indexOf(b.u.rank));
  let next = s.deployment || s.mission ? s : { ...s, deployment: "long-edges" as const };
  // Face the enemy: whichever way the board's middle is from home.
  const mid = { x: s.map.widthInches / 2, y: s.map.heightInches / 2 };
  const zc = { x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 };
  const facing = (Math.atan2(mid.x - zc.x, -(mid.y - zc.y)) * 180) / Math.PI;
  const wide = zone.w >= zone.h;
  rows.forEach(({ e, u }, i) => {
    const ups = (e.upgrades ?? []).map(upgradeById).filter((x): x is Upgrade => !!x);
    const base = { ...unitTokenFields(u, cardForUnit(u)), armyEntryId: e.entryId, side };
    if (base.rotation != null) base.rotation = Math.round(facing);
    const minis = squadMinis(u, ups).map((m) => ({ ...base, label: m.label, ...(m.badge ? { badge: m.badge } : {}) }));
    const f = (i + 0.5) / rows.length;
    const at = wide
      ? { x: zone.x + zone.w * f, y: zone.y + zone.h / 2 }
      : { x: zone.x + zone.w / 2, y: zone.y + zone.h * f };
    next = deploySquad(next, minis, at);
  });
  next = setPool(next, side, buildPool(army.name || "AI list", rows.map(({ e, u }) => ({ entryId: e.entryId, rank: u.rank, unitName: u.name }))));
  if (!next.hands[side].cards.some((c) => c.id)) {
    const ids = pickCommandHand(army);
    if (ids) next = { ...next, hands: { ...next.hands, [side]: handFromCards(ids, army.name) } };
  }
  return next;
}

/** A pool for units already on the board (deployed by a person for the
 * AI), one token per list entry. */
export function poolFromBoard(s: TabletopState, side: Side, entries: { entryId: string; unit: Unit }[]): TabletopState {
  return setPool(s, side, buildPool("Units on the table", entries.map((e) => ({ entryId: e.entryId, rank: e.unit.rank, unitName: e.unit.name }))));
}
