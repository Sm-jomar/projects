import type { Catalog, Unit, Upgrade } from "../lib/types";
import baseRaw from "./catalog.base.json";
import { SEED_UNITS } from "./catalog.seed";

const base = baseRaw as unknown as Catalog;

export const CATALOG: Catalog = {
  version: base.version,
  // SEED_UNITS is the single source of truth for units (regenerated from
  // the fandom Unit_List wiki page); base.json keeps upgrades and command
  // cards.
  units: SEED_UNITS,
  upgrades: (base.upgrades ?? []) as Upgrade[],
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
