import type { Weapon } from "./types";

// Legion rules glossary (keywords, phases, terrain, tokens, ...) from Legion
// Helper, imported by scripts/import_legion_helper_rules.py. It is large, so
// it loads on first use rather than with the app.

export type RulesEntry = {
  slug: string;
  name: string;
  /** "Unit Keyword", "Weapon Keyword", "Battle Force", "Rules", ... */
  tag: string;
  text: string;
  related?: string[];
};

export const RULES_SITE = "https://legion.takras.net";

export function rulesUrl(slug: string): string {
  return `${RULES_SITE}/${slug}/`;
}

let glossary: Promise<RulesEntry[]> | null = null;

export function loadGlossary(): Promise<RulesEntry[]> {
  glossary ??= import("../data/rules-glossary.json").then((m) => m.default as RulesEntry[]);
  return glossary;
}

const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** Keyword words without magnitudes: "Weak Point 1: Rear" -> "weak point rear". */
const words = (s: string) =>
  s.toLowerCase().replace(/\b(x|y)\b|\d+/g, " ").replace(/[^a-z']+/g, " ").trim();

type Index = { bySlug: Map<string, RulesEntry>; byWords: Map<string, RulesEntry> };
const indexes = new WeakMap<RulesEntry[], Index>();

function indexOf(entries: RulesEntry[]): Index {
  let ix = indexes.get(entries);
  if (!ix) {
    ix = { bySlug: new Map(entries.map((e) => [e.slug, e])), byWords: new Map() };
    for (const e of entries) {
      ix.byWords.set(words(e.name), e);
      ix.byWords.set(words(e.name.split(/[:(]/)[0]!), e);
    }
    indexes.set(entries, ix);
  }
  return ix;
}

/** The glossary entry for a keyword as printed on a card, e.g. "Armor 5" ->
 * Armor X, "Immune: Pierce" -> Immune: Pierce, "Hover: Air 2" -> Hover. */
export function entryForKeyword(entries: RulesEntry[], keyword: string): RulesEntry | undefined {
  const { bySlug, byWords } = indexOf(entries);
  const full = keyword.replace(/\d+/g, "");
  const base = keyword.split(":")[0]!.replace(/\d+/g, "");
  // Legion Helper spells the page "inconspicious"; cards say Prepared Position.
  const b = slugOf(base).replace("inconspicous", "inconspicious");
  for (const s of [slugOf(full), b, b + "_x", b + "s"]) {
    const hit = bySlug.get(s);
    if (hit) return hit;
  }
  return byWords.get(words(full)) ?? byWords.get(words(base));
}

export function weaponKeywords(w: Weapon): string[] {
  if (!w.keywords) return [];
  if (Array.isArray(w.keywords)) return w.keywords;
  return Object.entries(w.keywords).map(([k, v]) => (v === "" ? k : `${k} ${v}`));
}

export function weaponRange(w: Weapon): string {
  if (w.area_of_effect) return `Area ${w.area_of_effect}`;
  if (w.max_range === 0) return "Melee";
  const min = w.min_range === 0 ? "Melee" : String(w.min_range);
  if (w.max_range == null) return `${min}+`;
  return w.min_range === w.max_range ? min : `${min}–${w.max_range}`;
}
