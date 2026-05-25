import type { Dossier, TodRegister } from "./types";
import { newId } from "./storage";

export function blankRegister(): TodRegister {
  return {
    id: newId(),
    name: "",
    reputation: "",
    storyArc: "",
    combatPotential: "",
    combatPotentialSpent: "",
    supplyPoints: "",
    strategicAssets: "",
    agendas: [
      { name: "", progression: 0 },
      { name: "", progression: 0 },
      { name: "", progression: 0 },
    ],
    dossiers: [],
    updatedAt: Date.now(),
  };
}

export function blankDossier(): Dossier {
  return {
    id: newId(),
    dossierName: "",
    unitName: "",
    setbacks: "",
    veteranRank: 0,
    experience: "",
    upgrades: "",
    commendations: "",
    pointsSpent: "",
  };
}

const FILE_VERSION = 1;

type RegisterFile = {
  format: "legion-tod-register";
  version: number;
  exportedAt: number;
  registers: TodRegister[];
};

export function registersToJson(registers: TodRegister[]): string {
  const file: RegisterFile = {
    format: "legion-tod-register",
    version: FILE_VERSION,
    exportedAt: Date.now(),
    registers,
  };
  return JSON.stringify(file, null, 2);
}

export type RegisterImportResult = {
  registers: TodRegister[];
  errors: string[];
};

export function jsonToRegisters(text: string): RegisterImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { registers: [], errors: [`Invalid JSON: ${(err as Error).message}`] };
  }
  // Accept the wrapped file format or a bare array of registers.
  const raw =
    parsed && typeof parsed === "object" && parsed !== null && "registers" in parsed
      ? (parsed as RegisterFile).registers
      : Array.isArray(parsed)
        ? (parsed as TodRegister[])
        : null;
  if (!Array.isArray(raw)) {
    return {
      registers: [],
      errors: ["Expected an array of registers (or a register file)."],
    };
  }
  const errors: string[] = [];
  const out: TodRegister[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] as Partial<TodRegister>;
    if (!r || typeof r !== "object") {
      errors.push(`Item ${i}: not an object.`);
      continue;
    }
    const reg: TodRegister = {
      id: typeof r.id === "string" && r.id ? r.id : newId(),
      name: typeof r.name === "string" ? r.name : "",
      reputation: typeof r.reputation === "string" ? r.reputation : "",
      storyArc: typeof r.storyArc === "string" ? r.storyArc : "",
      combatPotential: typeof r.combatPotential === "string" ? r.combatPotential : "",
      combatPotentialSpent:
        typeof r.combatPotentialSpent === "string" ? r.combatPotentialSpent : "",
      supplyPoints: typeof r.supplyPoints === "string" ? r.supplyPoints : "",
      strategicAssets: typeof r.strategicAssets === "string" ? r.strategicAssets : "",
      agendas: Array.isArray(r.agendas)
        ? r.agendas.slice(0, 3).map((a) => ({
            name: typeof a?.name === "string" ? a.name : "",
            progression: Math.max(0, Math.min(5, Number(a?.progression) || 0)),
          }))
        : [
            { name: "", progression: 0 },
            { name: "", progression: 0 },
            { name: "", progression: 0 },
          ],
      dossiers: Array.isArray(r.dossiers)
        ? r.dossiers.map((d) => ({
            id: typeof d?.id === "string" && d.id ? d.id : newId(),
            dossierName: typeof d?.dossierName === "string" ? d.dossierName : "",
            unitName: typeof d?.unitName === "string" ? d.unitName : "",
            setbacks: typeof d?.setbacks === "string" ? d.setbacks : "",
            veteranRank: Math.max(0, Math.min(5, Number(d?.veteranRank) || 0)),
            experience: typeof d?.experience === "string" ? d.experience : "",
            upgrades: typeof d?.upgrades === "string" ? d.upgrades : "",
            commendations: typeof d?.commendations === "string" ? d.commendations : "",
            pointsSpent: typeof d?.pointsSpent === "string" ? d.pointsSpent : "",
          }))
        : [],
      updatedAt:
        typeof r.updatedAt === "number" && r.updatedAt > 0
          ? r.updatedAt
          : Date.now(),
    };
    // Pad agendas to 3.
    while (reg.agendas.length < 3) reg.agendas.push({ name: "", progression: 0 });
    out.push(reg);
  }
  return { registers: out, errors };
}

export function downloadJson(filename: string, content: string): void {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
