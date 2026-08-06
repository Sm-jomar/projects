import { useEffect, useState } from "react";
import { readRulebooks, writeRulebooks, type RuleBook } from "./dndStorage";
import { newId } from "./dndTypes";

// Game editions the rulebook shelf can be organized by.
const EDITIONS: { key: string; label: string }[] = [
  { key: "5e-2024", label: "D&D 2024 (5.5e)" },
  { key: "5e-2014", label: "D&D 5e (2014)" },
  { key: "4e", label: "D&D 4th Edition" },
  { key: "3.5e", label: "D&D 3.5e" },
  { key: "3e", label: "D&D 3rd Edition" },
  { key: "adnd-2e", label: "AD&D 2nd Edition" },
  { key: "adnd-1e", label: "AD&D 1st Edition" },
  { key: "basic-osr", label: "Basic D&D / OSR" },
  { key: "pf2e", label: "Pathfinder 2e" },
  { key: "pf1e", label: "Pathfinder 1e" },
  { key: "other", label: "Other / Homebrew" },
];

const CATEGORIES = ["Core", "Supplement", "Adventure", "Setting", "Homebrew", "Other"];

// Suggested core books per edition for one-tap adding.
const CORE_BOOKS: Record<string, string[]> = {
  "5e-2024": ["Player's Handbook (2024)", "Dungeon Master's Guide (2024)", "Monster Manual (2024)"],
  "5e-2014": ["Player's Handbook", "Dungeon Master's Guide", "Monster Manual"],
  "4e": ["Player's Handbook", "Dungeon Master's Guide", "Monster Manual"],
  "3.5e": ["Player's Handbook", "Dungeon Master's Guide", "Monster Manual"],
  "3e": ["Player's Handbook", "Dungeon Master's Guide", "Monster Manual"],
  "adnd-2e": ["Player's Handbook", "Dungeon Master's Guide", "Monstrous Manual"],
  "adnd-1e": ["Players Handbook", "Dungeon Masters Guide", "Monster Manual"],
  "basic-osr": ["Basic Rules", "Expert Rules"],
  "pf2e": ["Player Core", "GM Core", "Monster Core"],
  "pf1e": ["Core Rulebook", "Bestiary", "GameMastery Guide"],
  "other": [],
};

function editionLabel(key: string): string {
  return EDITIONS.find((e) => e.key === key)?.label ?? key;
}

export function Rulebooks() {
  const [store, setStore] = useState(() => readRulebooks());
  const { edition, books } = store;

  // Persist on change.
  useEffect(() => { writeRulebooks(store); }, [store]);

  function setEdition(e: string) { setStore((s) => ({ ...s, edition: e })); }
  function addBook(partial: Partial<RuleBook>) {
    const book: RuleBook = {
      id: newId("book"), edition, title: "", category: "Supplement", url: "", notes: "", ...partial,
    };
    setStore((s) => ({ ...s, books: [...s.books, book] }));
  }
  function updateBook(id: string, patch: Partial<RuleBook>) {
    setStore((s) => ({ ...s, books: s.books.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
  }
  function removeBook(id: string) {
    setStore((s) => ({ ...s, books: s.books.filter((b) => b.id !== id) }));
  }

  const shown = books.filter((b) => b.edition === edition);
  const existingTitles = new Set(shown.map((b) => b.title.trim().toLowerCase()));
  const coreSuggestions = (CORE_BOOKS[edition] ?? []).filter((t) => !existingTitles.has(t.toLowerCase()));

  return (
    <div className="dnd-section dnd-rulebooks">
      <div className="dnd-section-head">
        <h2>Rulebooks</h2>
        <label className="dnd-edition-picker">
          Edition
          <select value={edition} onChange={(e) => setEdition(e.target.value)}>
            {EDITIONS.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
          </select>
        </label>
      </div>

      <p className="muted small">
        Your reference shelf for <b>{editionLabel(edition)}</b>. Add the books you own or use — with a link to your
        PDF or online copy — and switch editions above to keep separate shelves.
      </p>

      {coreSuggestions.length > 0 && (
        <div className="dnd-rb-suggest">
          <span className="muted small">Quick add:</span>
          {coreSuggestions.map((t) => (
            <button key={t} className="ghost-btn small" onClick={() => addBook({ title: t, category: "Core" })}>+ {t}</button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="muted">No books on this shelf yet. Use a quick-add above or <b>+ Add book</b>.</p>
      ) : (
        <ul className="dnd-rb-list">
          {shown.map((b) => (
            <li key={b.id} className="dnd-rb-item">
              <div className="dnd-rb-row1">
                <input className="dnd-rb-title" value={b.title} placeholder="Book title"
                       onChange={(e) => updateBook(b.id, { title: e.target.value })} />
                <select value={b.category} onChange={(e) => updateBook(b.id, { category: e.target.value })}>
                  {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </select>
                {b.url.trim() && (
                  <a className="dnd-rb-open" href={b.url} target="_blank" rel="noopener noreferrer">Open ↗</a>
                )}
                <button className="danger" onClick={() => removeBook(b.id)} aria-label="Remove book">×</button>
              </div>
              <input className="dnd-rb-url" value={b.url} placeholder="Link (PDF / online copy) — optional"
                     onChange={(e) => updateBook(b.id, { url: e.target.value })} />
              <input className="dnd-rb-notes" value={b.notes} placeholder="Notes — optional"
                     onChange={(e) => updateBook(b.id, { notes: e.target.value })} />
            </li>
          ))}
        </ul>
      )}

      <button className="dnd-primary dnd-rb-add" onClick={() => addBook({})}>+ Add book</button>
    </div>
  );
}
