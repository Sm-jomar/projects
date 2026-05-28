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
// JSON exports. `null` means "no source card available, show the empty
// state instead of a fuzzy-matched wrong card."
const UNIT_CARD_OVERRIDES: Record<string, string | null> = {
  // ============= IMPERIALS (re-paired by repair_imperial_pairings.py) =============
  "imperials-74-z-speeder-bikes": "cards/imperials/unit/74-z-speeder-bikes.jpg",
  "imperials-agent-kallus": "cards/imperials/unit/agent-kallus.jpg",
  "imperials-at-st": "cards/imperials/unit/at-st.jpg",
  "imperials-darth-vader-dark-lord-of-the-sith": "cards/imperials/unit/darth-vader-dark-lord.jpg",
  "imperials-darth-vader-the-emperor-s-apprentice": "cards/imperials/unit/darth-vader-apprentice.jpg",
  "imperials-dewback-rider": "cards/imperials/unit/dewback-rider.jpg",
  "imperials-df-90-mortar-trooper": "cards/imperials/unit/df-90-mortar-trooper.jpg",
  "imperials-director-orson-krennic": "cards/imperials/unit/director-orson-krennic.jpg",
  "imperials-e-web-heavy-blaster-team": "cards/imperials/unit/e-web-heavy-blaster-team.jpg",
  "imperials-fifth-brother": "cards/imperials/unit/fifth-brother.jpg",
  "imperials-general-veers": "cards/imperials/unit/general-veers.jpg",
  "imperials-iden-versio": "cards/imperials/unit/iden-versio.jpg",
  "imperials-imperial-dark-troopers": "cards/imperials/unit/imperial-dark-troopers.jpg",
  "imperials-imperial-death-troopers": "cards/imperials/unit/imperial-death-troopers.jpg",
  "imperials-imperial-special-forces-inferno-squad": "cards/imperials/unit/imperial-special-forces-inferno.jpg",
  "imperials-laat-le-patrol-transport": "cards/imperials/unit/laat-le-patrol-transport.jpg",
  "imperials-major-marquand": "cards/imperials/unit/major-marquand.jpg",
  "imperials-moff-gideon": "cards/imperials/unit/moff-gideon.jpg",
  "imperials-range-troopers": "cards/imperials/unit/range-troopers.jpg",
  "imperials-scout-troopers": "cards/imperials/unit/scout-troopers.jpg",
  "imperials-seventh-sister": "cards/imperials/unit/seventh-sister.jpg",
  "imperials-shoretroopers": "cards/imperials/unit/shoretroopers.jpg",
  "imperials-snowtroopers": "cards/imperials/unit/snowtroopers.jpg",
  "imperials-stormtroopers": "cards/imperials/unit/stormtroopers.jpg",
  "imperials-stormtroopers-heavy-response-unit": "cards/imperials/unit/stormtroopers-hru.jpg",
  "imperials-stormtrooper-riot-squad": "cards/imperials/unit/stormtrooper-riot-squad.jpg",
  "imperials-tx-225-gavw-occupier-tank": "cards/imperials/unit/tx-225-gavw-occupier-tank.jpg",
  "imperials-ig-88-assassin-droid": "cards/mercenary/unit/1g-88.jpg",
  "imperials-ig-11-nurse-droid": "cards/mercenary/unit/ig-11.jpg",
  "imperials-boba-fett-infamous-bounty-hunter": "cards/mercenary/unit/boba-fett-bounty-hunter.jpg",
  "imperials-bossk-trandoshan-terror": "cards/mercenary/unit/bossk.jpg",
  // Imperials still without a paired card:
  "imperials-imperial-special-forces": null,  // regular Special Forces front not detected
  "imperials-scout-troopers-strike-team": null,

  // ============= REBELS =============
  "rebels-x-34-landspeeder": "cards/rebels/unit/x-34-lannsspeeder.jpg",
  "rebels-t-47-airspeeder": "cards/rebels/unit/ts4i7-airsppeeeder.jpg",
  "rebels-1-4-fd-laser-cannon-team": "cards/rebels/unit/1-4ed-laser-cannon-team.jpg",
  "rebels-wookiee-warriors-freedom-fighters": "cards/rebels/unit/wookkiee-warriors.jpg",
  "rebels-wookiee-warriors-kashyyyk-resistance": "cards/rebels/unit/wookkiee-warriors-2.jpg",
  "rebels-rebel-sleeper-cell": "cards/rebels/unit/reee-sleeper-cell.jpg",
  "rebels-rebel-commandos": "cards/rebels/unit/rpeee-commandos.jpg",
  "rebels-rebel-veterans": "cards/rebels/unit/rpeee-veterans.jpg",
  "rebels-rebel-troopers": "cards/rebels/unit/reeel-troopers.jpg",
  "rebels-mark-ii-medium-blaster-trooper": "cards/rebels/unit/mark-lil-medium-blaster-rooper.jpg",
  "rebels-fleet-troopers": "cards/rebels/unit/fleet-troopers.jpg",
  "rebels-k-2so": "cards/rebels/unit/kk-2s50.jpg",
  "rebels-ahsoka-tano-fulcrum": "cards/rebels/unit/fahsoka-tano.jpg",
  "rebels-lando-calrissian": "cards/rebels/unit/lanbo-calrissian.jpg",
  "rebels-luke-skywalker-hero-of-the-rebellion": "cards/rebels/unit/luke-skywalker.jpg",
  "rebels-luke-skywalker-jedi-knight": "cards/rebels/unit/luke-skywalker-2.jpg",
  "rebels-mandalorian-resistance": "cards/rebels/unit/mandalorian-resistance.jpg",
  "rebels-mandalorian-resistance-clan-wren": "cards/rebels/unit/mandalorian-resistance-2.jpg",
  "rebels-at-rt": "cards/rebels/unit/at-r-t.jpg",
  "rebels-logray-superstitious-shaman": "cards/mercenary/unit/logray.jpg",
  "rebels-the-bad-batch": "cards/mercenary/unit/the-bap-batch.jpg",
  "rebels-din-djarin-the-mandalorian": "cards/mercenary/unit/din-djarin.jpg",
  "rebels-ewok-skirmishers": "cards/mercenary/unit/ewok-skirmishers.jpg",
  "rebels-ewok-slingers": "cards/mercenary/unit/ework-slingers.jpg",
  "rebels-wicket-hero-of-bright-tree": "cards/mercenary/unit/wicket.jpg",
  "rebels-boba-fett-daimyo-of-mos-espa": "cards/mercenary/unit/boba-fett.jpg",
  "rebels-ig-11-nurse-droid": "cards/mercenary/unit/ig-11.jpg",
  // Rebels with no source card:
  "rebels-chewbacca-let-the-wookiee-win": null,
  "rebels-rebel-commandos-strike-team": null,
  "rebels-rebel-agent": null,
  "rebels-rebel-officer": null,

  // ============= SEPARATISTS =============
  "separatists-nr-n99-persuader-class-tank-droid": "cards/separatists/unit/persuader-class-tank-droid.jpg",
  "separatists-nr-n99-persuader-class-tank-droid-prototype-tank-droid": "cards/separatists/unit/persuader-class-tank-droip.jpg",
  "separatists-aat-battle-tank": "cards/separatists/unit/aat-battle-tank.jpg",
  "separatists-stap-riders": "cards/separatists/unit/stap-rinpers.jpg",
  "separatists-dsd1-dwarf-spider-droid": "cards/separatists/unit/d0sd1-dware-e-spiper-droip.jpg",
  "separatists-ig-100-magnaguards": "cards/separatists/unit/1g-100-magnaguard.jpg",
  "separatists-ig-100-magnaguards-prototype-assassin-droids": "cards/separatists/unit/1g-100-magnnaaguard.jpg",
  "separatists-drk-1-sith-probe-droids": "cards/separatists/unit/drk-1-siry-proee-droins.jpg",
  "separatists-bx-series-droid-commandos": "cards/separatists/unit/by-serices-droip-commanpos.jpg",
  "separatists-b2-super-battle-droids": "cards/separatists/unit/b82-super-battrtr-le-droins.jpg",
  "separatists-b1-battle-droids": "cards/separatists/unit/b1-battt-le-droins.jpg",
  "separatists-t-series-tactical-droid": "cards/separatists/unit/t-series-tactical-droid.jpg",
  "separatists-poggle-the-lesser": "cards/separatists/unit/poggle-the-lesser.jpg",
  "separatists-kraken": "cards/separatists/unit/icraken.jpg",
  "separatists-kalani": "cards/separatists/unit/cikalani.jpg",
  "separatists-count-dooku-darth-tyranus": "cards/separatists/unit/count-dooku.jpg",
  "separatists-asajj-ventress-sith-assassin": "cards/separatists/unit/efaasajj-ventress.jpg",
  "separatists-bossk-trandoshan-terror": "cards/mercenary/unit/bossk.jpg",
  // Separatists with no source card:
  "separatists-aqua-droids": null,
  "separatists-lm-432-crab-droid": null,
  "separatists-droidekas": null,
  "separatists-bx-series-droid-commandos-strike-team": null,
  "separatists-super-tactical-command-droid": null,
  "separatists-super-tactical-command-droid-operative": null,

  // ============= REPUBLIC =============
  "republic-tx-130-saber-class-fighter-tank": "cards/republic/unit/gsaper-class-tank.jpg",
  "republic-laat-le-patrol-transport-republic": "cards/republic/unit/laat-l-ee-pattrrol-transport.jpg",
  "republic-infantry-support-platform": "cards/republic/unit/infantry-suppppoort-platform.jpg",
  "republic-raddaugh-gnasp-fluttercraft": "cards/republic/unit/raddaugh-gnasp-fluttercraft.jpg",
  "republic-raddaugh-gnasp-fluttercraft-attack-craft": "cards/republic/unit/raddaugh-gnasp-fluttercraft-2.jpg",
  "republic-clone-commandos": "cards/republic/unit/clone-commandos.jpg",
  "republic-clone-commandos-delta-squad": "cards/republic/unit/clone-commandos-2.jpg",
  "republic-barc-speeder": "cards/republic/unit/barc-sppeeder.jpg",
  "republic-wookiee-warriors-noble-fighters": "cards/republic/unit/woookiee-warriors.jpg",
  "republic-wookiee-warriors-kashyyyk-defenders": "cards/republic/unit/woookiee-warriors-2.jpg",
  "republic-padme-amidala-spirited-senator": "cards/republic/unit/papdme-amidala.jpg",
  "republic-wookiee-chieftain": "cards/republic/unit/wookkiee-chieftain.jpg",
  "republic-obi-wan-kenobi-civilized-warrior": "cards/republic/unit/opbi-wann-kenobi.jpg",
  "republic-clone-commander-cody": "cards/republic/unit/clone-commander-copy.jpg",
  // Republic with no source card:
  "republic-arf-troopers": null,
  "republic-arc-troopers-strike-team": null,
  "republic-clone-trooper-marksmen": null,
  "republic-jedi-knight": null,
  "republic-jedi-knight-general": null,
  "republic-ahsoka-tano-padawan-commander": null,

  // ============= MERCENARY =============
  "mercenary-pyke-syndicate-foot-soldiers": "cards/mercenary/unit/dbvyie-svynpicate-foot-so-lpiers-i.jpg",
  "mercenary-black-sun-enforcers": "cards/mercenary/unit/black-sun-enfoorcers.jpg",
  "mercenary-black-sun-vigo": "cards/mercenary/unit/black-sun-vigo.jpg",
  "mercenary-cad-bane-needs-no-introduction": "cards/mercenary/unit/cap-bane.jpg",
  "mercenary-a-a5-speeder-truck": "cards/mercenary/unit/ya-l-fs5-speeeepeeer-truck.jpg",
  "mercenary-gar-saxon-militant-commando": "cards/mercenary/unit/garr-saxon.jpg",
  "mercenary-pyke-syndicate-capo": "cards/mercenary/unit/bvice-svyynpicate-capo.jpg",
  "mercenary-swoop-bike-riders": "cards/mercenary/unit/4-swoop-bike-ringers.jpg",
  // Mercenary with no source card:
  "mercenary-hondo-ohnaka": null,
  "mercenary-weequay-pirates": null,
  "mercenary-wlo-5-speeder-tank": null,
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
