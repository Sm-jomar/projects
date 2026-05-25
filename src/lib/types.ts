export type FactionId =
  | "rebels"
  | "imperials"
  | "republic"
  | "separatists";

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

export type UpgradeSlots = Partial<Record<
  | "command"
  | "comms"
  | "force"
  | "gear"
  | "generator"
  | "grenades"
  | "hardpoint"
  | "heavy-weapon"
  | "ordnance"
  | "personnel"
  | "pilot"
  | "training"
  | "armament"
  | "crew"
  | "gunner"
  | "elite",
  number
>>;

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
  upgrades?: unknown[];
  commandCards?: unknown[];
};

export type ArmyEntry = {
  entryId: string; // unique per slot in the army (uuid-like)
  unitId: string;
};

export type SavedArmy = {
  id: string;
  name: string;
  faction: FactionId;
  pointsCap: number;
  entries: ArmyEntry[];
  updatedAt: number;
};
