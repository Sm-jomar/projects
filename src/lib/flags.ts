import type { FactionId } from "./types";

/** Track unit/upgrade entries the user has flagged as having wrong data
 * (wrong points, wrong faction, wrong card image, missing card, etc.).
 * Stored in localStorage so it survives reloads; can be exported to JSON
 * for the user to paste back when they want corrections applied. */

export type FlagKind = "unit" | "upgrade";

export type Flag = {
  id: string; // unit or upgrade id
  kind: FlagKind;
  name: string; // display name (from catalog at flag time)
  faction?: FactionId;
  reason?: string; // optional free-text note
  flaggedAt: number;
};

const KEY = "legion-builder.flagged.v1";

function readAll(): Flag[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Flag[];
  } catch {
    return [];
  }
}

function writeAll(flags: Flag[]): void {
  localStorage.setItem(KEY, JSON.stringify(flags));
}

export function listFlags(): Flag[] {
  return readAll().sort((a, b) => b.flaggedAt - a.flaggedAt);
}

export function isFlagged(id: string): boolean {
  return readAll().some((f) => f.id === id);
}

export function flagFor(id: string): Flag | undefined {
  return readAll().find((f) => f.id === id);
}

export function addOrUpdateFlag(flag: Omit<Flag, "flaggedAt">): Flag {
  const all = readAll();
  const idx = all.findIndex((f) => f.id === flag.id);
  const stamped: Flag = { ...flag, flaggedAt: Date.now() };
  if (idx >= 0) all[idx] = stamped;
  else all.push(stamped);
  writeAll(all);
  return stamped;
}

export function removeFlag(id: string): void {
  writeAll(readAll().filter((f) => f.id !== id));
}

export function exportFlagsJson(): string {
  return JSON.stringify(
    {
      format: "legion-builder-flags",
      version: 1,
      exportedAt: Date.now(),
      flags: listFlags(),
    },
    null,
    2,
  );
}

export function downloadFlags(filename: string): void {
  const blob = new Blob([exportFlagsJson()], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
