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
  if (cand.startsWith(target) || target.startsWith(cand))
    return 800 - Math.abs(cand.length - target.length);
  // Compare on token sets — require at least 2 distinct shared tokens
  // (longer than 2 chars each) before considering it a real match, so a
  // single common word like "the" or "tank" doesn't pull in unrelated
  // cards (e.g. Hondo Ohnaka onto The Ohnaka Gang command card).
  const tokens = (s: string) =>
    new Set(s.split("-").filter((t) => t.length >= 3));
  const a = tokens(target);
  const b = tokens(cand);
  let overlap = 0;
  for (const t of a) if (b.has(t)) overlap++;
  if (overlap < 2) return 0;
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
  // Bumped from 500 -> 700: a single weak token overlap was matching
  // unrelated cards. 700 requires a substring containment or at least
  // 2-token overlap with similar set sizes.
  return bestScore >= 700 ? best : null;
}

// Hand-curated map of catalog unit id -> card file path (relative to public/).
// Used when fuzzy matching against OCR-mangled card slugs would fail or pull
// the wrong card. Each entry was verified from the user's flagged-unit
// JSON export.
const UNIT_CARD_OVERRIDES: Record<string, string | null> = {
  // Imperials — files exist under mangled slugs, force-map them.
  "imperials-74-z-speeder-bikes": "cards/imperials/unit/j4a-7-speenper-bikes.jpg",
  "imperials-dewback-rider": "cards/imperials/unit/dewereackk-riner.jpg",
  "imperials-e-web-heavy-blaster-team": "cards/imperials/unit/e-wjee-heavy-blaster-team.jpg",
  "imperials-laat-le-patrol-transport": "cards/imperials/unit/laat-slee-patrro-transport.jpg",
  "imperials-major-marquand": "cards/imperials/unit/masor-marquand.jpg",
  "imperials-moff-gideon": "cards/imperials/unit/mofrf-gideon.jpg",
  "imperials-df-90-mortar-trooper": "cards/imperials/unit/s-de-9go-mortar-trooper.jpg",
  "imperials-stormtrooper-riot-squad": "cards/imperials/unit/strormmtrooper-riot-souad.jpg",
  "imperials-tx-225-gavw-occupier-tank": "cards/imperials/unit/tx-2725-gavw-occupier-tank.jpg",
  "imperials-imperial-special-forces": "cards/imperials/unit/imperial-special-forces.jpg",
  "imperials-imperial-special-forces-inferno-squad": "cards/imperials/unit/imperial-special-forces-2.jpg",
  "imperials-scout-troopers": "cards/imperials/unit/scout-troopers.jpg",
  // Vader variants — best-guess pairing of the three darth-vader-*.jpg files.
  "imperials-darth-vader-dark-lord-of-the-sith": "cards/imperials/unit/darth-vader.jpg",
  "imperials-darth-vader-the-emperor-s-apprentice": "cards/imperials/unit/darth-vader-2.jpg",
  // IG-88 → mercenary/unit/1g-88.jpg (OCR-mangled). IG-11 stays at ig-11.jpg.
  "imperials-ig-88-assassin-droid": "cards/mercenary/unit/1g-88.jpg",
  "imperials-ig-11-nurse-droid": "cards/mercenary/unit/ig-11.jpg",
  // Boba Fett (Infamous Bounty Hunter) — currently no clean single-side card.
  // Use the mercenary/unit/boba-fett.jpg (the Daimyo + Infamous BH composite,
  // not ideal, but better than nothing).
  "imperials-boba-fett-infamous-bounty-hunter": "cards/mercenary/unit/e-boba-fett.jpg",
  // Mercenary — files exist under mangled slugs.
  "mercenary-pyke-syndicate-foot-soldiers": "cards/mercenary/unit/dbvyie-svynpicate-foot-so-lpiers-i.jpg",
  "mercenary-black-sun-enforcers": "cards/mercenary/unit/black-sun-enfoorcers.jpg",
  "mercenary-black-sun-vigo": "cards/mercenary/unit/black-sun-vigo.jpg",
  "mercenary-cad-bane-needs-no-introduction": "cards/mercenary/unit/cap-bane.jpg",
  "mercenary-a-a5-speeder-truck": "cards/mercenary/unit/ya-l-fs5-speeeepeeer-truck.jpg",
  // Cross-faction units: Din Djarin under rebels primary, image in mercenary/.
  "rebels-din-djarin-the-mandalorian": "cards/mercenary/unit/din-djarin.jpg",
  // Units with no card image in the source PDFs — explicitly null so the
  // "No card image found" message shows instead of a wrong fuzzy match.
  "imperials-snowtroopers": null,
  "imperials-shoretroopers": null,
  "imperials-stormtroopers": null,
  "imperials-stormtroopers-heavy-response-unit": null,
  "imperials-imperial-dark-troopers": null,
  "imperials-range-troopers": null,
  "imperials-director-orson-krennic": null,
  "imperials-iden-versio": null,
};

export function cardForUnit(unit: Pick<Unit, "id" | "name" | "faction"> & { also_factions?: string[] }): string | null {
  // Hand-curated override wins.
  if (unit.id in UNIT_CARD_OVERRIDES) {
    const file = UNIT_CARD_OVERRIDES[unit.id];
    return file ? BASE + file : null;
  }
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
