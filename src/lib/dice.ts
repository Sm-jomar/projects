// Star Wars: Legion dice model.
//
// Attack dice come in three colors (red/black/white). Each face is one of:
//   ☼ crit       — always hits, can't be canceled by surge keywords
//   ☼ hit        — a normal hit
//   ☼ surge      — converts to hit/crit if the attacker has Surge: X,
//                  otherwise a blank
//   _  blank     — nothing
//
// Defense dice come in two colors (red/white). Each face is one of:
//   ▣ block      — cancels one hit
//   ▣ surge      — converts to a block if the defender has Surge: Defense,
//                  otherwise a blank
//   _  blank     — nothing
//
// Face counts (per AMG core rules):
//   red attack    1 crit  / 5 hit  / 1 surge / 1 blank   (out of 8)
//   black attack  1 crit  / 3 hit  / 1 surge / 3 blank
//   white attack  1 crit  / 1 hit  / 1 surge / 5 blank
//   red defense   3 block / 1 surge / 4 blank
//   white defense 1 block / 1 surge / 6 blank

export type AttackColor = "red" | "black" | "white";
export type DefenseColor = "red" | "white";

export type AttackFace = "crit" | "hit" | "surge" | "blank";
export type DefenseFace = "block" | "surge" | "blank";

export type AttackSurge = "crit" | "hit" | null;

const ATTACK_FACES: Record<AttackColor, AttackFace[]> = {
  red:   ["crit", "hit", "hit", "hit", "hit", "hit", "surge", "blank"],
  black: ["crit", "hit", "hit", "hit", "surge", "blank", "blank", "blank"],
  white: ["crit", "hit", "surge", "blank", "blank", "blank", "blank", "blank"],
};

const DEFENSE_FACES: Record<DefenseColor, DefenseFace[]> = {
  red:   ["block", "block", "block", "surge", "blank", "blank", "blank", "blank"],
  white: ["block", "surge", "blank", "blank", "blank", "blank", "blank", "blank"],
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export type AttackPool = { red?: number; black?: number; white?: number };
export type DefensePool = { red?: number; white?: number };

export type AttackDieRoll = { color: AttackColor; face: AttackFace };
export type DefenseDieRoll = { color: DefenseColor; face: DefenseFace };

export function rollAttack(pool: AttackPool): AttackDieRoll[] {
  const out: AttackDieRoll[] = [];
  (["red", "black", "white"] as const).forEach((c) => {
    for (let i = 0; i < (pool[c] ?? 0); i++) {
      out.push({ color: c, face: pick(ATTACK_FACES[c]) });
    }
  });
  return out;
}

export function rollDefense(pool: DefensePool): DefenseDieRoll[] {
  const out: DefenseDieRoll[] = [];
  (["red", "white"] as const).forEach((c) => {
    for (let i = 0; i < (pool[c] ?? 0); i++) {
      out.push({ color: c, face: pick(DEFENSE_FACES[c]) });
    }
  });
  return out;
}

export type AttackTotals = { crits: number; hits: number; surges: number; blanks: number };
export type DefenseTotals = { blocks: number; surges: number; blanks: number };

export function tallyAttack(
  results: AttackDieRoll[],
  surge: AttackSurge,
): AttackTotals {
  let crits = 0, hits = 0, surges = 0, blanks = 0;
  for (const r of results) {
    if (r.face === "crit") crits++;
    else if (r.face === "hit") hits++;
    else if (r.face === "surge") {
      // Convert per the attacker's surge keyword.
      if (surge === "crit") crits++;
      else if (surge === "hit") hits++;
      else surges++;
    }
    else blanks++;
  }
  return { crits, hits, surges, blanks };
}

export function tallyDefense(
  results: DefenseDieRoll[],
  hasDefenseSurge: boolean,
): DefenseTotals {
  let blocks = 0, surges = 0, blanks = 0;
  for (const r of results) {
    if (r.face === "block") blocks++;
    else if (r.face === "surge") {
      if (hasDefenseSurge) blocks++;
      else surges++;
    }
    else blanks++;
  }
  return { blocks, surges, blanks };
}

export const FACE_GLYPH: Record<AttackFace | DefenseFace, string> = {
  crit: "✸",
  hit: "✷",
  surge: "⌖",
  blank: "·",
  block: "⛨",
};
