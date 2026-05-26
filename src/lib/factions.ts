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
// themed army variants. Allowed-unit lists come from the same source and
// drive the unit-browser filter when a battle force is selected.
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

// Unit names allowed in each Battle Force, transcribed from DOC51_BattleForces.
// Names are loose strings — UnitBrowser uses fuzzy matching against unit.name
// so minor variations between this list and the catalog still resolve.
export const BATTLE_FORCE_UNITS: Record<string, string[]> = {
  "212th Attack Battalion": [
    "Obi-Wan Kenobi",
    "Clone Commander Cody",
    "Jedi Knight",
    "Clone Trooper Infantry",
    "Clone Trooper Marksmen",
    "ARF Troopers",
    "AT-RT",
    "Saber-Class Tank",
    "LAAT/le Patrol Transport",
    "Infantry Support Platform",
  ],
  "501st Legion": [
    "Ahsoka Tano",
    "Anakin Skywalker",
    "Clone Captain Rex",
    "Clone Commander",
    "Clone Trooper Infantry",
    "Clone Trooper Marksmen",
    "ARC Troopers",
    "ARF Troopers",
    "ARC Troopers (Strike Team)",
    "ARC Strike Team",
    "AT-RT",
    "BARC Speeder",
    "Clone Commandos",
    "LAAT/le Patrol Transport",
  ],
  "Wookiee Defenders": [
    "Yoda",
    "Chewbacca",
    "Wookiee Chieftain",
    "Jedi Knight",
    "ARC Troopers",
    "Wookiee Warriors",
    "Clone Trooper Infantry",
    "BARC Speeder",
    "Raddaugh Gnasp Fluttercraft",
    "Infantry Support Platform",
    "Saber-Class Tank",
  ],
  "Blizzard Force": [
    "Darth Vader",
    "General Veers",
    "Imperial Officer",
    "Snowtroopers",
    "Stormtroopers",
    "Imperial Probe Droid",
    "74-Z Speeder Bikes",
    "E-Web Heavy Blaster Team",
    "AT-ST",
  ],
  "Imperial Remnant": [
    "Moff Gideon",
    "Imperial Officer",
    "Imperial Agent",
    "Stormtroopers",
    "Shoretroopers",
    "Scout Troopers",
    "Imperial Death Troopers",
    "74-Z Speeder Bikes",
    "E-Web Heavy Blaster Team",
    "Imperial Dark Troopers",
  ],
  "Stormtrooper Battalion": [
    "Darth Vader",
    "Imperial Officer",
    "Imperial Agent",
    "Stormtrooper Riot Squad",
    "Stormtroopers",
    "Imperial Probe Droid",
    "Scout Troopers",
    "74-Z Speeder Bikes",
    "E-Web Heavy Blaster Team",
    "Scout Troopers (Strike Team)",
    "AT-ST",
    "TX-225 GAVw Occupier Tank",
    "LAAT/le Patrol Transport",
  ],
  "Tempest Force": [
    "Imperial Officer",
    "Imperial Agent",
    "Imperial Probe Droid",
    "Scout Troopers",
    "Stormtroopers",
    "74-Z Speeder Bikes",
    "AT-ST",
    "Major Marquand",
  ],
  "Bright Tree Village": [
    "C-3PO",
    "Han Solo",
    "Leia Organa",
    "Logray",
    "Wicket",
    "Chewbacca",
    "Ewok Skirmishers",
    "Rebel Troopers",
    "Ewok Slingers",
    "Rebel Commandos",
  ],
  "Echo Base Defenders": [
    "Leia Organa",
    "Luke Skywalker",
    "Han Solo",
    "Rebel Officer",
    "Chewbacca",
    "R2-D2",
    "C-3PO",
    "Rebel Agent",
    "Rebel Veterans",
    "Mark II Medium Blaster Trooper",
    "1.4 FD Laser Cannon Team",
    "Tauntaun Riders",
    "T-47 Airspeeder",
  ],
  "Experimental Droids": [
    "Kalani",
    "Kraken",
    "T-Series Tactical Droid",
    "B1 Battle Droids",
    "B2 Super Battle Droids",
    "BX-Series Droid Commandos",
    "IG-100 MagnaGuard",
    "Droidekas",
    "Persuader-Class Tank",
    "NR-N99 Persuader-Class Tank",
  ],
  "Rapid Interdiction Force": [
    "Admiral Trench",
    "General Grievous",
    "Super Tactical Command Droid",
    "BX-Series Droid Commandos",
    "Geonosian Warriors",
    "TSMEU-6 Wheel Bikes",
    "Droidekas",
    "DSD-1 Dwarf Spider Droid",
    "LM-432 Crab Droid",
    "STAP Riders",
    "AAT Battle Tank",
  ],
  "Separatist Invasion": [
    "Count Dooku",
    "General Grievous",
    "T-Series Tactical Droid",
    "Maul",
    "IG-100 MagnaGuard",
    "B1 Battle Droids",
    "Droidekas",
    "STAP Riders",
    "AAT Battle Tank",
  ],
  "Shadow Collective": [
    "Black Sun Vigo",
    "Gar Saxon",
    "Pyke Syndicate Capo",
    "Bossk",
    "Cad Bane",
    "Maul",
    "Savage Oppress",
    "Mandalorian Super Commandos",
    "Black Sun Enforcers",
    "Pyke Syndicate Foot Soldiers",
    "Weequay Pirates",
    "Swoop Bike Riders",
    "A-A5 Speeder Truck",
    "WLO-5 Speeder Tank",
  ],
  "The Ohnaka Gang": [
    "Hondo Ohnaka",
    "Weequay Pirates",
    "Swoop Bike Riders",
    "WLO-5 Speeder Tank",
  ],
};

function _norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Returns true if `unitName` is allowed in the given battle force by fuzzy
 * (normalised, substring-tolerant) name match against BATTLE_FORCE_UNITS. */
export function isUnitInBattleForce(
  unitName: string,
  battleForce: string,
): boolean {
  const allowed = BATTLE_FORCE_UNITS[battleForce];
  if (!allowed) return true; // Unknown BF: don't filter
  const target = _norm(unitName);
  return allowed.some((name) => {
    const n = _norm(name);
    return target === n || target.includes(n) || n.includes(target);
  });
}

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
