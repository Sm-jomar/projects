// D&D board → 3D scene. Lazy-loaded so three.js stays out of the main
// bundle until someone flips the board into 3D. Board units are grid
// cells (5 ft); token elevation is stored in feet.

import Board3D, { type Piece3D } from "../components/Board3D";
import type { DndTabletopState } from "./dndTabletop";

const FEET_PER_CELL = 5;

export default function Dnd3D({ state, selectedId, onSelect }: {
  state: DndTabletopState;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
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
        blocks={[]}
        pieces={pieces}
        selectedId={selectedId}
        onSelect={onSelect}
      />
      {selected && (
        <div className="board3d-info small">
          <b>{selected.name}</b>
          {(selected.elevation ?? 0) > 0 ? <> · flying {selected.elevation} ft up</> : <> · on the ground</>}
        </div>
      )}
    </>
  );
}
