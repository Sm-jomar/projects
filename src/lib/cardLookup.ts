import manifestRaw from "../data/card-manifest.json";
import type { Unit } from "./types";

type CardEntry = {
  faction: string;
  kind: string;
  title: string;
  slug: string;
  file: string;
  source: string;
  points?: number | null;
};

const MANIFEST = manifestRaw as CardEntry[];
const BASE = import.meta.env.BASE_URL;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const BY_KEY: Map<string, CardEntry[]> = (() => {
  const m = new Map<string, CardEntry[]>();
  for (const c of MANIFEST) {
    const key = `${c.faction}:${c.kind}`;
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(c);
  }
  return m;
})();

function score(target: string, candidate: string): number {
  if (!target || !candidate) return 0;
  if (target === candidate) return 1000;
  // Strip trailing -N (front/back variants) from candidate before scoring
  const cand = candidate.replace(/-\d+$/, "");
  if (cand === target) return 950;
  if (cand.startsWith(target) || target.startsWith(cand)) return 800 - Math.abs(cand.length - target.length);
  // Compare on token sets
  const a = new Set(target.split("-"));
  const b = new Set(cand.split("-"));
  let overlap = 0;
  for (const t of a) if (b.has(t)) overlap++;
  if (overlap === 0) return 0;
  return 500 + overlap * 50 - Math.abs(a.size - b.size) * 10;
}

function findBest(
  faction: string,
  kind: string,
  targetSlug: string,
  altSlug?: string,
): CardEntry | null {
  const pool = BY_KEY.get(`${faction}:${kind}`) ?? [];
  let best: CardEntry | null = null;
  let bestScore = 0;
  for (const c of pool) {
    const s = Math.max(score(targetSlug, c.slug), altSlug ? score(altSlug, c.slug) : 0);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return bestScore >= 500 ? best : null;
}

export function cardForUnit(unit: Pick<Unit, "id" | "name" | "faction"> & { also_factions?: string[] }): string | null {
  const target = slugify(unit.name);
  const idSlug = slugify(unit.id);
  const tried = new Set<string>();
  const factions = [unit.faction, ...(unit.also_factions ?? [])];
  // First try the unit's own factions, then fall back to every other
  // faction in case the source PDF filed the card elsewhere (mercenary
  // cards for units we've re-homed to a primary faction, etc.).
  const allFactions = [
    "rebels",
    "imperials",
    "republic",
    "separatists",
    "mercenary",
    "generic",
  ];
  const order = [...factions, ...allFactions.filter((f) => !factions.includes(f))];
  for (const f of order) {
    if (tried.has(f)) continue;
    tried.add(f);
    const hit = findBest(f, "unit", target, idSlug);
    if (hit) return BASE + hit.file;
  }
  return null;
}

export function cardForUpgrade(args: {
  id: string;
  name: string;
  faction?: string;
}): string | null {
  const target = slugify(args.name);
  const idSlug = slugify(args.id);
  const factions = args.faction
    ? [args.faction, "generic"]
    : ["generic", "rebels", "imperials", "republic", "separatists", "mercenary"];
  for (const f of factions) {
    const hit = findBest(f, "upgrade", target, idSlug);
    if (hit) return BASE + hit.file;
  }
  return null;
}
