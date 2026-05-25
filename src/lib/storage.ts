import type { SavedArmy } from "./types";

const KEY = "legion-builder.armies.v1";

function readAll(): SavedArmy[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as SavedArmy[];
  } catch {
    return [];
  }
}

function writeAll(armies: SavedArmy[]): void {
  localStorage.setItem(KEY, JSON.stringify(armies));
}

export function listArmies(): SavedArmy[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveArmy(army: SavedArmy): SavedArmy {
  const armies = readAll();
  const idx = armies.findIndex((a) => a.id === army.id);
  const stamped: SavedArmy = { ...army, updatedAt: Date.now() };
  if (idx >= 0) armies[idx] = stamped;
  else armies.push(stamped);
  writeAll(armies);
  return stamped;
}

export function deleteArmy(id: string): void {
  writeAll(readAll().filter((a) => a.id !== id));
}

export function loadArmy(id: string): SavedArmy | undefined {
  return readAll().find((a) => a.id === id);
}

export function newId(): string {
  // Good-enough random id; not security-sensitive.
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}
