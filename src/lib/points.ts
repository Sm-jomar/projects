import adjustmentsRaw from "../data/points-adjustments.json";
import type { Unit, Upgrade } from "./types";

type UnitAdjustment = {
  printed: number;
  v2_6?: number;
  faction: string;
};

type UpgradeAdjustment = {
  printed: number;
  v2_6?: number;
  faction: string;
  card: string;
};

type AdjustmentsFile = {
  units: Record<string, UnitAdjustment>;
  upgrades: Record<string, UpgradeAdjustment>;
};

const ADJ = adjustmentsRaw as AdjustmentsFile;

export type PointsMode = "printed" | "v2_6";

export const POINTS_MODE_LABEL: Record<PointsMode, string> = {
  printed: "Printed (cards)",
  v2_6: "Tournament 2.6",
};

function _norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Look up the 2.6 adjustment for a unit by name + faction. Returns null
 * if the unit isn't in the tournament table (use the catalog's points). */
function unitAdjustment(unit: Pick<Unit, "name" | "faction">): UnitAdjustment | null {
  // Exact name match first (Boba Fett, etc.)
  const direct = ADJ.units[unit.name];
  if (direct && direct.faction === unit.faction) return direct;
  // Fuzzy / faction-tolerant fallback.
  const target = _norm(unit.name);
  for (const entry of Object.values(ADJ.units)) {
    if (entry.faction !== unit.faction) continue;
    if (_norm(entry === direct ? "" : "") === target) return entry; // dead branch
  }
  for (const [name, entry] of Object.entries(ADJ.units)) {
    if (_norm(name) === target && entry.faction === unit.faction) return entry;
  }
  return null;
}

function upgradeAdjustment(upgrade: Pick<Upgrade, "name"> & { faction?: string }): UpgradeAdjustment | null {
  if (upgrade.faction) {
    const direct = ADJ.upgrades[`${upgrade.faction}:${upgrade.name}`];
    if (direct) return direct;
  }
  // Try the generic table.
  const generic = ADJ.upgrades[`generic:${upgrade.name}`];
  if (generic) return generic;
  // Fuzzy fallback over all factions.
  const target = _norm(upgrade.name);
  for (const entry of Object.values(ADJ.upgrades)) {
    if (_norm(entry.card) === target) return entry;
  }
  return null;
}

export function effectiveUnitPoints(
  unit: Pick<Unit, "name" | "faction" | "points">,
  mode: PointsMode,
): number {
  if (mode === "printed") return unit.points;
  const adj = unitAdjustment(unit);
  if (adj && adj.v2_6 !== undefined) return adj.v2_6;
  return unit.points;
}

export function effectiveUpgradePoints(
  upgrade: Pick<Upgrade, "name" | "points"> & { faction?: string },
  mode: PointsMode,
): number {
  if (mode === "printed") return upgrade.points;
  const adj = upgradeAdjustment(upgrade);
  if (adj && adj.v2_6 !== undefined) return adj.v2_6;
  return upgrade.points;
}

/** Returns the diff between printed and effective cost (positive = costs
 * more under 2.6). Used for the small "(was X)" hint in the UI. */
export function pointsDelta(
  printed: number,
  effective: number,
): number {
  return effective - printed;
}
