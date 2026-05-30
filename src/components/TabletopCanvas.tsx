import { useEffect, useRef, useState } from "react";
import type { TabletopState, Token, Terrain, FactionColor } from "../lib/tabletop";

// ----- Visual constants ---------------------------------------------------
// 1 inch = 12 SVG units. Keeps math simple and font sizes legible.
const UNITS_PER_INCH = 12;

const TERRAIN_FILL: Record<Terrain["kind"], string> = {
  rock:      "#4b5562",
  wall:      "#3d4250",
  building:  "#5a4e3a",
  forest:    "#2f5237",
  barricade: "#6b4e2b",
  objective: "#a37a16",
};
const TERRAIN_STROKE: Record<Terrain["kind"], string> = {
  rock:      "#6f7a8d",
  wall:      "#5e6577",
  building:  "#806f53",
  forest:    "#4a7a55",
  barricade: "#9a7444",
  objective: "#ffd24a",
};

const FACTION_FILL: Record<FactionColor, string> = {
  rebels:      "#a14026",
  imperials:   "#2c4a6a",
  republic:    "#a44a19",
  separatists: "#5a3a73",
  mercenary:   "#8a6a1f",
  neutral:     "#444",
};
const FACTION_STROKE: Record<FactionColor, string> = {
  rebels:      "#f6c14a",
  imperials:   "#9bc1ec",
  republic:    "#f6c14a",
  separatists: "#c19be0",
  mercenary:   "#e0c477",
  neutral:     "#888",
};

// Drag-state machine. Either we're dragging an item, drawing the ruler,
// panning the view, or doing nothing.
type DragState =
  | { kind: "none" }
  | { kind: "item"; itemId: string; itemType: "token" | "terrain"; offsetX: number; offsetY: number }
  | { kind: "ruler"; startX: number; startY: number; endX: number; endY: number }
  | { kind: "pan"; startClientX: number; startClientY: number; startTx: number; startTy: number };

export type Tool = "move" | "ruler" | "pan";

type Props = {
  state: TabletopState;
  onState: (s: TabletopState) => void;
  tool: Tool;
  snapInches: number; // 0 = no snap, e.g. 1, 0.5, 3
  showGrid: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Called when something is dropped on the canvas via HTML5 DnD. The
   * payload string comes from `dataTransfer.getData("application/x-legion-token")`
   * and the position is in map inches. */
  onDropPayload?: (payload: string, atInches: { x: number; y: number }) => void;
};

export function TabletopCanvas({ state, onState, tool, snapInches, showGrid, selectedId, onSelect, onDropPayload }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragState>({ kind: "none" });
  // View transform: tx/ty in SVG units, scale unitless.
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 });

  // Fit-to-view on map size change.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => fitToView());
    ro.observe(wrap);
    fitToView();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.map.widthInches, state.map.heightInches]);

  function fitToView() {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const padding = 20;
    const w = state.map.widthInches * UNITS_PER_INCH;
    const h = state.map.heightInches * UNITS_PER_INCH;
    const wrapW = wrap.clientWidth - padding * 2;
    const wrapH = wrap.clientHeight - padding * 2;
    if (wrapW <= 0 || wrapH <= 0) return;
    const scale = Math.min(wrapW / w, wrapH / h);
    setView({ tx: (wrap.clientWidth - w * scale) / 2, ty: (wrap.clientHeight - h * scale) / 2, scale });
  }

  function clientToMapInches(clientX: number, clientY: number): { x: number; y: number } {
    const wrap = wrapRef.current!;
    const rect = wrap.getBoundingClientRect();
    const localX = clientX - rect.left - view.tx;
    const localY = clientY - rect.top - view.ty;
    return { x: localX / view.scale / UNITS_PER_INCH, y: localY / view.scale / UNITS_PER_INCH };
  }

  function snap(n: number): number {
    if (!snapInches) return n;
    return Math.round(n / snapInches) * snapInches;
  }

  // --- Mouse handlers ----------------------------------------------------
  function onMouseDown(e: React.MouseEvent) {
    if ((e.target as Element).closest("[data-item]")) return; // item handler will fire
    const inches = clientToMapInches(e.clientX, e.clientY);
    if (tool === "ruler") {
      setDrag({ kind: "ruler", startX: inches.x, startY: inches.y, endX: inches.x, endY: inches.y });
      onSelect(null);
      e.preventDefault();
    } else if (tool === "pan" || e.button === 1 || e.shiftKey) {
      setDrag({ kind: "pan", startClientX: e.clientX, startClientY: e.clientY, startTx: view.tx, startTy: view.ty });
      e.preventDefault();
    } else {
      onSelect(null); // clicked empty board
    }
  }

  function onItemMouseDown(e: React.MouseEvent, item: Token | Terrain, itemType: "token" | "terrain") {
    if (tool === "ruler" || tool === "pan") return;
    e.stopPropagation();
    onSelect(item.id);
    const inches = clientToMapInches(e.clientX, e.clientY);
    setDrag({ kind: "item", itemId: item.id, itemType, offsetX: inches.x - item.x, offsetY: inches.y - item.y });
  }

  function onMouseMove(e: React.MouseEvent) {
    if (drag.kind === "none") return;
    if (drag.kind === "pan") {
      setView({ ...view, tx: drag.startTx + (e.clientX - drag.startClientX), ty: drag.startTy + (e.clientY - drag.startClientY) });
    } else if (drag.kind === "ruler") {
      const inches = clientToMapInches(e.clientX, e.clientY);
      setDrag({ ...drag, endX: inches.x, endY: inches.y });
    } else if (drag.kind === "item") {
      const inches = clientToMapInches(e.clientX, e.clientY);
      const nx = snap(inches.x - drag.offsetX);
      const ny = snap(inches.y - drag.offsetY);
      if (drag.itemType === "token") {
        onState({ ...state, tokens: state.tokens.map((t) => t.id === drag.itemId ? { ...t, x: nx, y: ny } : t) });
      } else {
        onState({ ...state, terrain: state.terrain.map((t) => t.id === drag.itemId ? { ...t, x: nx, y: ny } : t) });
      }
    }
  }

  function onMouseUp() {
    if (drag.kind === "ruler") {
      // Keep the ruler displayed after release until next click — let user
      // read the measurement. Convert to a transient "measurement" by
      // leaving the state as-is: the next mousedown clears it.
      return;
    }
    setDrag({ kind: "none" });
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const wrap = wrapRef.current!;
    const rect = wrap.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.001);
    const newScale = Math.max(0.2, Math.min(8, view.scale * factor));
    // Zoom around the cursor position.
    const k = newScale / view.scale;
    setView({ scale: newScale, tx: cx - (cx - view.tx) * k, ty: cy - (cy - view.ty) * k });
  }

  // --- Touch handlers (single-finger drag/pan, two-finger pinch) ---------
  const touchRef = useRef<{
    mode: "single" | "pinch" | null;
    startDist?: number;
    startScale?: number;
    startMid?: { x: number; y: number };
    startView?: { tx: number; ty: number };
  }>({ mode: null });

  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const t0 = e.touches[0]!, t1 = e.touches[1]!;
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const wrap = wrapRef.current!;
      const rect = wrap.getBoundingClientRect();
      const mid = { x: (t0.clientX + t1.clientX) / 2 - rect.left, y: (t0.clientY + t1.clientY) / 2 - rect.top };
      touchRef.current = { mode: "pinch", startDist: dist, startScale: view.scale, startMid: mid, startView: { tx: view.tx, ty: view.ty } };
    }
  }

  function onTouchMove(e: React.TouchEvent) {
    if (touchRef.current.mode === "pinch" && e.touches.length === 2) {
      e.preventDefault();
      const t0 = e.touches[0]!, t1 = e.touches[1]!;
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const startDist = touchRef.current.startDist!;
      const startScale = touchRef.current.startScale!;
      const mid = touchRef.current.startMid!;
      const sv = touchRef.current.startView!;
      const newScale = Math.max(0.2, Math.min(8, startScale * (dist / startDist)));
      const k = newScale / startScale;
      setView({ scale: newScale, tx: mid.x - (mid.x - sv.tx) * k, ty: mid.y - (mid.y - sv.ty) * k });
    }
  }

  function onTouchEnd() { touchRef.current = { mode: null }; }

  // --- HTML5 drag-drop (drag a roster row onto the board) ----------------
  function onDragOver(e: React.DragEvent) {
    if (!onDropPayload) return;
    if (e.dataTransfer.types.includes("application/x-legion-token")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }

  function onDrop(e: React.DragEvent) {
    if (!onDropPayload) return;
    const payload = e.dataTransfer.getData("application/x-legion-token");
    if (!payload) return;
    e.preventDefault();
    const at = clientToMapInches(e.clientX, e.clientY);
    onDropPayload(payload, { x: snap(at.x), y: snap(at.y) });
  }

  // --- Geometry helpers --------------------------------------------------
  const mapW = state.map.widthInches * UNITS_PER_INCH;
  const mapH = state.map.heightInches * UNITS_PER_INCH;

  return (
    <div className="tt-canvas-wrap" ref={wrapRef}
         onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
         onWheel={onWheel}
         onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
         onDragOver={onDragOver} onDrop={onDrop}>
      <svg ref={svgRef}
           className="tt-svg"
           width="100%"
           height="100%"
           style={{ cursor: tool === "pan" ? "grab" : tool === "ruler" ? "crosshair" : "default" }}>
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          {/* Mat */}
          <rect x={0} y={0} width={mapW} height={mapH} fill="#1d2832" stroke="#3a4154" strokeWidth={1 / view.scale} />

          {/* Grid */}
          {showGrid && (
            <g stroke="#2a3a48" strokeWidth={1 / view.scale}>
              {Array.from({ length: state.map.widthInches + 1 }, (_, i) => (
                <line key={`vx${i}`} x1={i * UNITS_PER_INCH} y1={0} x2={i * UNITS_PER_INCH} y2={mapH} />
              ))}
              {Array.from({ length: state.map.heightInches + 1 }, (_, i) => (
                <line key={`hy${i}`} x1={0} y1={i * UNITS_PER_INCH} x2={mapW} y2={i * UNITS_PER_INCH} />
              ))}
            </g>
          )}

          {/* Range bands from selected token (visual aid for measurement) */}
          {selectedId && state.tokens.find((t) => t.id === selectedId) && (() => {
            const tk = state.tokens.find((t) => t.id === selectedId)!;
            const cx = (tk.x + tk.size / 2) * UNITS_PER_INCH;
            const cy = (tk.y + tk.size / 2) * UNITS_PER_INCH;
            return (
              <g fill="none" stroke="#ffd24a" strokeOpacity={0.18} strokeDasharray={`${4 / view.scale} ${4 / view.scale}`} strokeWidth={1 / view.scale}>
                {[6, 12, 18, 24].map((inches) => (
                  <circle key={inches} cx={cx} cy={cy} r={inches * UNITS_PER_INCH} />
                ))}
              </g>
            );
          })()}

          {/* Terrain */}
          {state.terrain.map((t) => (
            <g key={t.id}
               data-item="terrain"
               transform={`translate(${t.x * UNITS_PER_INCH} ${t.y * UNITS_PER_INCH}) rotate(${t.rotation})`}
               onMouseDown={(e) => onItemMouseDown(e, t, "terrain")}
               style={{ cursor: "move" }}>
              {t.shape === "rect" ? (
                <rect x={0} y={0} width={t.width * UNITS_PER_INCH} height={t.height * UNITS_PER_INCH}
                      fill={TERRAIN_FILL[t.kind]} stroke={selectedId === t.id ? "#ffd24a" : TERRAIN_STROKE[t.kind]}
                      strokeWidth={(selectedId === t.id ? 2 : 1) / view.scale} fillOpacity={0.7} />
              ) : (
                <circle cx={(t.width / 2) * UNITS_PER_INCH} cy={(t.width / 2) * UNITS_PER_INCH} r={(t.width / 2) * UNITS_PER_INCH}
                        fill={TERRAIN_FILL[t.kind]} stroke={selectedId === t.id ? "#ffd24a" : TERRAIN_STROKE[t.kind]}
                        strokeWidth={(selectedId === t.id ? 2 : 1) / view.scale} fillOpacity={0.7} />
              )}
              <text x={2} y={10 / view.scale + 2} fontSize={10 / view.scale} fill="#d8dde6" fillOpacity={0.85}>{t.label}</text>
            </g>
          ))}

          {/* Token portrait clip paths — one per token with a portrait */}
          <defs>
            {state.tokens.filter((t) => t.portraitUrl).map((tk) => {
              const px = tk.x * UNITS_PER_INCH;
              const py = tk.y * UNITS_PER_INCH;
              const sz = tk.size * UNITS_PER_INCH;
              return (
                <clipPath key={tk.id} id={`tt-clip-${tk.id}`} clipPathUnits="userSpaceOnUse">
                  <circle cx={px + sz / 2} cy={py + sz / 2} r={sz / 2 - 1.5 / view.scale} />
                </clipPath>
              );
            })}
          </defs>

          {/* Tokens */}
          {state.tokens.map((tk) => {
            const px = tk.x * UNITS_PER_INCH;
            const py = tk.y * UNITS_PER_INCH;
            const sz = tk.size * UNITS_PER_INCH;
            const hasPortrait = !!tk.portraitUrl;
            return (
              <g key={tk.id} data-item="token"
                 onMouseDown={(e) => onItemMouseDown(e, tk, "token")}
                 style={{ cursor: "grab" }}>
                {/* Ring colored by faction; thicker when selected. */}
                <circle cx={px + sz / 2} cy={py + sz / 2} r={sz / 2 - 1 / view.scale}
                        fill={hasPortrait ? "#0e0f12" : FACTION_FILL[tk.color]}
                        stroke={selectedId === tk.id ? "#ffd24a" : FACTION_STROKE[tk.color]}
                        strokeWidth={(selectedId === tk.id ? 2.5 : 1.5) / view.scale} />
                {hasPortrait && (
                  // Show the unit's card image cropped to a circle. Slice-fit
                  // anchored to the top so the portrait/art area (always at
                  // the top of a Legion card) is what appears in the token.
                  <image href={tk.portraitUrl}
                         x={px} y={py} width={sz} height={sz}
                         preserveAspectRatio="xMidYMin slice"
                         clipPath={`url(#tt-clip-${tk.id})`}
                         pointerEvents="none" />
                )}
                {!hasPortrait && (
                  <text x={px + sz / 2} y={py + sz / 2 + 4 / view.scale}
                        textAnchor="middle" fontSize={10 / view.scale}
                        fill="#0e0f12" fontWeight={700}>{tk.label.slice(0, 3)}</text>
                )}
                {tk.badge && (
                  <g>
                    <circle cx={px + sz - 2 / view.scale} cy={py + 2 / view.scale} r={5 / view.scale} fill="#0e0f12" stroke="#ffd24a" strokeWidth={1 / view.scale} />
                    <text x={px + sz - 2 / view.scale} y={py + 5 / view.scale} textAnchor="middle" fontSize={7 / view.scale} fill="#ffd24a" fontWeight={700}>{tk.badge}</text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Ruler */}
          {drag.kind === "ruler" && (() => {
            const x1 = drag.startX * UNITS_PER_INCH;
            const y1 = drag.startY * UNITS_PER_INCH;
            const x2 = drag.endX * UNITS_PER_INCH;
            const y2 = drag.endY * UNITS_PER_INCH;
            const inches = Math.hypot(drag.endX - drag.startX, drag.endY - drag.startY);
            const range = inches <= 6 ? 1 : inches <= 12 ? 2 : inches <= 18 ? 3 : inches <= 24 ? 4 : 5;
            return (
              <g>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ffd24a" strokeWidth={2 / view.scale} />
                <circle cx={x1} cy={y1} r={3 / view.scale} fill="#ffd24a" />
                <circle cx={x2} cy={y2} r={3 / view.scale} fill="#ffd24a" />
                <rect x={(x1 + x2) / 2 - 30 / view.scale} y={(y1 + y2) / 2 - 22 / view.scale}
                      width={60 / view.scale} height={18 / view.scale}
                      rx={3 / view.scale} fill="#0e0f12" stroke="#ffd24a" strokeWidth={1 / view.scale} />
                <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 9 / view.scale}
                      textAnchor="middle" fontSize={11 / view.scale} fill="#ffd24a" fontWeight={700}>
                  {inches.toFixed(1)}" · range {range}
                </text>
              </g>
            );
          })()}
        </g>
      </svg>

      <div className="tt-overlay-info">
        {state.map.widthInches}" × {state.map.heightInches}" · zoom {(view.scale * 100).toFixed(0)}% · {state.tokens.length} tokens · {state.terrain.length} terrain
        <button className="tt-fit-btn" onClick={fitToView} title="Fit to view">⤢</button>
      </div>
    </div>
  );
}

