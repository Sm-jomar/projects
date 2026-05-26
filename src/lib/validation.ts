import type { ArmyEntry, FactionId, Rank, Unit, Upgrade } from "./types";
import { unitById, upgradeById } from "../data/catalog";
import { RANK_LIMITS, RANK_LABEL, RANK_ORDER } from "./factions";

export type ArmyState = {
  faction: FactionId;
  pointsCap: number;
  entries: ArmyEntry[];
};

export type ValidationIssue = {
  severity: "error" | "warning";
  message: string;
};

export type ValidationReport = {
  totalPoints: number;
  pointsCap: number;
  overPoints: boolean;
  rankCounts: Record<Rank, number>;
  issues: ValidationIssue[];
  isLegal: boolean;
};

function getUnits(entries: ArmyEntry[]): Unit[] {
  return entries
    .map((e) => unitById(e.unitId))
    .filter((u): u is Unit => Boolean(u));
}

export function entryPoints(entry: ArmyEntry): number {
  const unit = unitById(entry.unitId);
  if (!unit) return 0;
  let total = unit.points;
  for (const upId of entry.upgrades ?? []) {
    const up = upgradeById(upId);
    if (up) total += up.points;
  }
  return total;
}

export function totalPoints(entries: ArmyEntry[]): number {
  return entries.reduce((sum, e) => sum + entryPoints(e), 0);
}

export function countByRank(entries: ArmyEntry[]): Record<Rank, number> {
  const counts = {
    commander: 0,
    operative: 0,
    corps: 0,
    "special-forces": 0,
    support: 0,
    heavy: 0,
  } as Record<Rank, number>;
  for (const u of getUnits(entries)) counts[u.rank]++;
  return counts;
}

export type SlotUsage = {
  used: Record<string, number>;
  available: Record<string, number>;
};

export function slotUsage(entry: ArmyEntry): SlotUsage {
  const unit = unitById(entry.unitId);
  const available: Record<string, number> = {};
  if (unit?.upgrades) {
    for (const [k, n] of Object.entries(unit.upgrades)) {
      if (n) available[k] = (available[k] ?? 0) + n;
    }
  }
  // Some upgrades grant additional slots; fold those in.
  for (const upId of entry.upgrades ?? []) {
    const up = upgradeById(upId);
    if (up?.adds_upgrade_slots) {
      for (const [k, n] of Object.entries(up.adds_upgrade_slots)) {
        if (n) available[k] = (available[k] ?? 0) + n;
      }
    }
  }
  const used: Record<string, number> = {};
  for (const upId of entry.upgrades ?? []) {
    const up = upgradeById(upId);
    if (!up) continue;
    used[up.type] = (used[up.type] ?? 0) + 1;
  }
  return { used, available };
}

export function validateArmy(state: ArmyState): ValidationReport {
  const units = getUnits(state.entries);
  const totalPts = totalPoints(state.entries);
  const rankCounts = countByRank(state.entries);
  const issues: ValidationIssue[] = [];

  // Faction lock — defensive; UI should prevent this
  for (const u of units) {
    const inFaction =
      u.faction === state.faction ||
      (u.also_factions ?? []).includes(state.faction);
    if (!inFaction) {
      issues.push({
        severity: "error",
        message: `${u.name} (${u.faction}) does not belong to this army's faction.`,
      });
    }
  }

  // Points cap
  if (totalPts > state.pointsCap) {
    issues.push({
      severity: "error",
      message: `Over the ${state.pointsCap}-point cap by ${
        totalPts - state.pointsCap
      } points.`,
    });
  }

  // Rank min / max
  for (const rank of RANK_ORDER) {
    const limit = RANK_LIMITS[rank];
    const c = rankCounts[rank];
    if (c < limit.min) {
      issues.push({
        severity: "error",
        message: `Need at least ${limit.min} ${RANK_LABEL[rank]} (have ${c}).`,
      });
    }
    if (c > limit.max) {
      issues.push({
        severity: "error",
        message: `Too many ${RANK_LABEL[rank]} (max ${limit.max}, have ${c}).`,
      });
    }
  }

  // Unique uniqueness
  const seenUnique = new Set<string>();
  for (const u of units) {
    if (u.is_unique) {
      if (seenUnique.has(u.id)) {
        issues.push({
          severity: "error",
          message: `${u.name} is unique and can only be taken once.`,
        });
      }
      seenUnique.add(u.id);
    }
  }

  // Unique upgrades (one copy across the army)
  const seenUniqueUp = new Set<string>();
  for (const e of state.entries) {
    for (const upId of e.upgrades ?? []) {
      const up = upgradeById(upId);
      if (up?.is_unique) {
        if (seenUniqueUp.has(up.id)) {
          issues.push({
            severity: "error",
            message: `Upgrade "${up.name}" is unique and can only appear once.`,
          });
        }
        seenUniqueUp.add(up.id);
      }
    }
  }

  // Slot capacity per entry
  for (const e of state.entries) {
    const usage = slotUsage(e);
    for (const [slot, n] of Object.entries(usage.used)) {
      const cap = usage.available[slot] ?? 0;
      if (n > cap) {
        const unit = unitById(e.unitId);
        issues.push({
          severity: "error",
          message: `${unit?.name ?? "Unit"}: too many ${slot} upgrades (max ${cap}, have ${n}).`,
        });
      }
    }
  }

  return {
    totalPoints: totalPts,
    pointsCap: state.pointsCap,
    overPoints: totalPts > state.pointsCap,
    rankCounts,
    issues,
    isLegal: issues.every((i) => i.severity !== "error"),
  };
}

// Pre-flight check: can this unit be added without breaking rules?
export type AddCheck =
  | { ok: true }
  | { ok: false; reason: string };

export function canAdd(state: ArmyState, candidate: Unit): AddCheck {
  const inFaction =
    candidate.faction === state.faction ||
    (candidate.also_factions ?? []).includes(state.faction);
  if (!inFaction) {
    return { ok: false, reason: "Wrong faction." };
  }
  if (
    candidate.is_unique &&
    state.entries.some((e) => e.unitId === candidate.id)
  ) {
    return { ok: false, reason: "Unique unit already in the army." };
  }
  const counts = countByRank(state.entries);
  const limit = RANK_LIMITS[candidate.rank];
  if (counts[candidate.rank] >= limit.max) {
    return {
      ok: false,
      reason: `Max ${limit.max} ${RANK_LABEL[candidate.rank]} already.`,
    };
  }
  if (totalPoints(state.entries) + candidate.points > state.pointsCap) {
    return { ok: false, reason: "Would exceed points cap." };
  }
  return { ok: true };
}

export function canAddUpgrade(
  state: ArmyState,
  entry: ArmyEntry,
  upgrade: Upgrade,
): AddCheck {
  // Restricted whitelist
  if (upgrade.restricted_to_unit && upgrade.restricted_to_unit.length > 0) {
    if (!upgrade.restricted_to_unit.some((r) => r.id === entry.unitId)) {
      return { ok: false, reason: "Not allowed on this unit." };
    }
  }
  // Slot available
  const usage = slotUsage(entry);
  const cap = usage.available[upgrade.type] ?? 0;
  if (cap === 0) {
    return { ok: false, reason: `No ${upgrade.type} slot on this unit.` };
  }
  if ((usage.used[upgrade.type] ?? 0) >= cap) {
    return { ok: false, reason: `${upgrade.type} slot full.` };
  }
  // Already attached
  if ((entry.upgrades ?? []).includes(upgrade.id)) {
    return { ok: false, reason: "Already attached." };
  }
  // Unique across army
  if (upgrade.is_unique) {
    const alreadyTaken = state.entries.some((e) =>
      (e.upgrades ?? []).includes(upgrade.id),
    );
    if (alreadyTaken) {
      return { ok: false, reason: "Unique upgrade already in army." };
    }
  }
  // Points cap
  if (totalPoints(state.entries) + upgrade.points > state.pointsCap) {
    return { ok: false, reason: "Would exceed points cap." };
  }
  return { ok: true };
}
