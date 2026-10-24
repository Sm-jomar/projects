// Legion board → 3D scene. Lazy-loaded so three.js stays out of the main
// bundle until someone flips the board into 3D.

import Board3D, { type Block3D, type FigureStyle, type MoveMeasure, type Piece3D, type PieceModel } from "./Board3D";
import {
  deploymentZones, terrainClears, terrainElevation, FACTION_STROKE, TEMPLATE_SEGMENT_INCHES,
  type FactionColor, type TabletopState, type Terrain, type Token,
} from "../lib/tabletop";
import { unitById } from "../data/catalog";

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
  if (u?.type === "ground-vehicle") return { model: { kind: "vehicle", style, repulsor: false }, height: tk.size * 0.6 };
  if (u?.type === "repulsor-vehicle") return { model: { kind: "vehicle", style, repulsor: true }, height: tk.size * 0.45 };
  if (u?.type === "emplacement-trooper") return { model: { kind: "emplacement", style }, height: tk.size * 0.6 };
  if (u?.type === "creature-trooper") return { model: { kind: "figure", style }, height: tk.size * 1.4 };
  return { model: { kind: "figure", style }, height: tk.size * 1.3 };
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

  const zones = state.deployment ? (() => {
    const z = deploymentZones(state.deployment, state.map);
    return [
      { x: z.blue.x, y: z.blue.y, w: z.blue.w, d: z.blue.h, color: "#3a78c2" },
      { x: z.red.x, y: z.red.y, w: z.red.w, d: z.red.h, color: "#c24a3a" },
    ];
  })() : [];

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
