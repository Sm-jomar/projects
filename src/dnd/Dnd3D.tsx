// D&D board → 3D scene. Lazy-loaded so three.js stays out of the main
// bundle until someone flips the board into 3D. Board units are grid
// cells (5 ft); token elevation is stored in feet.

import Board3D, { type Block3D, type MoveMeasure, type Piece3D } from "../components/Board3D";
import { useMemo } from "react";
import type { DndTabletopState, DndToken } from "./dndTabletop";
import { terrainSeen, type FogView, type Pt } from "./dndFog";

const FEET_PER_CELL = 5;

// Paint the fog onto a canvas laid over the 3D ground: black where the
// player has never looked, a dim veil over ground seen before, clear where
// they can see now (the DM just gets the veil).
function fogCanvas(fog: FogView, cols: number, rows: number): HTMLCanvasElement {
  const px = 24;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(cols * px));
  c.height = Math.max(1, Math.round(rows * px));
  const g = c.getContext("2d")!;
  const trace = (polys: Pt[][]) => {
    g.beginPath();
    for (const p of polys) {
      p.forEach((q, i) => (i ? g.lineTo(q.x * px, q.y * px) : g.moveTo(q.x * px, q.y * px)));
      g.closePath();
    }
  };
  g.fillStyle = "#05060a";
  g.globalAlpha = fog.mode === "dm" ? 0.45 : 1;
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "destination-out";
  if (fog.mode === "player" && fog.explored.length) { g.globalAlpha = 0.4; trace(fog.explored); g.fill(); }
  g.globalAlpha = 1;
  trace(fog.vision);
  g.fill();
  return c;
}

// Grid movement the 5e way: every square, diagonal or not, is 5 ft. Past
// the token's speed it's a Dash (up to double), then out of range.
function measureMove(tk: DndToken | undefined, dx: number, dy: number): MoveMeasure {
  const ft = Math.round(Math.max(Math.abs(dx), Math.abs(dy))) * FEET_PER_CELL;
  const speed = tk?.speed ?? 30;
  if (!speed) return { label: `${ft} ft`, tone: "ok" };
  return {
    label: ft <= speed ? `${ft} ft / ${speed} ft` : ft <= speed * 2 ? `${ft} ft · Dash (${speed * 2} ft)` : `${ft} ft · out of range`,
    tone: ft <= speed ? "ok" : ft <= speed * 2 ? "dash" : "over",
  };
}

export default function Dnd3D({ state, selectedId, onSelect, fog, onUploadModel, onMoveToken }: {
  state: DndTabletopState;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  fog?: FogView | null;
  /** Opens the STL picker for the selected token/terrain (absent = read-only). */
  onUploadModel?: () => void;
  /** Move a token's top-left to (x, y) cells (absent = read-only). */
  onMoveToken?: (id: string, x: number, y: number) => void;
}) {
  const { cols, rows } = state.map;
  const overlay = useMemo(() => (fog ? fogCanvas(fog, cols, rows) : null), [fog, cols, rows]);
  const pieces: Piece3D[] = state.tokens.map((t) => ({
    id: t.id,
    x: t.x + t.size / 2,
    y: t.y + t.size / 2,
    footprint: t.size * 0.9,
    modelHeight: t.kind === "marker" ? 0.15 : t.size === 1 ? 1.1 : t.size * 0.8,
    lift: (t.elevation ?? 0) / FEET_PER_CELL,
    color: t.color,
    accent: t.id === state.activeTokenId ? "#ffd24a" : t.color,
    model: t.modelStl
      ? { kind: "stl", data: t.modelStl }
      : t.kind === "marker" ? { kind: "marker" } : { kind: "figure", style: "pawn" },
    iconUrl: t.avatarUrl,
  }));
  const selected = state.tokens.find((t) => t.id === selectedId);
  const flyFt = selected?.elevation ?? 0;

  // A fogged player doesn't get to see terrain standing in the dark.
  const seenPolys = fog?.mode === "player" ? [...fog.vision, ...fog.explored] : null;
  const terrain = (state.terrain ?? []).filter((t) => !seenPolys || terrainSeen(t, seenPolys));
  const blocks: Block3D[] = terrain.map((t) => ({
    id: t.id, shape: t.shape, x: t.x, y: t.y, w: t.w, d: t.shape === "circle" ? t.w : t.d,
    rotation: t.rotation, height: t.height / FEET_PER_CELL, base: (t.float ?? 0) / FEET_PER_CELL,
    color: t.color, edge: "#c8ccd6",
    style: t.kind === "tree" && !t.modelStl ? "forest" : "solid",
    standable: t.kind !== "tree" || (t.float ?? 0) > 0,
    stl: t.modelStl,
    selected: t.id === selectedId,
    // Floating terrain never blocks: a flyer passes under it or lands on it.
    tint: flyFt > 0 ? ((t.float ?? 0) > 0 || t.height <= flyFt ? "clear" : "block") : null,
  }));
  const selTerrain = (state.terrain ?? []).find((t) => t.id === selectedId);

  return (
    <>
      <Board3D
        width={state.map.cols}
        depth={state.map.rows}
        groundColor="#12151b"
        groundImageUrl={state.map.imageUrl}
        gridStep={state.map.showGrid ? 1 : 0}
        gridColor="#000000"
        gridOpacity={state.map.gridOpacity}
        overlay={overlay}
        blocks={blocks}
        pieces={pieces}
        selectedId={selectedId}
        onSelect={onSelect}
        onMove={onMoveToken && ((id, x, y) => {
          const tk = state.tokens.find((t) => t.id === id);
          if (!tk) return;
          // Snap to the half cell, like dragging on the 2D map.
          const snap = (n: number) => Math.round(n * 2) / 2;
          onMoveToken(id, snap(x - tk.size / 2), snap(y - tk.size / 2));
        })}
        measure={(id, dx, dy) => measureMove(state.tokens.find((t) => t.id === id), dx, dy)}
      />
      {(selected || selTerrain) && (
        <div className="board3d-info small">
          {selected ? <>
            <b>{selected.name}</b>
            {flyFt > 0
              ? <> · flying {flyFt} ft up — <span className="board3d-clear">green</span> terrain it clears, <span className="board3d-block">red</span> blocks it</>
              : <> · on the ground</>}
          </> : selTerrain && <>
            <b>{selTerrain.label || selTerrain.kind}</b> · {selTerrain.height} ft tall
            {(selTerrain.float ?? 0) > 0 && <>, floating {selTerrain.float} ft up</>}
          </>}
          {onUploadModel && (
            <button className="ghost-btn small board3d-upload" onClick={onUploadModel}>
              {(selected?.modelStl ?? selTerrain?.modelStl) ? "Replace STL" : "Upload STL"}
            </button>
          )}
        </div>
      )}
      {!selected && !selTerrain && (
        <div className="board3d-info small">Click a token or terrain piece to give it an STL model.</div>
      )}
    </>
  );
}
