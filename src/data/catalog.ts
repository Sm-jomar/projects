import type { Catalog, Unit, Upgrade } from "../lib/types";
import baseRaw from "./catalog.base.json";
import { SEED_UNITS } from "./catalog.seed";
import overridesRaw from "./catalog-overrides.json";

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

export const CATALOG: Catalog = {
  version: base.version,
  // SEED_UNITS is the single source of truth for units (regenerated from
  // the fandom Unit_List wiki page); base.json keeps upgrades and command
  // cards.
  units: applyOverrides(SEED_UNITS, OVERRIDES.units),
  upgrades: applyOverrides((base.upgrades ?? []) as Upgrade[], OVERRIDES.upgrades),
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
