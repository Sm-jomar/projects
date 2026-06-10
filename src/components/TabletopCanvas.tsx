import { useEffect, useRef, useState } from "react";
import type { TabletopState, Token, Terrain, FactionColor } from "../lib/tabletop";
import { deploymentZones } from "../lib/tabletop";

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
  /** Called once at the start of an item drag — the parent uses this to
   * snapshot state for undo before the flood of transient onState calls. */
  onDragStart?: () => void;
  /** Double-click/double-tap on a token toggles its activated flag. */
  onToggleActivated?: (tokenId: string) => void;
};

export function TabletopCanvas({
  state, onState, tool, snapInches, showGrid, selectedId, onSelect,
  onDropPayload, onDragStart, onToggleActivated,
}: Props) {
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

  // --- Pointer handlers (mouse + touch + pen, unified) --------------------
  // Pointer events replace the old mouse-only handlers so single-finger
  // token drags work on phones. Two-finger pinch zoom is still handled by
  // the touch handlers below, which set pinch mode; pointer handlers bail
  // out while a pinch is in progress.
  const touchRef = useRef<{
    mode: "pinch" | null;
    startDist?: number;
    startScale?: number;
    startMid?: { x: number; y: number };
    startView?: { tx: number; ty: number };
  }>({ mode: null });

  function onPointerDown(e: React.PointerEvent) {
    if (touchRef.current.mode === "pinch") return;
    if ((e.target as Element).closest("[data-item]")) return; // item handler will fire
    wrapRef.current?.setPointerCapture(e.pointerId);
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
      setDrag({ kind: "none" });
    }
  }

  function onItemPointerDown(e: React.PointerEvent, item: Token | Terrain, itemType: "token" | "terrain") {
    if (tool === "ruler" || tool === "pan") return;
    if (touchRef.current.mode === "pinch") return;
    e.stopPropagation();
    wrapRef.current?.setPointerCapture(e.pointerId);
    onSelect(item.id);
    onDragStart?.();
    const inches = clientToMapInches(e.clientX, e.clientY);
    setDrag({ kind: "item", itemId: item.id, itemType, offsetX: inches.x - item.x, offsetY: inches.y - item.y });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (touchRef.current.mode === "pinch") return;
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

  function onPointerUp() {
    if (drag.kind === "ruler") {
      // Keep the ruler displayed after release so the measurement can be
      // read; the next pointerdown replaces it.
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

  // --- Two-finger pinch zoom ----------------------------------------------
  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      // A second finger landed: cancel any in-progress single-finger drag
      // so the piece doesn't fly around while pinching.
      setDrag({ kind: "none" });
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

  function onTouchEnd(e: React.TouchEvent) {
    if (e.touches.length < 2) touchRef.current = { mode: null };
  }

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
         onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
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

          {/* Deployment zones (under everything else) */}
          {state.deployment && (() => {
            const z = deploymentZones(state.deployment, state.map);
            const U = UNITS_PER_INCH;
            const dash = `${5 / view.scale} ${4 / view.scale}`;
            return (
              <g>
                <rect x={z.blue.x * U} y={z.blue.y * U} width={z.blue.w * U} height={z.blue.h * U}
                      fill="#3a78c2" fillOpacity={0.12} stroke="#5a9ae2" strokeOpacity={0.5}
                      strokeDasharray={dash} strokeWidth={1.5 / view.scale} />
                <text x={(z.blue.x + 0.5) * U} y={(z.blue.y + 1.2) * U} fontSize={12 / view.scale}
                      fill="#9bc1ec" fillOpacity={0.7} fontWeight={700}>BLUE</text>
                <rect x={z.red.x * U} y={z.red.y * U} width={z.red.w * U} height={z.red.h * U}
                      fill="#c24a3a" fillOpacity={0.12} stroke="#e2735a" strokeOpacity={0.5}
                      strokeDasharray={dash} strokeWidth={1.5 / view.scale} />
                <text x={(z.red.x + 0.5) * U} y={(z.red.y + 1.2) * U} fontSize={12 / view.scale}
                      fill="#ffb0a0" fillOpacity={0.7} fontWeight={700}>RED</text>
              </g>
            );
          })()}

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
               onPointerDown={(e) => onItemPointerDown(e, t, "terrain")}
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
            const cx = px + sz / 2;
            const cy = py + sz / 2;
            const hasPortrait = !!tk.portraitUrl;
            const badgeR = 5 / view.scale;
            const badgeFont = 7 / view.scale;
            return (
              <g key={tk.id} data-item="token"
                 onPointerDown={(e) => onItemPointerDown(e, tk, "token")}
                 onDoubleClick={(e) => { e.stopPropagation(); onToggleActivated?.(tk.id); }}
                 style={{ cursor: "grab" }}>
                {/* Body dims once activated; badges stay full-opacity. */}
                <g opacity={tk.activated ? 0.45 : 1}>
                  <circle cx={cx} cy={cy} r={sz / 2 - 1 / view.scale}
                          fill={hasPortrait ? "#0e0f12" : FACTION_FILL[tk.color]}
                          stroke={selectedId === tk.id ? "#ffd24a" : FACTION_STROKE[tk.color]}
                          strokeWidth={(selectedId === tk.id ? 2.5 : 1.5) / view.scale} />
                  {hasPortrait && (
                    // Card art cropped to a circle. Slice-fit anchored to the
                    // top so the portrait area of the card is what shows.
                    <image href={tk.portraitUrl}
                           x={px} y={py} width={sz} height={sz}
                           preserveAspectRatio="xMidYMin slice"
                           clipPath={`url(#tt-clip-${tk.id})`}
                           pointerEvents="none" />
                  )}
                  {!hasPortrait && (
                    <text x={cx} y={cy + 4 / view.scale}
                          textAnchor="middle" fontSize={10 / view.scale}
                          fill="#0e0f12" fontWeight={700}>{tk.label.slice(0, 3)}</text>
                  )}
                  {/* Facing arrow (vehicles / anything with rotation set) */}
                  {tk.rotation != null && (() => {
                    const a = (tk.rotation * Math.PI) / 180;
                    const r = sz / 2 - 1 / view.scale;
                    const tipX = cx + r * Math.sin(a);
                    const tipY = cy - r * Math.cos(a);
                    return (
                      <g stroke="#ffd24a" strokeWidth={2 / view.scale}>
                        <line x1={cx} y1={cy} x2={tipX} y2={tipY} />
                        <circle cx={tipX} cy={tipY} r={2.5 / view.scale} fill="#ffd24a" stroke="none" />
                      </g>
                    );
                  })()}
                </g>

                {/* Activated check */}
                {tk.activated && (
                  <text x={px + 3 / view.scale} y={py + 9 / view.scale}
                        fontSize={9 / view.scale} fill="#9be29b" fontWeight={700}>✓</text>
                )}
                {/* Custom badge (top-right) */}
                {tk.badge && (
                  <g>
                    <circle cx={px + sz - 2 / view.scale} cy={py + 2 / view.scale} r={badgeR} fill="#0e0f12" stroke="#ffd24a" strokeWidth={1 / view.scale} />
                    <text x={px + sz - 2 / view.scale} y={py + 2 / view.scale + badgeFont * 0.4} textAnchor="middle" fontSize={badgeFont} fill="#ffd24a" fontWeight={700}>{tk.badge}</text>
                  </g>
                )}
                {/* Wounds (bottom-right, red) */}
                {(tk.wounds ?? 0) > 0 && (
                  <g>
                    <circle cx={px + sz - 2 / view.scale} cy={py + sz - 2 / view.scale} r={badgeR} fill="#5a1414" stroke="#ff6b6b" strokeWidth={1 / view.scale} />
                    <text x={px + sz - 2 / view.scale} y={py + sz - 2 / view.scale + badgeFont * 0.4} textAnchor="middle" fontSize={badgeFont} fill="#ffb0b0" fontWeight={700}>{tk.wounds}</text>
                  </g>
                )}
                {/* Suppression (bottom-left, orange) */}
                {(tk.suppression ?? 0) > 0 && (
                  <g>
                    <circle cx={px + 2 / view.scale} cy={py + sz - 2 / view.scale} r={badgeR} fill="#5a4214" stroke="#ffc24a" strokeWidth={1 / view.scale} />
                    <text x={px + 2 / view.scale} y={py + sz - 2 / view.scale + badgeFont * 0.4} textAnchor="middle" fontSize={badgeFont} fill="#ffe0a0" fontWeight={700}>{tk.suppression}</text>
                  </g>
                )}
                {/* Name label under the selected token */}
                {selectedId === tk.id && (
                  <text x={cx} y={py + sz + 11 / view.scale}
                        textAnchor="middle" fontSize={9 / view.scale}
                        fill="#ffd24a" fontWeight={600}
                        paintOrder="stroke" stroke="#0e0f12" strokeWidth={2.5 / view.scale}>
                    {tk.label}
                  </text>
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
