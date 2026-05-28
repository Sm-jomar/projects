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

  // ============= REBELS (re-paired by repair_faction_pairings.py) =============
  "rebels-mark-ii-medium-blaster-trooper": "cards/rebels/unit/mark-ii-medium-blaster-trooper.jpg",
  "rebels-rebel-troopers": "cards/rebels/unit/rebel-troopers.jpg",
  "rebels-fleet-troopers": "cards/rebels/unit/fleet-troopers.jpg",
  "rebels-rebel-veterans": "cards/rebels/unit/rebel-veterans.jpg",
  "rebels-rebel-commandos": "cards/rebels/unit/rebel-commandos.jpg",
  "rebels-wookiee-warriors-freedom-fighters": "cards/rebels/unit/wookiee-warriors-freedom-fighters.jpg",
  "rebels-wookiee-warriors-kashyyyk-resistance": "cards/rebels/unit/wookiee-warriors-kashyyyk-resistance.jpg",
  "rebels-mandalorian-resistance": "cards/rebels/unit/mandalorian-resistance.jpg",
  "rebels-mandalorian-resistance-clan-wren": "cards/rebels/unit/mandalorian-resistance-clan-wren.jpg",
  "rebels-rebel-sleeper-cell": "cards/rebels/unit/rebel-sleeper-cell.jpg",
  "rebels-at-rt": "cards/rebels/unit/at-rt.jpg",
  "rebels-1-4-fd-laser-cannon-team": "cards/rebels/unit/1-4-fd-laser-cannon-team.jpg",
  "rebels-tauntaun-riders": "cards/rebels/unit/tauntaun-riders.jpg",
  "rebels-t-47-airspeeder": "cards/rebels/unit/t-47-airspeeder.jpg",
  "rebels-x-34-landspeeder": "cards/rebels/unit/x-34-landspeeder.jpg",
  "rebels-c-3po-golden-god": "cards/rebels/unit/c-3po.jpg",
  "rebels-leia-organa": "cards/rebels/unit/leia-organa.jpg",
  "rebels-han-solo": "cards/rebels/unit/han-solo.jpg",
  "rebels-luke-skywalker-hero-of-the-rebellion": "cards/rebels/unit/luke-skywalker-hero.jpg",
  "rebels-cassian-andor": "cards/rebels/unit/cassian-andor.jpg",
  "rebels-jyn-erso": "cards/rebels/unit/jyn-erso.jpg",
  "rebels-lando-calrissian": "cards/rebels/unit/lando-calrissian.jpg",
  "rebels-sabine-wren": "cards/rebels/unit/sabine-wren.jpg",
  "rebels-luke-skywalker-jedi-knight": "cards/rebels/unit/luke-skywalker-jedi.jpg",
  "rebels-chewbacca": "cards/rebels/unit/chewbacca.jpg",
  "rebels-r2-d2": "cards/rebels/unit/r2-d2.jpg",
  "rebels-k-2so": "cards/rebels/unit/k-2so.jpg",
  "rebels-ahsoka-tano-fulcrum": "cards/rebels/unit/ahsoka-tano.jpg",
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

  // ============= SEPARATISTS (re-paired by repair_faction_pairings.py) =============
  "separatists-b1-battle-droids": "cards/separatists/unit/b1-battle-droids.jpg",
  "separatists-b2-super-battle-droids": "cards/separatists/unit/b2-super-battle-droids.jpg",
  "separatists-geonosian-warriors": "cards/separatists/unit/geonosian-warriors.jpg",
  "separatists-bx-series-droid-commandos": "cards/separatists/unit/bx-series-droid-commandos.jpg",
  "separatists-ig-100-magnaguards": "cards/separatists/unit/ig-100-magnaguards.jpg",
  "separatists-ig-100-magnaguards-prototype-assassin-droids": "cards/separatists/unit/ig-100-magnaguards-prototype.jpg",
  "separatists-stap-riders": "cards/separatists/unit/stap-riders.jpg",
  "separatists-dsd1-dwarf-spider-droid": "cards/separatists/unit/dsd1-dwarf-spider-droid.jpg",
  "separatists-aat-battle-tank": "cards/separatists/unit/aat-battle-tank.jpg",
  "separatists-nr-n99-persuader-class-tank-droid": "cards/separatists/unit/persuader-class-tank-droid.jpg",
  "separatists-nr-n99-persuader-class-tank-droid-prototype-tank-droid": "cards/separatists/unit/persuader-prototype-tank-droid.jpg",
  "separatists-general-grievous-sinister-cyborg": "cards/separatists/unit/general-grievous.jpg",
  "separatists-count-dooku-darth-tyranus": "cards/separatists/unit/count-dooku.jpg",
  "separatists-kraken": "cards/separatists/unit/kraken.jpg",
  "separatists-t-series-tactical-droid": "cards/separatists/unit/t-series-tactical-droid.jpg",
  "separatists-kalani": "cards/separatists/unit/kalani.jpg",
  "separatists-maul": "cards/separatists/unit/maul.jpg",
  "separatists-drk-1-sith-probe-droids": "cards/separatists/unit/drk-1-sith-probe-droids.jpg",
  "separatists-poggle-the-lesser": "cards/separatists/unit/poggle-the-lesser.jpg",
  "separatists-asajj-ventress-sith-assassin": "cards/separatists/unit/asajj-ventress.jpg",
  "separatists-sun-fac": "cards/separatists/unit/sun-fac.jpg",
  "separatists-bossk-trandoshan-terror": "cards/mercenary/unit/bossk.jpg",
  // Separatists with no source card:
  "separatists-aqua-droids": null,
  "separatists-lm-432-crab-droid": null,
  "separatists-droidekas": null,
  "separatists-bx-series-droid-commandos-strike-team": null,
  "separatists-super-tactical-command-droid": null,
  "separatists-super-tactical-command-droid-operative": null,

  // ============= REPUBLIC (re-paired by repair_faction_pairings.py) =============
  "republic-clone-trooper-infantry": "cards/republic/unit/clone-trooper-infantry.jpg",
  "republic-arc-troopers": "cards/republic/unit/arc-troopers.jpg",
  "republic-wookiee-warriors-kashyyyk-defenders": "cards/republic/unit/wookiee-warriors-kashyyyk-defenders.jpg",
  "republic-wookiee-warriors-noble-fighters": "cards/republic/unit/wookiee-warriors-noble-fighters.jpg",
  "republic-barc-speeder": "cards/republic/unit/barc-speeder.jpg",
  "republic-at-rt-galactic-republic": "cards/republic/unit/at-rt.jpg",
  "republic-raddaugh-gnasp-fluttercraft": "cards/republic/unit/raddaugh-gnasp-fluttercraft.jpg",
  "republic-raddaugh-gnasp-fluttercraft-attack-craft": "cards/republic/unit/raddaugh-gnasp-fluttercraft-attack.jpg",
  "republic-clone-commandos": "cards/republic/unit/clone-commandos.jpg",
  "republic-clone-commandos-delta-squad": "cards/republic/unit/clone-commandos-delta-squad.jpg",
  "republic-tx-130-saber-class-fighter-tank": "cards/republic/unit/saber-class-tank.jpg",
  "republic-infantry-support-platform": "cards/republic/unit/infantry-support-platform.jpg",
  "republic-laat-le-patrol-transport-republic": "cards/republic/unit/laat-le-patrol-transport.jpg",
  "republic-obi-wan-kenobi-civilized-warrior": "cards/republic/unit/obi-wan-kenobi.jpg",
  "republic-clone-captain-rex": "cards/republic/unit/clone-captain-rex.jpg",
  "republic-anakin-skywalker-hero-without-fear": "cards/republic/unit/anakin-skywalker.jpg",
  "republic-yoda-grand-master-of-the-jedi-order": "cards/republic/unit/yoda.jpg",
  "republic-clone-commander": "cards/republic/unit/clone-commander.jpg",
  "republic-wookiee-chieftain": "cards/republic/unit/wookiee-chieftain.jpg",
  "republic-clone-commander-cody": "cards/republic/unit/clone-commander-cody.jpg",
  "republic-chewbacca-republic": "cards/republic/unit/chewbacca.jpg",
  "republic-padme-amidala-spirited-senator": "cards/republic/unit/padme-amidala.jpg",
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
