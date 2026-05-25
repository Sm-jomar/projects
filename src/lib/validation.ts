import type { ArmyEntry, FactionId, Rank, Unit } from "./types";
import { unitById } from "../data/catalog";
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

export function totalPoints(entries: ArmyEntry[]): number {
  return getUnits(entries).reduce((sum, u) => sum + u.points, 0);
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

export function validateArmy(state: ArmyState): ValidationReport {
  const units = getUnits(state.entries);
  const totalPts = units.reduce((s, u) => s + u.points, 0);
  const rankCounts = countByRank(state.entries);
  const issues: ValidationIssue[] = [];

  // Faction lock — defensive; UI should prevent this
  for (const u of units) {
    if (u.faction !== state.faction) {
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
  if (candidate.faction !== state.faction) {
    return { ok: false, reason: "Wrong faction." };
  }
  if (candidate.is_unique && state.entries.some((e) => e.unitId === candidate.id)) {
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
