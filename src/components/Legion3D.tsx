// Legion board → 3D scene. Lazy-loaded so three.js stays out of the main
// bundle until someone flips the board into 3D.

import Board3D, {
  type Block3D, type FigureSpec, type FigureStyle, type MoveMeasure, type Piece3D, type PieceModel, type VehicleFrame,
} from "./Board3D";
import {
  territories, terrainClears, terrainElevation, FACTION_STROKE, TEMPLATE_SEGMENT_INCHES,
  type FactionColor, type TabletopState, type Terrain, type Token,
} from "../lib/tabletop";
import { unitById } from "../data/catalog";
import type { Unit } from "../lib/types";

// Each faction's pieces take the shape of that faction's iconic trooper.
const FACTION_STYLE: Record<FactionColor, FigureStyle> = {
  rebels: "rebel",
  imperials: "imperial",
  republic: "clone",
  separatists: "droid",
  mercenary: "merc",
  neutral: "pawn",
};

const FACTION_BODY: Record<FactionColor, string> = {
  rebels: "#a14026",
  imperials: "#3c5f86",
  republic: "#b45a22",
  separatists: "#6a4a86",
  mercenary: "#8a6a1f",
  neutral: "#666c78",
};

const TERRAIN_COLOR: Record<Terrain["kind"], { fill: string; edge: string }> = {
  rock:      { fill: "#5d6878", edge: "#8a96aa" },
  wall:      { fill: "#4a5060", edge: "#7a8296" },
  building:  { fill: "#6e6048", edge: "#a08c68" },
  forest:    { fill: "#2f5237", edge: "#4a7a55" },
  barricade: { fill: "#7a5a32", edge: "#a88250" },
  objective: { fill: "#a37a16", edge: "#ffd24a" },
};

function modelFor(tk: Token): { model: PieceModel; height: number } {
  const style = FACTION_STYLE[tk.color];
  if (tk.kind !== "unit") return { model: { kind: "marker" }, height: tk.size * 0.15 };
  const u = tk.unitId ? unitById(tk.unitId) : undefined;
  if (!u) return { model: { kind: "figure", style }, height: tk.size * 1.3 };
  const shape = unitShape(u, style);
  return { model: shape.model, height: tk.size * shape.height };
}

const BLUE = "#4aa8ff", GREEN = "#5aff6a", RED = "#ff3a3a", WHITE = "#e8f4ff";

// Default model for a unit, picked from its name, type and rank. Height is
// relative to the base size.
function unitShape(u: Unit, style: FigureStyle): { model: PieceModel; height: number } {
  const n = u.name;
  const sub = u.unit_subtype ?? "";
  const vehicle = (frame: VehicleFrame, height: number, spec?: FigureSpec) =>
    ({ model: { kind: "vehicle", style, repulsor: u.type === "repulsor-vehicle", frame, pilot: spec } as PieceModel, height });

  if (/Mounted Jedi/.test(u.sub_title ?? "")) return { model: { kind: "rider", style, mount: "boga", pilot: { build: "robed", sabers: [BLUE] } }, height: 1.5 };
  if (u.type === "ground-vehicle" || u.type === "repulsor-vehicle") {
    if (/AT-ST/.test(n)) return vehicle("walker", 1.5);
    if (/AT-RT/.test(n)) return vehicle("scout-walker", 1.4);
    if (/Speeder Bike|STAP|BARC|Swoop/.test(n)) return vehicle("bike", 0.75);
    if (/Airspeeder|Fluttercraft/.test(n)) return vehicle("airspeeder", 0.4);
    if (/LAAT/.test(n)) return vehicle("gunship", 0.5);
    if (/Crab Droid|Spider Droid/.test(n)) return vehicle("crawler", 0.75);
    if (/Landspeeder|Speeder Truck/.test(n)) return vehicle("landspeeder", 0.5);
    if (/Chewbacca/.test(n)) return vehicle("landspeeder", 0.5, { build: "wookiee" });
    if (/AAT|Speeder Tank|TX-130|Support Platform/.test(n) || u.type === "repulsor-vehicle") return vehicle("hover-tank", 0.45);
    return vehicle("tank", 0.6);
  }
  if (u.type === "emplacement-trooper" || sub === "emplacement-trooper") return { model: { kind: "emplacement", style }, height: 0.6 };
  if (/Tauntaun/.test(n)) return { model: { kind: "rider", style, mount: "tauntaun", pilot: {} }, height: 1.7 };
  if (/Dewback/.test(n)) return { model: { kind: "rider", style, mount: "dewback", pilot: {} }, height: 1.3 };

  const commander = u.rank === "commander";
  const fig = (spec: FigureSpec, height = 1.3) => ({ model: { kind: "figure", style, commander, ...spec } as PieceModel, height });

  // Force users.
  if (/Yoda/.test(n)) return fig({ build: "yoda", sabers: [GREEN], commander: false }, 0.75);
  if (/Vader/.test(n)) return fig({ build: "vader", sabers: [RED], commander: false }, 1.45);
  if (/Grievous/.test(n)) return fig({ build: "grievous", sabers: [BLUE, GREEN, BLUE, GREEN], commander: false }, 1.5);
  if (/Ahsoka/.test(n)) return fig({ build: "robed", sabers: u.faction === "rebels" ? [WHITE, WHITE] : [GREEN, "#d8ff5a"], palette: { body: "#a8622e", trim: "#3a5a8a" }, commander: false });
  if (u.force_alignment === "light") {
    const green = /Luke|Jedi Knight$/.test(n);
    return fig({ build: "robed", sabers: [green ? GREEN : BLUE], palette: /Luke/.test(n) ? { body: "#2a2a2e", trim: "#1a1a1d" } : undefined, commander: false });
  }
  if (u.force_alignment === "dark") {
    const sith = { body: "#1f1b1e", trim: "#3a1416", dark: "#0e0c0e" };
    if (/Maul/.test(n)) return fig({ build: "robed", sabers: [RED], doubleSaber: true, palette: sith, commander: false });
    if (/Ventress/.test(n)) return fig({ build: "robed", sabers: [RED, RED], palette: sith, commander: false });
    if (/Brother|Sister/.test(n)) return fig({ build: "robed", sabers: [RED], doubleSaber: true, palette: { body: "#2c2f36", trim: "#14161a", dark: "#0b0c0e" }, commander: false });
    return fig({ build: "robed", sabers: [RED], palette: sith, commander: false });
  }

  // Species and droids with a shape of their own.
  if (/Wookiee|Chewbacca/.test(n)) return fig({ build: "wookiee" }, 1.6);
  if (/Ewok|Wicket|Logray/.test(n)) return fig({ build: "ewok", commander: false }, 0.8);
  if (/Geonosian|Poggle|Sun Fac/.test(n)) return fig({ build: "insect" }, 1.3);
  if (/R2-D2/.test(n)) return fig({ build: "astromech", commander: false }, 0.8);
  if (/Droideka/.test(n)) return fig({ build: "droideka", commander: false }, 1.0);
  if (/Probe Droid/.test(n)) return fig({ build: "probe", commander: false }, 1.1);
  if (/B2/.test(n)) return fig({ build: "b2", jetpack: /Rocket/.test(n) }, 1.3);
  if (/C-3PO/.test(n)) return fig({ build: "tall-droid", palette: { body: "#d8b04a", trim: "#9a7a2a" } });
  if (/K-2SO/.test(n)) return fig({ build: "tall-droid", palette: { body: "#2a2c30" } }, 1.5);
  if (/Dark Troopers/.test(n)) return fig({ build: "tall-droid", palette: { body: "#1e2024", trim: "#3a3d44" } }, 1.4);
  if (/MagnaGuard/.test(n)) return fig({ build: "tall-droid", sabers: ["#c060ff"], palette: { body: "#3a2e26" } }, 1.45);
  if (/Tactical|Kalani|Kraken/.test(n)) return fig({ build: "tall-droid", palette: { body: "#6c7a8f", trim: "#3a4250" } }, 1.4);
  if (sub === "droid-trooper" && !/B1|BX|Aqua|Iden/.test(n)) return fig({ build: "tall-droid" }, 1.4);
  if (sub === "droid-trooper" && /B1|BX|Aqua/.test(n)) return { model: { kind: "figure", style: "droid", commander }, height: 1.3 };
  if (sub === "mandalorian-trooper" || /Mandalorian|Boba Fett|Din Djarin|Gar Saxon|Sabine/.test(n)) return fig({ build: "mando" });
  if (/IG-(88|11)/.test(n)) return fig({ build: "tall-droid", palette: { body: "#5d6168", trim: "#3a3d44" } }, 1.45);

  // Clones look like clones whoever fields them.
  if (sub === "clone-trooper") return { model: { kind: "figure", style: "clone", commander }, height: 1.3 };
  // Named characters and officers go bare-headed; troopers wear the faction kit.
  if (u.is_unique || /Officer|Agent|Vigo|Capo/.test(n)) return fig({ build: "hero" });
  if (/Death Troopers/.test(n)) return fig({ palette: { body: "#202227", trim: "#0e0f12", dark: "#3a3d44" } });
  return fig({});
}

// How far a unit moved against its speed: a full move is one movement
// template (speed × segment), up to double is a second move.
function measureMove(tk: Token | undefined, dx: number, dy: number): MoveMeasure {
  const dist = Math.hypot(dx, dy);
  const speed = tk?.unitId ? unitById(tk.unitId)?.speed : undefined;
  const text = `${(Math.round(dist * 10) / 10).toFixed(1)}"`;
  if (!speed) return { label: text, tone: "ok" };
  const full = speed * TEMPLATE_SEGMENT_INCHES;
  if (dist <= full + 1e-6) return { label: `${text} · speed ${speed} (${full}")`, tone: "ok" };
  if (dist <= full * 2 + 1e-6) return { label: `${text} · 2 moves (${full * 2}")`, tone: "dash" };
  return { label: `${text} · out of range`, tone: "over" };
}

export default function Legion3D({ state, selectedId, onSelect, showGrid, onUploadModel, onMoveToken, step }: {
  state: TabletopState;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  showGrid: boolean;
  /** Opens the STL picker for the selected unit/terrain (absent = read-only). */
  onUploadModel?: () => void;
  /** Move a token's top-left to (x, y) inches (absent = read-only). A unit
   * under direct control also passes its facing and whether it's mid-run. */
  onMoveToken?: (id: string, x: number, y: number, run?: { facing: number; live: boolean }) => void;
  /** D-pad step in inches. */
  step?: number;
}) {
  const model = (id?: string) => (id ? state.models?.[id]?.data : undefined);
  const selected = state.tokens.find((t) => t.id === selectedId);
  const selTerrain = state.terrain.find((t) => t.id === selectedId);
  const flyHeight = selected?.elevation ?? 0;

  const blocks: Block3D[] = state.terrain.map((t) => {
    const h = terrainElevation(t);
    const c = TERRAIN_COLOR[t.kind];
    return {
      id: t.id, shape: t.shape, x: t.x, y: t.y, w: t.width, d: t.shape === "circle" ? t.width : t.height,
      rotation: t.rotation, height: h, base: t.float ?? 0, color: c.fill, edge: c.edge,
      style: t.kind === "forest" ? "forest" : "solid",
      standable: t.kind === "building" || t.kind === "rock" || (t.float ?? 0) > 0,
      // With a hovering/flying unit selected, show what it can pass over.
      tint: flyHeight > 0 && t.kind !== "objective" ? (terrainClears(t, flyHeight) ? "clear" : "block") : null,
      selected: t.id === selectedId,
      stl: model(t.modelId),
    };
  });

  const pieces: Piece3D[] = state.tokens.map((tk) => {
    const shape = modelFor(tk);
    const stl = model(tk.modelId);
    return {
      id: tk.id,
      x: tk.x + tk.size / 2,
      y: tk.y + tk.size / 2,
      footprint: tk.size,
      modelHeight: shape.height,
      lift: tk.elevation ?? 0,
      color: FACTION_BODY[tk.color],
      accent: FACTION_STROKE[tk.color],
      model: stl ? { kind: "stl", data: stl } : shape.model,
      iconUrl: tk.portraitUrl,
      iconCropTop: true,
      facing: tk.rotation,
      dim: tk.activated,
    };
  });

  const terr = territories(state);
  const zones = terr ? [
    ...terr.blue.map((z) => ({ x: z.x, y: z.y, w: z.w, d: z.h, color: "#3a78c2" })),
    ...terr.red.map((z) => ({ x: z.x, y: z.y, w: z.w, d: z.h, color: "#c24a3a" })),
  ] : [];

  return (
    <>
      <Board3D
        width={state.map.widthInches}
        depth={state.map.heightInches}
        groundColor="#2a3a46"
        groundImageUrl={state.mapImage?.url}
        groundImageFit={state.mapImage?.fit}
        groundImageDim={state.mapImage?.dim}
        gridStep={showGrid ? 6 : 0}
        gridColor="#4a5f72"
        zones={zones}
        blocks={blocks}
        pieces={pieces}
        selectedId={selectedId}
        onSelect={onSelect}
        moveStep={step}
        onMove={onMoveToken && ((id, x, y, run) => {
          const tk = state.tokens.find((t) => t.id === id);
          if (tk) onMoveToken(id, x - tk.size / 2, y - tk.size / 2, run);
        })}
        measure={(id, dx, dy) => measureMove(state.tokens.find((t) => t.id === id), dx, dy)}
      />
      {(selected || selTerrain) && (
        <div className="board3d-info small">
          {selected ? <>
            <b>{selected.label}</b>
            {flyHeight > 0
              ? <> · flying at {flyHeight}" — <span className="board3d-clear">green</span> terrain it can pass over, <span className="board3d-block">red</span> blocks it</>
              : <> · on the ground</>}
          </> : selTerrain && <>
            <b>{selTerrain.label || selTerrain.kind}</b> · {terrainElevation(selTerrain)}" tall
            {(selTerrain.float ?? 0) > 0 && <>, floating {selTerrain.float}" up</>}
          </>}
          {onUploadModel && (
            <button className="ghost-btn small board3d-upload" onClick={onUploadModel}>
              {(selected?.modelId ?? selTerrain?.modelId) ? "Replace STL" : "Upload STL"}
            </button>
          )}
        </div>
      )}
    </>
  );
}
