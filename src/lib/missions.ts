// Legion missions from the Battle Cards (DOC41_BattleCards_11.26.2025):
// each Objective Card pairs with a Map Card that fixes both players'
// Territories (deployment zones) and where the Objective tokens go. The
// coordinates below were read off the Map Cards, whose grid is one square
// per Range 1 (6"), so every edge lands on a 3" step.
//
// Map Cards are drawn portrait: 36" across, blue Territory on the right,
// red on the left. `fromCard` turns that into the board's landscape view
// with blue along the top edge (the blue player picks a long edge, so a
// half turn of the card is equally legal; mirroring it would not be).

import type { MapSize, Token } from "./tabletop";

export type MissionId =
  | "breakthrough" | "recover-the-research" | "shifting-priorities"
  | "intercept-signals" | "bunker-assault" | "close-the-pocket" | "outflank";

/** Which Map Card: the standard 6' × 3' battlefield or the 3' × 3' Recon one. */
export type MapVariant = "standard" | "recon";

type Rect = { x: number; y: number; w: number; h: number };
type Pt = { x: number; y: number };

type CardMap = {
  /** Card height in inches (card width is always 36"). */
  length: number;
  blue: Rect[];
  red: Rect[];
  pois: Pt[];
  /** Optional per-POI label override (same order as pois). */
  labels?: string[];
};

export type Mission = {
  id: MissionId;
  name: string;
  /** What the POI tokens are called on this card. */
  poi: string;
  setup: string;
  scoring: string;
  special?: string;
  /** Card images under public/. */
  card: string;
  mapCard: { standard?: string; recon?: string };
  maps: Partial<Record<MapVariant, CardMap>>;
};

const SIDE_TALL: Pick<CardMap, "blue" | "red"> = {
  // Red: 1½ range deep along the left edge, Range 3 short of the top.
  red: [{ x: 0, y: 18, w: 9, h: 54 }],
  blue: [{ x: 27, y: 0, w: 9, h: 54 }],
};

export const MISSIONS: Mission[] = [
  {
    id: "breakthrough",
    name: "Breakthrough",
    poi: "Checkpoint",
    setup: "Place 4 Checkpoints (POI) as shown on the Breakthrough Map Card.",
    scoring: "From Round 2, each End Phase: 1 VP per Checkpoint in allied Territory not Contested by an enemy unit, plus 2 VP per Checkpoint in enemy Territory you Secure.",
    card: "cards/generic/battle/sreakthrough.jpg",
    mapCard: { standard: "cards/generic/battle/generic-battle-90f0b91d.jpg" },
    maps: {
      standard: {
        length: 72,
        red: [{ x: 0, y: 18, w: 9, h: 54 }, { x: 9, y: 63, w: 12, h: 9 }],
        blue: [{ x: 27, y: 0, w: 9, h: 54 }, { x: 15, y: 0, w: 12, h: 9 }],
        pois: [{ x: 18, y: 6 }, { x: 6, y: 24 }, { x: 30, y: 48 }, { x: 18, y: 66 }],
      },
    },
  },
  {
    id: "recover-the-research",
    name: "Recover the Research",
    poi: "Lab",
    setup: "Place 6 Labs (POI) as shown on the Recover the Research Map Card.",
    scoring: "From Round 2, each End Phase: 1 VP if allied units Contest 2 Labs, 2 VP for 3 Labs, or 3 VP for 4 or more Labs.",
    card: "cards/generic/battle/recover-the-research.jpg",
    mapCard: { standard: "cards/generic/battle/cnc-sm.jpg" },
    maps: {
      standard: {
        length: 72, ...SIDE_TALL,
        pois: [{ x: 24, y: 12 }, { x: 12, y: 18 }, { x: 24, y: 30 }, { x: 12, y: 42 }, { x: 24, y: 54 }, { x: 12, y: 60 }],
      },
    },
  },
  {
    id: "shifting-priorities",
    name: "Shifting Priorities",
    poi: "Priority Target",
    setup: "Place 5 Priority Targets (POI) as shown on the Shifting Priorities Map Card.",
    scoring: "From Round 2, each End Phase: 1 VP per Priority Target you Secure.",
    special: "From Round 2, at the end of each End Phase, players take turns (blue first) moving each Priority Target Secured by their opponent up to Range 1 (6\"). Each can be moved only once per Round.",
    card: "cards/generic/battle/hifting-priorities.jpg",
    mapCard: { standard: "cards/generic/battle/generic-battle-35e36086.jpg" },
    maps: {
      standard: {
        length: 72, ...SIDE_TALL,
        pois: [{ x: 12, y: 6 }, { x: 18, y: 18 }, { x: 18, y: 36 }, { x: 18, y: 54 }, { x: 24, y: 66 }],
      },
    },
  },
  {
    id: "intercept-signals",
    name: "Intercept Signals",
    poi: "Comms Tower",
    setup: "Place 4 Comms Towers (POI) as shown on the Map Card. Starting with blue, each player chooses 3 allied units, then 2 of the enemy's chosen units; each of those gains an Intel token.",
    scoring: "From Round 2, each End Phase: 1 VP per Comms Tower not in allied Territory that is Contested by an allied unit with an Intel token, or that you Secure.",
    special: "At the end of each End Phase, a player Securing a Comms Tower may give an Intel token to up to 2 allied units Contesting it (max 2 units with Intel each).",
    card: "cards/generic/battle/intercept-signals.jpg",
    mapCard: {
      standard: "cards/generic/battle/generic-battle-4828c833.jpg",
      recon: "cards/generic/battle/generic-battle-3efc778d.jpg",
    },
    maps: {
      standard: {
        length: 72,
        red: [{ x: 0, y: 12, w: 9, h: 48 }],
        blue: [{ x: 27, y: 12, w: 9, h: 48 }],
        pois: [{ x: 18, y: 18 }, { x: 6, y: 36 }, { x: 30, y: 36 }, { x: 18, y: 54 }],
      },
      recon: {
        length: 36,
        red: [{ x: 0, y: 6, w: 9, h: 24 }],
        blue: [{ x: 27, y: 6, w: 9, h: 24 }],
        pois: [{ x: 18, y: 6 }, { x: 6, y: 18 }, { x: 30, y: 18 }, { x: 18, y: 30 }],
      },
    },
  },
  {
    id: "bunker-assault",
    name: "Bunker Assault",
    poi: "Bunker",
    setup: "Place 4 Bunkers (POI) as shown on the Map Card. The 2 Bunkers furthest from your Territory are your enemy Bunkers.",
    scoring: "From Round 2, each End Phase: 1 VP per Bunker you Secure, plus 3 VP per enemy Bunker destroyed that End Phase.",
    special: "From Round 2, at the end of each End Phase, place 1 Wound on each enemy Bunker you Secure (+1 for a Heavy/Vehicle/Emplacement Contesting it). A Bunker with 3+ Wounds is destroyed and removed.",
    card: "cards/generic/battle/sunker-assault.jpg",
    mapCard: {
      standard: "cards/generic/battle/generic-battle-7f90cac0.jpg",
      recon: "cards/generic/battle/generic-battle-42cb60be.jpg",
    },
    maps: {
      standard: {
        length: 72,
        red: [{ x: 0, y: 12, w: 9, h: 48 }],
        blue: [{ x: 27, y: 12, w: 9, h: 48 }],
        pois: [{ x: 12, y: 24 }, { x: 24, y: 24 }, { x: 12, y: 48 }, { x: 24, y: 48 }],
        labels: ["Red bunker", "Blue bunker", "Red bunker", "Blue bunker"],
      },
      recon: {
        length: 36,
        red: [{ x: 0, y: 6, w: 9, h: 24 }],
        blue: [{ x: 27, y: 6, w: 9, h: 24 }],
        pois: [{ x: 12, y: 6 }, { x: 24, y: 6 }, { x: 12, y: 30 }, { x: 24, y: 30 }],
        labels: ["Red bunker", "Blue bunker", "Red bunker", "Blue bunker"],
      },
    },
  },
  {
    id: "close-the-pocket",
    name: "Close the Pocket",
    poi: "Stockpile",
    setup: "Place 3 Stockpiles (POI) as shown on the Close the Pocket Map Card.",
    scoring: "From Round 2, each End Phase: 2 VP if you Secure the center Stockpile, and 1 VP per other Stockpile you Secure.",
    card: "cards/generic/battle/lose-the-pocket.jpg",
    mapCard: {
      standard: "cards/generic/battle/generic-battle-71952ba9.jpg",
      recon: "cards/generic/battle/generic-battle-c9a18333.jpg",
    },
    maps: {
      standard: {
        length: 72,
        red: [{ x: 0, y: 0, w: 9, h: 21 }, { x: 0, y: 51, w: 9, h: 21 }],
        blue: [{ x: 27, y: 0, w: 9, h: 21 }, { x: 27, y: 51, w: 9, h: 21 }],
        pois: [{ x: 18, y: 18 }, { x: 18, y: 36 }, { x: 18, y: 54 }],
        labels: ["Stockpile", "Center stockpile", "Stockpile"],
      },
      recon: {
        length: 36,
        red: [{ x: 0, y: 0, w: 9, h: 9 }, { x: 0, y: 27, w: 9, h: 9 }],
        blue: [{ x: 27, y: 0, w: 9, h: 9 }, { x: 27, y: 27, w: 9, h: 9 }],
        pois: [{ x: 18, y: 6 }, { x: 18, y: 18 }, { x: 18, y: 30 }],
        labels: ["Stockpile", "Center stockpile", "Stockpile"],
      },
    },
  },
  {
    id: "outflank",
    name: "Outflank",
    poi: "Flag",
    setup: "Place 4 Flags (POI) as shown on the Map Card. Starting with blue, each player chooses up to 3 of their units not being transported; each gains a Vanguard token.",
    scoring: "From Round 2, each End Phase: 1 VP per Flag you Secure, plus 1 VP if you control 2+ units with Vanguard tokens Contesting Flags you Secure.",
    special: "Units with Vanguard tokens must Deploy in the strip of your Territory along a short battlefield edge, and only they may (unless Deploying with Transport).",
    card: "cards/generic/battle/eae-f-ws-vy-fwews-42-acy-sa.jpg",
    mapCard: { standard: "cards/generic/battle/generic-battle-a3a1bd9e.jpg" },
    maps: {
      standard: {
        length: 72,
        red: [{ x: 0, y: 0, w: 24, h: 6 }, { x: 0, y: 18, w: 9, h: 36 }],
        blue: [{ x: 12, y: 66, w: 24, h: 6 }, { x: 27, y: 18, w: 9, h: 36 }],
        pois: [{ x: 24, y: 12 }, { x: 12, y: 36 }, { x: 24, y: 36 }, { x: 12, y: 60 }],
      },
    },
  },
];

/** Secondary Objective Cards (no fixed map; tokens are placed by players). */
export const SECONDARY_OBJECTIVES: { name: string; card: string; recon?: boolean }[] = [
  { name: "Bring Them to Heel", card: "cards/generic/battle/sring-them-to-heel.jpg", recon: true },
  { name: "Destroy Enemy Base", card: "cards/generic/battle/destroy-enemy-base.jpg" },
  { name: "Marked Targets", card: "cards/generic/battle/marked-targets.jpg" },
  { name: "Recon Mission", card: "cards/generic/battle/recon-mission.jpg", recon: true },
  { name: "Supply Run", card: "cards/generic/battle/supply-run.jpg" },
  { name: "Surface Scan", card: "cards/generic/battle/surface-scan.jpg", recon: true },
  { name: "Sweep and Clear", card: "cards/generic/battle/sweep-and-clear.jpg" },
];

export function missionById(id: string | null | undefined): Mission | undefined {
  return id ? MISSIONS.find((m) => m.id === id) : undefined;
}

/** The Map Card that fits this board: Recon on a square board when the
 * mission has one, otherwise the standard card (stretched to fit). */
export function mapVariantFor(m: Mission, map: MapSize): MapVariant {
  const square = Math.abs(map.widthInches - map.heightInches) < 1e-6;
  return square && m.maps.recon ? "recon" : "standard";
}

/** True when the board isn't the size the Map Card is drawn for, so
 * positions are stretched in proportion. */
export function missionScaled(m: Mission, map: MapSize): boolean {
  const v = mapVariantFor(m, map);
  const len = m.maps[v]!.length;
  return map.widthInches !== len || map.heightInches !== 36;
}

// Card (portrait, blue right) -> board (landscape, blue top), then scaled.
function fromCard(cm: CardMap, map: MapSize) {
  const sx = map.widthInches / cm.length;
  const sy = map.heightInches / 36;
  return {
    rect: (r: Rect): Rect => ({ x: r.y * sx, y: (36 - r.x - r.w) * sy, w: r.h * sx, h: r.w * sy }),
    pt: (p: Pt): Pt => ({ x: p.y * sx, y: (36 - p.x) * sy }),
  };
}

export function missionTerritories(m: Mission, map: MapSize): { blue: Rect[]; red: Rect[] } {
  const cm = m.maps[mapVariantFor(m, map)]!;
  const t = fromCard(cm, map);
  return { blue: cm.blue.map(t.rect), red: cm.red.map(t.rect) };
}

/** POI tokens are 2" across (core rules p.11). */
export const POI_SIZE = 2;
export const POI_ID_PREFIX = "poi-";

export function isMissionPoi(tk: Token): boolean {
  return tk.id.startsWith(POI_ID_PREFIX);
}

/** The mission's Objective tokens, centred on the Map Card positions. */
export function missionPois(m: Mission, map: MapSize): Token[] {
  const cm = m.maps[mapVariantFor(m, map)]!;
  const t = fromCard(cm, map);
  return cm.pois.map((p, i) => {
    const c = t.pt(p);
    return {
      id: `${POI_ID_PREFIX}${m.id}-${i}`,
      kind: "objective",
      x: c.x - POI_SIZE / 2,
      y: c.y - POI_SIZE / 2,
      size: POI_SIZE,
      label: cm.labels?.[i] ?? m.poi,
      color: "neutral",
    } satisfies Token;
  });
}
