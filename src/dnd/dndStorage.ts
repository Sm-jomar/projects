// localStorage persistence for D&D characters and DM notes, mirroring the
// approach used for Legion saved armies / ToD registers.

import type { DndCharacter } from "./dndTypes";

const CHARS_KEY = "dnd.characters.v1";
const NOTES_KEY = "dnd.dmnotes.v1";

function readChars(): DndCharacter[] {
  try {
    const raw = localStorage.getItem(CHARS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DndCharacter[]) : [];
  } catch {
    return [];
  }
}

function writeChars(list: DndCharacter[]): void {
  localStorage.setItem(CHARS_KEY, JSON.stringify(list));
}

export function listCharacters(): DndCharacter[] {
  return readChars().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadCharacter(id: string): DndCharacter | undefined {
  return readChars().find((c) => c.id === id);
}

export function saveCharacter(c: DndCharacter): DndCharacter {
  const all = readChars();
  const stamped: DndCharacter = { ...c, updatedAt: Date.now() };
  const idx = all.findIndex((x) => x.id === c.id);
  if (idx >= 0) all[idx] = stamped;
  else all.push(stamped);
  writeChars(all);
  return stamped;
}

export function deleteCharacter(id: string): void {
  writeChars(readChars().filter((c) => c.id !== id));
}

// --- DM notes: a set of named note documents ------------------------------

export type DmNote = {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
};

function readNotes(): DmNote[] {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DmNote[]) : [];
  } catch {
    return [];
  }
}

function writeNotes(list: DmNote[]): void {
  localStorage.setItem(NOTES_KEY, JSON.stringify(list));
}

export function listNotes(): DmNote[] {
  return readNotes().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveNote(n: DmNote): DmNote {
  const all = readNotes();
  const stamped: DmNote = { ...n, updatedAt: Date.now() };
  const idx = all.findIndex((x) => x.id === n.id);
  if (idx >= 0) all[idx] = stamped;
  else all.push(stamped);
  writeNotes(all);
  return stamped;
}

export function deleteNote(id: string): void {
  writeNotes(readNotes().filter((n) => n.id !== id));
}
