import type { SavedArmy, FactionId } from "./types";
import { newId } from "./storage";

// CSV format (one row per army entry):
//   listId,listName,faction,battleForce,pointsCap,updatedAt,entryId,unitId,upgrades
// First row is a header. Lists with zero entries are still represented
// with a single row whose entryId/unitId/upgrades columns are empty.
// `upgrades` is a "|"-separated list of upgrade IDs attached to the entry.

const HEADER = [
  "listId",
  "listName",
  "faction",
  "battleForce",
  "pointsCap",
  "updatedAt",
  "entryId",
  "unitId",
  "upgrades",
] as const;

function escape(v: string | number): string {
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function armiesToCsv(armies: SavedArmy[]): string {
  const lines: string[] = [HEADER.join(",")];
  for (const a of armies) {
    const bf = a.battleForce ?? "";
    if (a.entries.length === 0) {
      lines.push(
        [a.id, a.name, a.faction, bf, a.pointsCap, a.updatedAt, "", "", ""]
          .map(escape)
          .join(","),
      );
    } else {
      for (const e of a.entries) {
        const upgrades = (e.upgrades ?? []).join("|");
        lines.push(
          [
            a.id,
            a.name,
            a.faction,
            bf,
            a.pointsCap,
            a.updatedAt,
            e.entryId,
            e.unitId,
            upgrades,
          ]
            .map(escape)
            .join(","),
        );
      }
    }
  }
  return lines.join("\n") + "\n";
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        row.push(cur);
        cur = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cur);
        cur = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else {
        cur += ch;
      }
    }
  }
  if (cur !== "" || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

const FACTIONS: ReadonlySet<FactionId> = new Set([
  "rebels",
  "imperials",
  "republic",
  "separatists",
  "mercenary",
]);

export type ImportResult = {
  armies: SavedArmy[];
  errors: string[];
};

export function csvToArmies(text: string): ImportResult {
  const rows = parseCsv(text);
  const errors: string[] = [];
  if (rows.length === 0) return { armies: [], errors: ["File is empty."] };
  const header = rows[0].map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  for (const required of ["listId", "listName", "faction", "pointsCap"]) {
    if (idx(required) === -1) {
      return {
        armies: [],
        errors: [`Missing required column: ${required}`],
      };
    }
  }
  const byList = new Map<string, SavedArmy>();
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    const listId = cols[idx("listId")] || `imported-${r}`;
    const listName = cols[idx("listName")] || "Imported";
    const factionRaw = (cols[idx("faction")] || "").trim() as FactionId;
    if (!FACTIONS.has(factionRaw)) {
      errors.push(`Row ${r + 1}: unknown faction "${factionRaw}".`);
      continue;
    }
    const pointsCap = Number(cols[idx("pointsCap")]) || 800;
    const updatedAtRaw = Number(cols[idx("updatedAt")]);
    const updatedAt = Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? updatedAtRaw : Date.now();
    const entryId = (cols[idx("entryId")] || "").trim();
    const unitId = (cols[idx("unitId")] || "").trim();
    const upgradesRaw = idx("upgrades") >= 0 ? cols[idx("upgrades")] || "" : "";
    const upgrades = upgradesRaw
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    const battleForce =
      idx("battleForce") >= 0
        ? (cols[idx("battleForce")] || "").trim() || undefined
        : undefined;
    let army = byList.get(listId);
    if (!army) {
      army = {
        id: listId,
        name: listName,
        faction: factionRaw,
        ...(battleForce ? { battleForce } : {}),
        pointsCap,
        entries: [],
        updatedAt,
      };
      byList.set(listId, army);
    }
    if (unitId) {
      army.entries.push({
        entryId: entryId || newId(),
        unitId,
        ...(upgrades.length ? { upgrades } : {}),
      });
    }
  }
  return { armies: Array.from(byList.values()), errors };
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
