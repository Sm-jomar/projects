export type FactionId =
  | "rebels"
  | "imperials"
  | "republic"
  | "separatists"
  | "mercenary";

export type Rank =
  | "commander"
  | "operative"
  | "corps"
  | "special-forces"
  | "support"
  | "heavy";

export type UnitType =
  | "trooper"
  | "emplacement-trooper"
  | "creature-trooper"
  | "ground-vehicle"
  | "repulsor-vehicle";

export type SurgeKind = "hit" | "crit" | "block";

export type Defense = "white" | "red";

export type Weapon = {
  name: string;
  dice: { white?: number; black?: number; red?: number };
  area_of_effect?: number;
  min_range: number;
  max_range?: number;
  keywords?: Record<string, string | number>;
};

export type UpgradeSlotKey =
  | "armament"
  | "command"
  | "comms"
  | "crew"
  | "elite"
  | "force"
  | "gear"
  | "generator"
  | "grenades"
  | "gunner"
  | "hard-point"
  | "heavy-weapon"
  | "ordnance"
  | "personnel"
  | "pilot"
  | "training";

export type UpgradeSlots = Partial<Record<UpgradeSlotKey, number>>;

export type Upgrade = {
  id: string;
  name: string;
  type: UpgradeSlotKey | string;
  points: number;
  is_unique: boolean;
  text?: string;
  restricted_to_unit?: { id: string }[];
  adds_miniature?: boolean;
  adds_upgrade_slots?: UpgradeSlots;
  is_exhaustible?: boolean;
  keywords?: Record<string, string | number>;
  keywords_for_unit?: Record<string, string | number>;
  weapon?: Weapon;
  waves?: string[];
};

export type Unit = {
  id: string;
  name: string;
  sub_title?: string;
  is_unique: boolean;
  faction: FactionId;
  type: UnitType | string;
  points: number;
  rank: Rank;
  miniatures: number;
  wounds: number;
  resilience?: number;
  defense: Defense;
  has_defense_surge: boolean;
  attack_surge?: SurgeKind;
  courage?: number;
  speed?: number;
  upgrades?: UpgradeSlots;
  weapons?: Weapon[];
  keywords?: Record<string, string | number>;
  waves?: string[];
  force_alignment?: "light" | "dark";
};

export type Catalog = {
  version?: string | number;
  units: Unit[];
  upgrades?: Upgrade[];
  commandCards?: unknown[];
};

export type ArmyEntry = {
  entryId: string; // unique per slot in the army (uuid-like)
  unitId: string;
  upgrades?: string[]; // upgrade IDs attached to this entry
};

export type SavedArmy = {
  id: string;
  name: string;
  faction: FactionId;
  pointsCap: number;
  entries: ArmyEntry[];
  updatedAt: number;
};

// Tours of Duty Register — mirrors the AMG paper form so it can be filled
// in digitally and shared as a JSON document.
export type AgendaSlot = {
  name: string;
  progression: number; // 0..5
};

export type Dossier = {
  id: string;
  dossierName: string;
  unitName: string;
  setbacks: string;
  veteranRank: number; // 0..5
  experience: string;
  upgrades: string;
  commendations: string;
  pointsSpent: string;
};

export type TodRegister = {
  id: string;
  name: string;
  reputation: string;
  storyArc: string;
  combatPotential: string;
  combatPotentialSpent: string;
  supplyPoints: string;
  strategicAssets: string;
  agendas: AgendaSlot[];
  dossiers: Dossier[];
  updatedAt: number;
};
