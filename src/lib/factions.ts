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
    name: "Shadow Collective",
    short: "Mercenary",
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
