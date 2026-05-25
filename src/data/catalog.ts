import type { Catalog, Unit } from "../lib/types";
import baseRaw from "./catalog.base.json";
import { SEED_UNITS } from "./catalog.seed";

const base = baseRaw as unknown as Catalog;

export const CATALOG: Catalog = {
  version: base.version,
  units: [...(base.units as Unit[]), ...SEED_UNITS],
  upgrades: base.upgrades,
  commandCards: base.commandCards,
};

export const UNITS_BY_ID: Record<string, Unit> = Object.fromEntries(
  CATALOG.units.map((u) => [u.id, u])
);

export function unitById(id: string): Unit | undefined {
  return UNITS_BY_ID[id];
}
