import type { Catalog, Unit, Upgrade } from "../lib/types";
import baseRaw from "./catalog.base.json";
import { SEED_UNITS } from "./catalog.seed";
import overridesRaw from "./catalog-overrides.json";
import ttaRaw from "./tabletop-admiral.json";
import miniaturesRaw from "./unit-miniatures.json";
import upgradeMinisRaw from "./upgrade-miniatures.json";
import unitRulesRaw from "./unit-rules.json";

const base = baseRaw as unknown as Catalog;

// Hand-applied corrections for catalog data errors — wrong points, wrong
// faction, wrong type, etc. — reported via the in-app "Flag as wrong"
// button on a unit or upgrade. See docs/data-corrections.md for the full
// flag -> fix -> deploy loop. Keyed by unit/upgrade id; each entry is
// shallow-merged onto the generated catalog entry, so a correction only
// needs to list the field(s) that are actually wrong. This is separate
// from points-adjustments.json (the deliberate v2.6 tournament-points
// table) and from cardLookup.ts's UNIT_CARD_OVERRIDES (card-image
// re-pairing) — this file is for the base "printed" data itself.
type Overrides = {
  units?: Record<string, Partial<Unit>>;
  upgrades?: Record<string, Partial<Upgrade>>;
};
const OVERRIDES = overridesRaw as Overrides;

function applyOverrides<T extends { id: string }>(
  items: T[],
  table: Record<string, Partial<T>> | undefined,
): T[] {
  if (!table || Object.keys(table).length === 0) return items;
  return items.map((item) => (table[item.id] ? { ...item, ...table[item.id] } : item));
}

// Points, stats, upgrade slots and the full upgrade list imported from
// Tabletop Admiral's Legion builder by scripts/import_tabletop_admiral.py.
// Applied on top of the seed, under the hand-maintained overrides above.
type TtaLayer = {
  units: Record<string, Partial<Unit>>;
  new_units: Unit[];
  upgrades: Record<string, Partial<Upgrade>>;
  new_upgrades: Upgrade[];
};
const TTA = ttaRaw as unknown as TtaLayer;

// Miniatures per unit, as printed in the top-right corner of each unit
// card, from Legion Helper (scripts/import_legion_helper_minis.py). The
// seed and Tabletop Admiral leave many units at 1.
const MINIATURES = miniaturesRaw as Record<string, number>;

// Keywords and weapons as printed on each unit card, from Legion Helper
// (scripts/import_legion_helper_rules.py).
const UNIT_RULES = unitRulesRaw as unknown as Record<string, Pick<Unit, "keywords" | "weapons">>;

const units = applyOverrides(SEED_UNITS, TTA.units)
  .concat(TTA.new_units)
  .map((u) => (u.id in MINIATURES ? { ...u, miniatures: MINIATURES[u.id]! } : u))
  .map((u) => (u.id in UNIT_RULES ? { ...u, ...UNIT_RULES[u.id] } : u));
// Minis added by heavy weapon, personnel and squad leader upgrades, from
// the same Legion Helper import ("Add N ... miniature" on the card).
const UPGRADE_MINIS = upgradeMinisRaw as Record<string, { adds: number; leader?: boolean }>;

const upgrades = applyOverrides((base.upgrades ?? []) as Upgrade[], TTA.upgrades)
  .concat(TTA.new_upgrades)
  .map((u) => {
    const m = UPGRADE_MINIS[u.id];
    if (!m) return u;
    return { ...u, adds_miniature: m.adds > 0, adds_miniatures: m.adds, ...(m.leader ? { adds_leader: true } : {}) };
  });

export const CATALOG: Catalog = {
  version: base.version,
  // SEED_UNITS is the single source of truth for units (regenerated from
  // the fandom Unit_List wiki page); base.json keeps upgrades and command
  // cards.
  units: applyOverrides(units, OVERRIDES.units),
  upgrades: applyOverrides(upgrades, OVERRIDES.upgrades),
  commandCards: base.commandCards,
};

export const UNITS_BY_ID: Record<string, Unit> = Object.fromEntries(
  CATALOG.units.map((u) => [u.id, u]),
);

export const UPGRADES_BY_ID: Record<string, Upgrade> = Object.fromEntries(
  (CATALOG.upgrades ?? []).map((u) => [u.id, u]),
);

export function unitById(id: string): Unit | undefined {
  return UNITS_BY_ID[id];
}

export function upgradeById(id: string): Upgrade | undefined {
  return UPGRADES_BY_ID[id];
}
