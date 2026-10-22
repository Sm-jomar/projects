import lookupRaw from "../data/tta-list-lookup.json";
import { unitById, upgradeById } from "../data/catalog";
import { BATTLE_FORCES } from "./factions";
import type { PointsMode } from "./points";
import { newId } from "./storage";
import type { ArmyEntry, FactionId, SavedArmy, Unit } from "./types";
import { totalPoints, upgradeFitsUnit } from "./validation";

// Import Tabletop Admiral army lists. TTA exports a list three ways, and
// this accepts any of them (or a mix, pasted together):
//   - JSON (its Tabletop Simulator export): units and upgrades by name.
//   - A listbuilder link: https://tabletopadmiral.com/listbuilder/<Faction>/N-...
//     with units and upgrades by hex public_id.
//   - Text: "Name (Title) 105 + 10 = 115" lines, "--Upgrade (5), ..." under them.
// Names and ids are mapped onto our catalog through tta-list-lookup.json,
// built by scripts/build_tta_list_lookup.py.

type Lookup = {
  unit_ids: Record<string, string>;
  upgrade_ids: Record<string, string>;
  unit_names: Record<string, string[]>;
  upgrade_names: Record<string, string[]>;
};
const LOOKUP = lookupRaw as unknown as Lookup;

export type TtaImport = {
  army: SavedArmy;
  /** Unit and upgrade names (or link ids) with no match in our catalog. */
  unmatched: string[];
  /** The list's points total as TTA reported it, when it did. */
  ttaPoints?: number;
};

type RawUnit = { name: string; upgrades: string[] };
type RawList = {
  name: string;
  faction?: FactionId;
  battleForce?: string;
  points?: number;
  units: RawUnit[];
  unmatched: string[];
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const FACTION_WORDS: [RegExp, FactionId][] = [
  [/rebel/, "rebels"],
  [/empire|imperial/, "imperials"],
  [/republic/, "republic"],
  [/separatist|cis/, "separatists"],
  [/mercenar|shadow/, "mercenary"],
];

function factionFrom(s: string | null | undefined): FactionId | undefined {
  const v = (s ?? "").toLowerCase();
  return FACTION_WORDS.find(([re]) => re.test(v))?.[1];
}

// TTA battle force ids (listbuilder links end in "bf<id>") and spellings.
const TTA_BATTLE_FORCES: Record<string, string> = {
  "1": "Shadow Collective",
  "2": "Separatist Invasion",
  "3": "Echo Base Defenders",
  "4": "501st Legion",
  "5": "Blizzard Force",
  "6": "Imperial Remnant",
  "7": "Bright Tree Village",
  "8": "Tempest Force",
  "9": "Experimental Droids",
  "10": "Wookiee Defenders",
  "11": "212th Attack Battalion",
  "12": "Stormtrooper Battalion",
  "13": "Mandalorian Clans",
  "14": "The Ohnaka Gang",
  "15": "Rapid Interdiction Force",
};
const BF_ALIAS: Record<string, string> = {
  "212attackbattalion": "212th Attack Battalion",
  theonakagang: "The Ohnaka Gang",
};

function battleForceFor(name: string | undefined, faction: FactionId): string | undefined {
  if (!name) return undefined;
  const n = norm(BF_ALIAS[norm(name)] ?? name);
  return (BATTLE_FORCES[faction] ?? []).find((bf) => norm(bf) === n);
}

// ---- parsing ----------------------------------------------------------

function parseJson(text: string): RawList | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const d = data as Record<string, unknown>;
  if (!d || typeof d !== "object" || !Array.isArray(d.units)) return null;
  const name = (u: unknown) =>
    typeof u === "string" ? u : String((u as { name?: unknown })?.name ?? "");
  const units = (d.units as unknown[]).map((u) => ({
    name: name(u),
    upgrades: Array.isArray((u as { upgrades?: unknown })?.upgrades)
      ? ((u as { upgrades: unknown[] }).upgrades.map(name).filter(Boolean))
      : [],
  }));
  const fromLink = typeof d.listlink === "string" ? parseLink(d.listlink) : null;
  return {
    name: typeof d.listname === "string" ? d.listname : "",
    faction: factionFrom(d.armyFaction as string) ?? fromLink?.faction,
    battleForce: typeof d.battleForce === "string" ? d.battleForce : fromLink?.battleForce,
    points: typeof d.points === "number" ? d.points : undefined,
    units: units.filter((u) => u.name),
    unmatched: [],
  };
}

const LINK_RE = /listbuilder\/([^/\s]+)\/(N-[^\s"'<>)]*)/;

function parseLink(text: string): RawList | null {
  const m = LINK_RE.exec(text);
  if (!m) return null;
  let faction: FactionId | undefined;
  try {
    faction = factionFrom(decodeURIComponent(m[1]));
  } catch {
    faction = factionFrom(m[1]);
  }
  // N-<units>-<commands>-<conditions>-<deployments>-<objectives>-bf<id>
  const sections = m[2].slice(2).split("-");
  const parts = (sections[0] ?? "").slice(1).split("_");
  const units: RawUnit[] = [];
  const unmatched: string[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const id = parts[i].toLowerCase();
    if (id.startsWith("l")) continue; // loadout cards: not modelled here
    const ourUnit = LOOKUP.unit_ids[id];
    const upgrades = parts[i + 1]
      .split(",")
      .filter((s) => s && s !== "EM")
      .map((s) => {
        const up = LOOKUP.upgrade_ids[s.toLowerCase()];
        if (!up) unmatched.push(`upgrade #${s}`);
        return up ? `#id:${up}` : "";
      })
      .filter(Boolean);
    if (!ourUnit) {
      unmatched.push(`unit #${id}`);
      continue;
    }
    units.push({ name: `#id:${ourUnit}`, upgrades });
  }
  const bf = sections[5]?.startsWith("bf") ? TTA_BATTLE_FORCES[sections[5].slice(2)] : undefined;
  return { name: "", faction, battleForce: bf, units, unmatched };
}

// One unit line: "• 2x Name (Title) 105 + 10 = 115 x 2 = 230" or the
// compact "• Name (Title) (Upgrade, Upgrade)".
const QTY_RE = /^(\d+)\s*x\s+/i;

function parseText(text: string): RawList | null {
  const units: RawUnit[] = [];
  const unmatched: string[] = [];
  let points: number | undefined;
  let faction: FactionId | undefined;
  // "2x Unit" lists its upgrades once, for every copy.
  let group: RawUnit[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim().replace(/^[•*·-]\s+/, "");
    if (!line || LINK_RE.test(line)) continue;
    const pts = /^(\d+)\s*\/\s*\d+/.exec(line);
    if (pts && points === undefined) {
      points = Number(pts[1]);
      continue;
    }
    if (/^\d+\s+activations?$/i.test(line)) continue;
    if (line.startsWith("--")) {
      line = line.replace(/^--\s*/, "");
      if (/^loadout:/i.test(line)) continue;
      for (const u of group) u.upgrades.push(...splitUpgrades(line));
      continue;
    }
    faction ??= /^(faction|army)\s*:/i.test(line) ? factionFrom(line) : undefined;
    let qty = 1;
    const q = QTY_RE.exec(line);
    if (q) {
      qty = Number(q[1]);
      line = line.slice(q[0].length);
    }
    // Strip trailing points: " 105", " 105 + 10 = 115", " ... x 2 = 230".
    const pointed = /\s+\d+(\s*[+x=]\s*\d+)*\s*$/;
    const hadPoints = pointed.test(line);
    line = line.replace(pointed, "");
    const head = matchUnitPrefix(line);
    if (!head) {
      // A line with points is a unit we don't know; anything else is
      // command cards, the battle deck and so on.
      if (hadPoints) unmatched.push(line);
      group = [];
      continue;
    }
    const rest = line.slice(head.length).trim();
    // Compact form: upgrades in a trailing "(...)" after the title.
    let upgrades: string[] = [];
    const paren = /^\((.*)\)$/.exec(rest);
    if (paren) upgrades = splitUpgrades(paren[1].replace(/\(loadout:.*$/i, ""));
    group = Array.from({ length: qty }, () => ({ name: head, upgrades: [...upgrades] }));
    units.push(...group);
  }
  if (units.length === 0) return null;
  return { name: "", faction, points, units, unmatched };
}

function splitUpgrades(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.replace(/\(\d+\)\s*$/, "").trim())
    .filter(Boolean);
}

/** The longest leading part of `line` that names a unit we know. */
function matchUnitPrefix(line: string): string | null {
  const words = line.split(/\s+/);
  for (let n = words.length; n > 0; n--) {
    const cand = words.slice(0, n).join(" ");
    if (LOOKUP.unit_names[norm(cand)]) return cand;
  }
  return null;
}

// ---- resolving --------------------------------------------------------

function unitFits(u: Unit, faction?: FactionId): boolean {
  return !faction || u.faction === faction || (u.also_factions ?? []).includes(faction);
}

function resolveUnit(name: string, faction?: FactionId): Unit | undefined {
  if (name.startsWith("#id:")) return unitById(name.slice(4));
  const ids = LOOKUP.unit_names[norm(name)] ?? [];
  const units = ids.map(unitById).filter((u): u is Unit => Boolean(u));
  return units.find((u) => unitFits(u, faction)) ?? units[0];
}

function resolveUpgrade(name: string, unit: Unit): string | undefined {
  if (name.startsWith("#id:")) return name.slice(4);
  const ids = LOOKUP.upgrade_names[norm(name)] ?? [];
  // Same name in two slots (e.g. Fives the trooper and the squad leader):
  // take the one this unit has a slot for.
  const fits = ids.find((id) => {
    const up = upgradeById(id);
    return up && (unit.upgrades?.[up.type as keyof typeof unit.upgrades] ?? 0) > 0 && upgradeFitsUnit(up, unit);
  });
  return fits ?? ids[0];
}

/** Parse a TTA export (JSON, listbuilder link or text). Null if it isn't one. */
export function parseTtaList(text: string): TtaImport | null {
  const trimmed = text.trim();
  const raw =
    (trimmed.startsWith("{") ? parseJson(trimmed) : null) ??
    parseTextOrLink(trimmed);
  if (!raw) return null;

  const unmatched = [...raw.unmatched];
  const entries: ArmyEntry[] = [];
  const resolved: Unit[] = [];
  for (const ru of raw.units) {
    const unit = resolveUnit(ru.name, raw.faction);
    if (!unit) {
      unmatched.push(ru.name);
      continue;
    }
    resolved.push(unit);
    const upgrades: string[] = [];
    for (const n of ru.upgrades) {
      const id = resolveUpgrade(n, unit);
      if (id) upgrades.push(id);
      else unmatched.push(`${n} (on ${ru.name})`);
    }
    entries.push({ entryId: newId(), unitId: unit.id, ...(upgrades.length ? { upgrades } : {}) });
  }
  if (entries.length === 0 && unmatched.length === 0) return null;

  const faction = raw.faction ?? mostCommonFaction(resolved) ?? "rebels";
  const battleForce = battleForceFor(raw.battleForce, faction);
  if (raw.battleForce && !battleForce) unmatched.push(`battle force ${raw.battleForce}`);
  const army: SavedArmy = {
    id: newId(),
    name: raw.name.trim() || "Tabletop Admiral import",
    faction,
    ...(battleForce ? { battleForce } : {}),
    pointsCap: 800,
    pointsMode: guessMode(entries, raw.points),
    entries,
    updatedAt: Date.now(),
  };
  return { army, unmatched, ...(raw.points !== undefined ? { ttaPoints: raw.points } : {}) };
}

function parseTextOrLink(text: string): RawList | null {
  const fromText = parseText(text);
  if (fromText) {
    // A text export may carry the link too; use it for faction/battle force.
    const link = parseLink(text);
    fromText.faction ??= link?.faction;
    fromText.battleForce ??= link?.battleForce;
    return fromText;
  }
  return parseLink(text);
}

function mostCommonFaction(units: Unit[]): FactionId | undefined {
  const count = new Map<FactionId, number>();
  for (const u of units) count.set(u.faction, (count.get(u.faction) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** TTA lists use classic tournament or Revamp points; pick the mode
 * whose total matches what TTA reported, defaulting to Revamp (TTA's
 * current default). */
function guessMode(entries: ArmyEntry[], points?: number): PointsMode {
  const modes: PointsMode[] = ["revamp", "v2_6", "printed"];
  if (points !== undefined) {
    const exact = modes.find((m) => totalPoints(entries, m) === points);
    if (exact) return exact;
  }
  return "revamp";
}
