// Import character sheets from files: our own JSON export, a D&D Beyond
// character JSON, or a filled-in 5e character sheet PDF (the official
// form-fillable one). Every import becomes a fresh saved character.

import { ABILITIES, abilityModifier, blankCharacter, newId, type AbilityKey, type Attack, type DndCharacter } from "./dndTypes";

export type SheetImport = { characters: DndCharacter[]; errors: string[] };

export async function importCharacterFiles(files: Iterable<File>): Promise<SheetImport> {
  const out: SheetImport = { characters: [], errors: [] };
  for (const f of files) {
    try {
      const isPdf = /\.pdf$/i.test(f.name) || f.type === "application/pdf";
      const chars = isPdf
        ? [await (await import("./characterPdf")).characterFromPdf(await f.arrayBuffer())]
        : charactersFromJson(JSON.parse(await f.text()));
      if (!chars.length) throw new Error("no character found");
      out.characters.push(...chars);
    } catch (err) {
      out.errors.push(`${f.name}: ${err instanceof Error ? err.message : "could not read it"}`);
    }
  }
  return out;
}

/** Summary line for an import: what came in and what didn't. */
export function importSummary(chars: DndCharacter[], errors: string[]): string {
  const ok = chars.length
    ? `Imported ${chars.map((c) => c.name || "Unnamed").join(", ")}.`
    : "No characters imported.";
  return errors.length ? `${ok} ${errors.join(" ")}` : ok;
}

/** One character, or a list of them, as JSON text for download. */
export function exportCharactersJson(chars: DndCharacter[]): string {
  return JSON.stringify(chars.length === 1 ? chars[0] : chars, null, 2);
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const num = (v: unknown, d = 0) => {
  const n = typeof v === "number" ? v : parseInt(str(v), 10);
  return Number.isFinite(n) ? n : d;
};

export function charactersFromJson(raw: unknown): DndCharacter[] {
  if (Array.isArray(raw)) return raw.flatMap(charactersFromJson);
  if (!isObj(raw)) return [];
  // D&D Beyond wraps the character in { success, data: {...} }.
  const ddb = isObj(raw.data) && Array.isArray(raw.data.stats) ? raw.data : Array.isArray(raw.stats) ? raw : null;
  if (ddb) return [fromDdb(ddb)];
  if (isObj(raw.abilities) && "name" in raw) return [fromOurs(raw)];
  return [];
}

/** Our own export: fill any fields an older sheet lacks, new id. */
function fromOurs(raw: Json): DndCharacter {
  const base = blankCharacter();
  return {
    ...base,
    ...(raw as Partial<DndCharacter>),
    abilities: { ...base.abilities, ...(raw.abilities as DndCharacter["abilities"]) },
    saveProf: { ...base.saveProf, ...(isObj(raw.saveProf) ? raw.saveProf : {}) },
    skillProf: { ...base.skillProf, ...(isObj(raw.skillProf) ? raw.skillProf : {}) },
    id: newId(),
    updatedAt: Date.now(),
  };
}

const DDB_ABILITY: AbilityKey[] = ["str", "dex", "con", "int", "wis", "cha"];
const DDB_ALIGNMENT: Record<number, string> = {
  1: "Lawful Good", 2: "Neutral Good", 3: "Chaotic Good", 4: "Lawful Neutral", 5: "Neutral",
  6: "Chaotic Neutral", 7: "Lawful Evil", 8: "Neutral Evil", 9: "Chaotic Evil",
};

/** A D&D Beyond character (character-service JSON). Ability scores take
 * base + bonus, or the override when set; racial and feat bonuses that
 * live in modifiers are added where D&D Beyond lists them as "bonus" to
 * a "*-score". */
function fromDdb(d: Json): DndCharacter {
  const c = blankCharacter();
  c.name = str(d.name);
  const stats = (k: string) => (Array.isArray(d[k]) ? (d[k] as Json[]) : []);
  const statOf = (list: Json[], i: number) => num(list.find((s) => num(s.id) === i + 1)?.value, 0);
  const mods = isObj(d.modifiers) ? Object.values(d.modifiers).flatMap((v) => (Array.isArray(v) ? (v as Json[]) : [])) : [];
  DDB_ABILITY.forEach((k, i) => {
    const override = statOf(stats("overrideStats"), i);
    const label = ABILITIES[i]!.label.toLowerCase();
    const bonus = mods
      .filter((m) => m.type === "bonus" && m.subType === `${label}-score`)
      .reduce((a, m) => a + num(m.value), 0);
    c.abilities[k] = override || statOf(stats("stats"), i) + statOf(stats("bonusStats"), i) + bonus || 10;
  });
  const classes = Array.isArray(d.classes) ? (d.classes as Json[]) : [];
  c.level = Math.max(1, classes.reduce((a, k) => a + num(k.level), 0));
  c.className = classes
    .map((k) => `${str(isObj(k.definition) ? k.definition.name : "")} ${num(k.level)}`.trim())
    .filter(Boolean).join(" / ");
  c.race = str(isObj(d.race) ? d.race.fullName ?? d.race.baseName : "");
  c.background = str(isObj(d.background) && isObj(d.background.definition) ? d.background.definition.name : "");
  c.alignment = DDB_ALIGNMENT[num(d.alignmentId)] ?? "";
  c.xp = str(d.currentXp);
  c.proficiencyBonus = 2 + Math.floor((c.level - 1) / 4);
  const conMod = abilityModifier(c.abilities.con);
  c.hpMax = num(d.overrideHitPoints) || num(d.baseHitPoints) + num(d.bonusHitPoints) + conMod * c.level;
  c.hpCurrent = Math.max(0, c.hpMax - num(d.removedHitPoints));
  c.hpTemp = num(d.temporaryHitPoints);
  c.armorClass = 10 + abilityModifier(c.abilities.dex);
  const walk = isObj(d.race) && isObj(d.race.weightSpeeds) && isObj(d.race.weightSpeeds.normal)
    ? num(d.race.weightSpeeds.normal.walk, 30) : 30;
  c.speed = `${walk} ft.`;
  const cur = isObj(d.currencies) ? d.currencies : {};
  c.cp = str(cur.cp); c.sp = str(cur.sp); c.ep = str(cur.ep); c.gp = str(cur.gp); c.pp = str(cur.pp);
  const traits = isObj(d.traits) ? d.traits : {};
  c.personality = str(traits.personalityTraits);
  c.ideals = str(traits.ideals);
  c.bonds = str(traits.bonds);
  c.flaws = str(traits.flaws);
  // Saving throw and skill proficiencies come through as modifiers.
  for (const m of mods) {
    if (m.type !== "proficiency") continue;
    const sub = str(m.subType);
    const save = sub.match(/^(\w+)-saving-throws$/);
    if (save) {
      const k = ABILITIES.find((a) => a.label.toLowerCase() === save[1])?.key;
      if (k) c.saveProf[k] = true;
      continue;
    }
    const skill = Object.keys(c.skillProf).find((s) => s.replace(/[A-Z]/g, (x) => "-" + x.toLowerCase()) === sub);
    if (skill) c.skillProf[skill as keyof DndCharacter["skillProf"]] = true;
  }
  const items = Array.isArray(d.inventory) ? (d.inventory as Json[]) : [];
  c.equipment = items
    .map((it) => {
      const def = isObj(it.definition) ? it.definition : {};
      const q = num(it.quantity, 1);
      return `${str(def.name)}${q > 1 ? ` ×${q}` : ""}`;
    })
    .filter((x) => x.trim()).join("\n");
  const attacks: Attack[] = items
    .filter((it) => isObj(it.definition) && it.definition.filterType === "Weapon")
    .slice(0, 6)
    .map((it) => {
      const def = it.definition as Json;
      const dice = isObj(def.damage) ? str(def.damage.diceString) : "";
      return { name: str(def.name), bonus: "", damage: [dice, str(def.damageType)].filter(Boolean).join(" ") };
    });
  c.attacks = attacks;
  return c;
}

// Field names on the official 5e form-fillable sheet (WotC, also used by
// most "5e character sheet" PDFs). Matched ignoring spaces and case, since
// the original has stray trailing spaces ("Race ", "PersonalityTraits ").
export function characterFromPdfFields(fields: Record<string, string | boolean>): DndCharacter {
  const norm: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(fields)) norm[k.replace(/\s+/g, "").toLowerCase()] = v;
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = norm[k.replace(/\s+/g, "").toLowerCase()];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  const c = blankCharacter();
  c.name = get("CharacterName", "CharacterName 2");
  c.className = get("ClassLevel");
  c.level = Math.max(1, num(c.className.match(/(\d+)/)?.[1], 1));
  c.background = get("Background");
  c.playerName = get("PlayerName");
  c.race = get("Race");
  c.alignment = get("Alignment");
  c.xp = get("XP");
  for (const a of ABILITIES) c.abilities[a.key] = num(get(a.short), 10);
  c.proficiencyBonus = num(get("ProfBonus").replace("+", ""), c.proficiencyBonus);
  c.armorClass = num(get("AC"), 10);
  const speed = get("Speed");
  c.speed = /^\d+$/.test(speed) ? `${speed} ft.` : speed || c.speed;
  c.hpMax = num(get("HPMax"));
  c.hpCurrent = num(get("HPCurrent"), c.hpMax);
  c.hpTemp = num(get("HPTemp"));
  c.hitDice = get("HDTotal", "HD");
  c.personality = get("PersonalityTraits");
  c.ideals = get("Ideals");
  c.bonds = get("Bonds");
  c.flaws = get("Flaws");
  c.featuresTraits = get("Features and Traits", "Feat+Traits");
  c.otherProficiencies = get("ProficienciesLang");
  c.equipment = get("Equipment");
  c.cp = get("CP"); c.sp = get("SP"); c.ep = get("EP"); c.gp = get("GP"); c.pp = get("PP");
  c.spellcastingClass = get("Spellcasting Class 2");
  const ab = get("SpellcastingAbility 2").slice(0, 3).toLowerCase();
  c.spellAbility = (ABILITIES.find((a) => a.key === ab)?.key ?? "") as DndCharacter["spellAbility"];
  c.spellSaveDc = get("SpellSaveDC 2");
  c.spellAttackBonus = get("SpellAtkBonus 2");
  const weapons: [string, string, string][] = [
    ["Wpn Name", "Wpn1 AtkBonus", "Wpn1 Damage"],
    ["Wpn Name 2", "Wpn2 AtkBonus", "Wpn2 Damage"],
    ["Wpn Name 3", "Wpn3 AtkBonus", "Wpn3 Damage"],
  ];
  c.attacks = weapons
    .map(([n, b, d]) => ({ name: get(n), bonus: get(b), damage: get(d) }))
    .filter((a) => a.name);
  if (!c.name && !c.className && !c.race) throw new Error("no character sheet form fields in this PDF");
  return c;
}
