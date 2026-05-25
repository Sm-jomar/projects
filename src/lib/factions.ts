import type { FactionId, Rank } from "./types";

export const FACTIONS: Record<
  FactionId,
  { id: FactionId; name: string; short: string; color: string; accent: string }
> = {
  rebels: {
    id: "rebels",
    name: "Rebel Alliance",
    short: "Rebels",
    color: "#c0392b",
    accent: "#f1c40f",
  },
  imperials: {
    id: "imperials",
    name: "Galactic Empire",
    short: "Empire",
    color: "#1f3a52",
    accent: "#aab7c4",
  },
  republic: {
    id: "republic",
    name: "Galactic Republic",
    short: "Republic",
    color: "#8e3a1f",
    accent: "#e8c39e",
  },
  separatists: {
    id: "separatists",
    name: "Separatist Alliance",
    short: "Separatists",
    color: "#3a2e4d",
    accent: "#b6a2d6",
  },
  mercenary: {
    id: "mercenary",
    name: "Mercenaries",
    short: "Mercenaries",
    color: "#3d2a14",
    accent: "#d7a45e",
  },
};

export const FACTION_ORDER: FactionId[] = [
  "rebels",
  "imperials",
  "republic",
  "separatists",
  "mercenary",
];

export const RANK_ORDER: Rank[] = [
  "commander",
  "operative",
  "corps",
  "special-forces",
  "support",
  "heavy",
];

export const RANK_LABEL: Record<Rank, string> = {
  commander: "Commander",
  operative: "Operative",
  corps: "Corps",
  "special-forces": "Special Forces",
  support: "Support",
  heavy: "Heavy",
};

// Battle Forces (per the official DOC51_BattleForces document). These are
// themed army variants; the data here drives the picker only — restriction
// rules are not enforced yet.
export const BATTLE_FORCES: Record<FactionId, string[]> = {
  rebels: ["Bright Tree Village", "Echo Base Defenders"],
  imperials: [
    "Blizzard Force",
    "Imperial Remnant",
    "Stormtrooper Battalion",
    "Tempest Force",
  ],
  republic: ["212th Attack Battalion", "501st Legion", "Wookiee Defenders"],
  separatists: [
    "Experimental Droids",
    "Rapid Interdiction Force",
    "Separatist Invasion",
  ],
  mercenary: ["Shadow Collective", "The Ohnaka Gang"],
};

// Standard 800-point army composition
export const RANK_LIMITS: Record<Rank, { min: number; max: number }> = {
  commander: { min: 1, max: 2 },
  operative: { min: 0, max: 2 },
  corps: { min: 3, max: 6 },
  "special-forces": { min: 0, max: 3 },
  support: { min: 0, max: 3 },
  heavy: { min: 0, max: 2 },
};

export const DEFAULT_POINTS_CAP = 800;
