// Dungeons & Dragons 5e domain model. Kept intentionally close to the
// paper character sheet so it reads naturally to players.

export type AbilityKey = "str" | "dex" | "con" | "int" | "wis" | "cha";

export const ABILITIES: { key: AbilityKey; label: string; short: string }[] = [
  { key: "str", label: "Strength", short: "STR" },
  { key: "dex", label: "Dexterity", short: "DEX" },
  { key: "con", label: "Constitution", short: "CON" },
  { key: "int", label: "Intelligence", short: "INT" },
  { key: "wis", label: "Wisdom", short: "WIS" },
  { key: "cha", label: "Charisma", short: "CHA" },
];

export type SkillKey =
  | "acrobatics" | "animalHandling" | "arcana" | "athletics" | "deception"
  | "history" | "insight" | "intimidation" | "investigation" | "medicine"
  | "nature" | "perception" | "performance" | "persuasion" | "religion"
  | "sleightOfHand" | "stealth" | "survival";

export const SKILLS: { key: SkillKey; label: string; ability: AbilityKey }[] = [
  { key: "acrobatics", label: "Acrobatics", ability: "dex" },
  { key: "animalHandling", label: "Animal Handling", ability: "wis" },
  { key: "arcana", label: "Arcana", ability: "int" },
  { key: "athletics", label: "Athletics", ability: "str" },
  { key: "deception", label: "Deception", ability: "cha" },
  { key: "history", label: "History", ability: "int" },
  { key: "insight", label: "Insight", ability: "wis" },
  { key: "intimidation", label: "Intimidation", ability: "cha" },
  { key: "investigation", label: "Investigation", ability: "int" },
  { key: "medicine", label: "Medicine", ability: "wis" },
  { key: "nature", label: "Nature", ability: "int" },
  { key: "perception", label: "Perception", ability: "wis" },
  { key: "performance", label: "Performance", ability: "cha" },
  { key: "persuasion", label: "Persuasion", ability: "cha" },
  { key: "religion", label: "Religion", ability: "int" },
  { key: "sleightOfHand", label: "Sleight of Hand", ability: "dex" },
  { key: "stealth", label: "Stealth", ability: "dex" },
  { key: "survival", label: "Survival", ability: "wis" },
];

export type Attack = { name: string; bonus: string; damage: string };

// A single spellbook entry. level 0 = cantrip, 1..9 = spell level.
export type Spell = {
  id: string;
  name: string;
  level: number;
  prepared: boolean;
  school: string;
  castingTime: string;
  range: string;
  components: string;
  duration: string;
  notes: string;
};

// Spell slots for levels 1..9 (index 0 = 1st level). Cantrips have none.
export type SpellSlot = { total: number; used: number };

export const SPELL_LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export function spellLevelLabel(level: number): string {
  if (level === 0) return "Cantrip";
  const ord = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"][level];
  return `${ord} Level`;
}

export function newSpell(level = 0): Spell {
  return {
    id: newId("spell"), name: "", level, prepared: false,
    school: "", castingTime: "", range: "", components: "", duration: "", notes: "",
  };
}

export function emptySpellSlots(): SpellSlot[] {
  return Array.from({ length: 9 }, () => ({ total: 0, used: 0 }));
}

export type DndCharacter = {
  id: string;
  updatedAt: number;

  // Header
  name: string;
  className: string; // "Class & Level" e.g. "Wizard 3"
  level: number;
  background: string;
  race: string;
  alignment: string;
  playerName: string;
  xp: string;

  // Abilities (raw scores 1..30)
  abilities: Record<AbilityKey, number>;

  proficiencyBonus: number;
  inspiration: boolean;

  // Proficiencies: which saving throws / skills are proficient.
  saveProf: Record<AbilityKey, boolean>;
  skillProf: Record<SkillKey, boolean>;

  // Combat
  armorClass: number;
  speed: string;
  hpMax: number;
  hpCurrent: number;
  hpTemp: number;
  hitDice: string; // e.g. "3d8"
  deathSuccesses: number; // 0..3
  deathFailures: number; // 0..3
  attacks: Attack[];

  // Text blocks
  otherProficiencies: string; // languages, tools, armor, weapons
  equipment: string;
  featuresTraits: string;
  personality: string;
  ideals: string;
  bonds: string;
  flaws: string;

  // Money
  cp: string; sp: string; ep: string; gp: string; pp: string;

  // Spellcasting (kept lightweight for v1)
  spellcastingClass: string;
  spellAbility: AbilityKey | "";
  spellSaveDc: string;
  spellAttackBonus: string;
  spells: string; // free-form notes (kept for older sheets)
  // Structured spellbook. Optional so sheets saved before this existed
  // still load; the editor fills defaults on open.
  spellbook?: Spell[];
  spellSlots?: SpellSlot[];
};

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function formatModifier(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

let idCounter = 0;
export function newId(prefix = "char"): string {
  // Time-free unique-ish id (Date.now/Math.random are fine in the browser,
  // but keep a counter so rapid calls in one tick don't collide).
  idCounter = (idCounter + 1) % 1000;
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${idCounter}`;
}

export function blankCharacter(): DndCharacter {
  return {
    id: newId(),
    updatedAt: Date.now(),
    name: "",
    className: "",
    level: 1,
    background: "",
    race: "",
    alignment: "",
    playerName: "",
    xp: "",
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    inspiration: false,
    saveProf: { str: false, dex: false, con: false, int: false, wis: false, cha: false },
    skillProf: SKILLS.reduce((acc, s) => { acc[s.key] = false; return acc; }, {} as Record<SkillKey, boolean>),
    armorClass: 10,
    speed: "30 ft.",
    hpMax: 0,
    hpCurrent: 0,
    hpTemp: 0,
    hitDice: "",
    deathSuccesses: 0,
    deathFailures: 0,
    attacks: [],
    otherProficiencies: "",
    equipment: "",
    featuresTraits: "",
    personality: "",
    ideals: "",
    bonds: "",
    flaws: "",
    cp: "", sp: "", ep: "", gp: "", pp: "",
    spellcastingClass: "",
    spellAbility: "",
    spellSaveDc: "",
    spellAttackBonus: "",
    spells: "",
    spellbook: [],
    spellSlots: emptySpellSlots(),
  };
}
