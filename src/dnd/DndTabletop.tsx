import { useEffect, useRef, useState } from "react";
import {
  newDndTabletop, loadDndTabletop, saveDndTabletop, downscaleImage,
  initiativeOrder, newId, TOKEN_COLORS,
  type DndTabletopState, type DndToken,
} from "./dndTabletop";
import { listCharacters } from "./dndStorage";
import type { DndCharacter } from "./dndTypes";

const U = 48; // SVG units per grid cell

export function DndTabletop() {
  const [state, setState] = useState<DndTabletopState>(() => loadDndTabletop() ?? newDndTabletop());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chars] = useState<DndCharacter[]>(() => listCharacters());
  const [warn, setWarn] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Debounced persist; surfaces a warning if the map image blows the quota.
  useEffect(() => {
    const t = setTimeout(() => {
      const ok = saveDndTabletop(state);
      if (!ok) setWarn("Couldn't save locally — the map image may be too large. It still works this session.");
      else setWarn(null);
    }, 500);
    return () => clearTimeout(t);
  }, [state]);

  const selected = state.tokens.find((t) => t.id === selectedId) ?? null;
  const order = initiativeOrder(state.tokens);

  function patch(p: Partial<DndTabletopState>) { setState((s) => ({ ...s, ...p })); }
  function patchMap(p: Partial<DndTabletopState["map"]>) { setState((s) => ({ ...s, map: { ...s.map, ...p } })); }
  function updateToken(id: string, p: Partial<DndToken>) {
    setState((s) => ({ ...s, tokens: s.tokens.map((t) => (t.id === id ? { ...t, ...p } : t)) }));
  }
  function removeToken(id: string) {
    setState((s) => ({ ...s, tokens: s.tokens.filter((t) => t.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  }

  function addToken(partial: Partial<DndToken>) {
    const color = TOKEN_COLORS[state.tokens.length % TOKEN_COLORS.length]!;
    const tk: DndToken = {
      id: newId(),
      name: "Token",
      x: Math.round(state.map.cols / 2) - 0.5,
      y: Math.round(state.map.rows / 2) - 0.5,
      size: 1,
      color,
      kind: "monster",
      ...partial,
    };
    setState((s) => ({ ...s, tokens: [...s.tokens, tk] }));
    setSelectedId(tk.id);
  }

  function addFromCharacter(charId: string) {
    const c = chars.find((x) => x.id === charId);
    if (!c) return;
    addToken({
      name: c.name || "PC",
      kind: "pc",
      charId: c.id,
      hpMax: c.hpMax || undefined,
      hpCurrent: (c.hpCurrent || c.hpMax) || undefined,
      color: "#4a86c8",
    });
  }

  async function onMapFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const dataUrl = await downscaleImage(f);
      patchMap({ imageUrl: dataUrl });
    } catch {
      setWarn("Could not read that image.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function nextTurn() {
    if (order.length === 0) return;
    const i = order.findIndex((t) => t.id === state.activeTokenId);
    if (i === -1) { patch({ activeTokenId: order[0]!.id }); return; }
    const ni = (i + 1) % order.length;
    patch({
      activeTokenId: order[ni]!.id,
      round: ni === 0 ? state.round + 1 : state.round,
    });
  }

  return (
    <div className="dnd-section dnd-tabletop">
      <div className="dnd-section-head">
        <h2>Tabletop</h2>
        {warn && <span className="dnd-tt-warn small">{warn}</span>}
      </div>

      <div className="dnd-tt-body">
        <DungeonCanvas
          state={state}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onMoveToken={(id, x, y) => updateToken(id, { x, y })}
        />

        <aside className="dnd-tt-side">
          <section>
            <h3>Map</h3>
            <div className="dnd-tt-row">
              <button onClick={() => fileRef.current?.click()}>Upload image</button>
              <button className="ghost-btn" onClick={() => patchMap({ imageUrl: null })} disabled={!state.map.imageUrl}>Clear</button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onMapFile} />
            </div>
            <label className="dnd-tt-field">Or paste image URL
              <input value={state.map.imageUrl && state.map.imageUrl.startsWith("http") ? state.map.imageUrl : ""}
                     placeholder="https://…"
                     onChange={(e) => patchMap({ imageUrl: e.target.value || null })} />
            </label>
            <div className="dnd-tt-grid2">
              <label className="dnd-tt-field">Columns
                <input type="number" min={4} max={80} value={state.map.cols}
                       onChange={(e) => patchMap({ cols: Math.max(1, Number(e.target.value) || 1) })} />
              </label>
              <label className="dnd-tt-field">Rows
                <input type="number" min={4} max={80} value={state.map.rows}
                       onChange={(e) => patchMap({ rows: Math.max(1, Number(e.target.value) || 1) })} />
              </label>
            </div>
            <label className="dnd-tt-check">
              <input type="checkbox" checked={state.map.showGrid} onChange={(e) => patchMap({ showGrid: e.target.checked })} />
              Show grid
            </label>
          </section>

          <section>
            <h3>Add tokens</h3>
            <label className="dnd-tt-field">From a character sheet
              <select value="" onChange={(e) => { if (e.target.value) { addFromCharacter(e.target.value); e.target.value = ""; } }}>
                <option value="">Choose character…</option>
                {chars.map((c) => <option key={c.id} value={c.id}>{c.name || "Unnamed"} {c.className ? `(${c.className})` : ""}</option>)}
              </select>
            </label>
            <div className="dnd-tt-row">
              <button onClick={() => addToken({ name: "Monster", kind: "monster", color: "#c84a4a" })}>+ Monster</button>
              <button onClick={() => addToken({ name: "Marker", kind: "marker", size: 1, color: "#c8a34a" })}>+ Marker</button>
            </div>
            {chars.length === 0 && <p className="muted small">No saved characters yet — build one in Character Sheets.</p>}
          </section>

          {selected && (
            <section className="dnd-tt-edit">
              <h3>Token</h3>
              <label className="dnd-tt-field">Name
                <input value={selected.name} onChange={(e) => updateToken(selected.id, { name: e.target.value })} />
              </label>
              <div className="dnd-tt-grid2">
                <label className="dnd-tt-field">Color
                  <input type="color" value={selected.color} onChange={(e) => updateToken(selected.id, { color: e.target.value })} />
                </label>
                <label className="dnd-tt-field">Size
                  <select value={selected.size} onChange={(e) => updateToken(selected.id, { size: Number(e.target.value) })}>
                    <option value={1}>Medium (1)</option>
                    <option value={2}>Large (2)</option>
                    <option value={3}>Huge (3)</option>
                    <option value={4}>Gargantuan (4)</option>
                  </select>
                </label>
              </div>
              <div className="dnd-tt-grid2">
                <label className="dnd-tt-field">HP current
                  <input type="number" value={selected.hpCurrent ?? ""} onChange={(e) => updateToken(selected.id, { hpCurrent: e.target.value === "" ? undefined : Number(e.target.value) })} />
                </label>
                <label className="dnd-tt-field">HP max
                  <input type="number" value={selected.hpMax ?? ""} onChange={(e) => updateToken(selected.id, { hpMax: e.target.value === "" ? undefined : Number(e.target.value) })} />
                </label>
              </div>
              <label className="dnd-tt-field">Initiative
                <input type="number" value={selected.initiative ?? ""} onChange={(e) => updateToken(selected.id, { initiative: e.target.value === "" ? undefined : Number(e.target.value) })} />
              </label>
              <button className="danger" onClick={() => removeToken(selected.id)}>Remove token</button>
            </section>
          )}

          <section>
            <div className="dnd-tt-init-head">
              <h3>Initiative</h3>
              <span className="muted small">Round {state.round}</span>
            </div>
            {order.length === 0 ? (
              <p className="muted small">Give tokens an initiative value to build the order.</p>
            ) : (
              <>
                <ol className="dnd-tt-init">
                  {order.map((t) => (
                    <li key={t.id}
                        className={"dnd-tt-init-row" + (t.id === state.activeTokenId ? " active" : "") + (t.id === selectedId ? " sel" : "")}
                        onClick={() => setSelectedId(t.id)}>
                      <span className="dnd-tt-init-num">{t.initiative}</span>
                      <span className="dnd-tt-init-dot" style={{ background: t.color }} />
                      <span className="dnd-tt-init-name">{t.name}</span>
                      {t.hpMax != null && <span className="muted small">{t.hpCurrent ?? t.hpMax}/{t.hpMax}</span>}
                    </li>
                  ))}
                </ol>
                <button className="dnd-primary" onClick={nextTurn}>Next turn ▸</button>
              </>
            )}
          </section>

          <section>
            <h3>Board</h3>
            <button className="danger" onClick={() => { if (confirm("Remove all tokens?")) patch({ tokens: [], activeTokenId: null }); }}>Clear tokens</button>
          </section>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

type DragState =
  | { kind: "none" }
  | { kind: "token"; id: string; offX: number; offY: number }
  | { kind: "pan"; sx: number; sy: number; tx: number; ty: number };

function DungeonCanvas({ state, selectedId, onSelect, onMoveToken }: {
  state: DndTabletopState;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMoveToken: (id: string, x: number, y: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 });
  const [drag, setDrag] = useState<DragState>({ kind: "none" });
  const { cols, rows } = state.map;
  const W = cols * U, H = rows * U;

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    fit();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, rows]);

  function fit() {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const pad = 16;
    const s = Math.min((wrap.clientWidth - pad * 2) / W, (wrap.clientHeight - pad * 2) / H);
    if (!isFinite(s) || s <= 0) return;
    setView({ tx: (wrap.clientWidth - W * s) / 2, ty: (wrap.clientHeight - H * s) / 2, scale: s });
  }

  function toCell(clientX: number, clientY: number) {
    const r = wrapRef.current!.getBoundingClientRect();
    const x = (clientX - r.left - view.tx) / view.scale / U;
    const y = (clientY - r.top - view.ty) / view.scale / U;
    return { x, y };
  }

  function onPointerDown(e: React.PointerEvent) {
    const el = (e.target as Element).closest("[data-token]");
    if (el) {
      const id = el.getAttribute("data-token")!;
      const tk = state.tokens.find((t) => t.id === id);
      if (!tk) return;
      onSelect(id);
      wrapRef.current?.setPointerCapture(e.pointerId);
      const c = toCell(e.clientX, e.clientY);
      setDrag({ kind: "token", id, offX: c.x - tk.x, offY: c.y - tk.y });
    } else {
      onSelect(null);
      wrapRef.current?.setPointerCapture(e.pointerId);
      setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty });
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (drag.kind === "pan") {
      setView({ ...view, tx: drag.tx + (e.clientX - drag.sx), ty: drag.ty + (e.clientY - drag.sy) });
    } else if (drag.kind === "token") {
      const c = toCell(e.clientX, e.clientY);
      // snap to half-cell
      const nx = Math.round((c.x - drag.offX) * 2) / 2;
      const ny = Math.round((c.y - drag.offY) * 2) / 2;
      onMoveToken(drag.id, nx, ny);
    }
  }
  function onPointerUp() { setDrag({ kind: "none" }); }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const r = wrapRef.current!.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    const ns = Math.max(0.15, Math.min(6, view.scale * Math.exp(-e.deltaY * 0.001)));
    const k = ns / view.scale;
    setView({ scale: ns, tx: cx - (cx - view.tx) * k, ty: cy - (cy - view.ty) * k });
  }

  return (
    <div className="dnd-tt-canvas" ref={wrapRef}
         onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
         onWheel={onWheel}>
      <svg width="100%" height="100%">
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          <rect x={0} y={0} width={W} height={H} fill="#12151b" stroke="#2a2f3c" strokeWidth={1 / view.scale} />
          {state.map.imageUrl && (
            <image href={state.map.imageUrl} x={0} y={0} width={W} height={H}
                   preserveAspectRatio="none" />
          )}
          {state.map.showGrid && (
            <g stroke="#000" strokeOpacity={state.map.gridOpacity} strokeWidth={1 / view.scale}>
              {Array.from({ length: cols + 1 }, (_, i) => (
                <line key={"v" + i} x1={i * U} y1={0} x2={i * U} y2={H} />
              ))}
              {Array.from({ length: rows + 1 }, (_, i) => (
                <line key={"h" + i} x1={0} y1={i * U} x2={W} y2={i * U} />
              ))}
            </g>
          )}
          {state.tokens.map((t) => {
            const cx = (t.x + t.size / 2) * U;
            const cy = (t.y + t.size / 2) * U;
            const r = (t.size * U) / 2 - 2;
            const active = t.id === state.activeTokenId;
            const sel = t.id === selectedId;
            const hpFrac = t.hpMax ? Math.max(0, Math.min(1, (t.hpCurrent ?? t.hpMax) / t.hpMax)) : null;
            return (
              <g key={t.id} data-token={t.id} style={{ cursor: "grab" }}>
                {active && <circle cx={cx} cy={cy} r={r + 4 / view.scale} fill="none" stroke="#ffd24a" strokeWidth={3 / view.scale} />}
                <circle cx={cx} cy={cy} r={r} fill={t.color}
                        stroke={sel ? "#fff" : "#0009"} strokeWidth={(sel ? 3 : 1.5) / view.scale} />
                <text x={cx} y={cy + 5} textAnchor="middle" fontSize={Math.min(18, t.size * 14)} fontWeight={700} fill="#fff" pointerEvents="none">
                  {initials(t.name)}
                </text>
                {hpFrac != null && (
                  <g pointerEvents="none">
                    <rect x={cx - r} y={cy + r - 6} width={2 * r} height={5} rx={2} fill="#000a" />
                    <rect x={cx - r} y={cy + r - 6} width={2 * r * hpFrac} height={5} rx={2}
                          fill={hpFrac > 0.5 ? "#4ac86a" : hpFrac > 0.25 ? "#c8a34a" : "#c84a4a"} />
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="dnd-tt-overlay small muted">
        {cols}×{rows} · {state.tokens.length} tokens · zoom {(view.scale * 100).toFixed(0)}%
        <button className="ghost-btn small" onClick={fit} title="Fit to view">⤢</button>
      </div>
    </div>
  );
}
