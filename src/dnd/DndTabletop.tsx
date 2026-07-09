import { useEffect, useRef, useState } from "react";
import {
  newDndTabletop, loadDndTabletop, saveDndTabletop, downscaleImage,
  initiativeOrder, newId, TOKEN_COLORS, diffDnd,
  type DndTabletopState, type DndToken,
} from "./dndTabletop";
import { listCharacters } from "./dndStorage";
import type { DndCharacter } from "./dndTypes";
import { RoomClient, generateRoomCode, type ConnStatus, type Peer, type RoomHandlers } from "../lib/roomClient";
import { dndPlayUrl } from "../lib/appRouting";
import { appendLog, type LogActor, type LogEntry } from "../lib/auditLog";
import { AuditLogView } from "../components/AuditLogView";

const U = 48; // SVG units per grid cell
const NAME_KEY = "dnd.playername";
const COLOR_KEY = "dnd.playercolor";
const DEFAULT_COLOR = "#4a86c8";

type OnlineState = { status: ConnStatus; code: string; you: Peer | null; peers: Peer[]; error?: string };

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

  // --- Multiplayer (shares the Legion Durable Object room server) ----------
  const hasRoomParam = new URLSearchParams(location.search).has("room");
  const [online, setOnline] = useState<OnlineState | null>(null);
  const [onlineOpen, setOnlineOpen] = useState(hasRoomParam);
  const [joinCode, setJoinCode] = useState(() => new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "");
  const [playerName, setPlayerName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [playerColor, setPlayerColor] = useState(() => localStorage.getItem(COLOR_KEY) ?? DEFAULT_COLOR);
  const [spectator, setSpectator] = useState(false);
  const roomRef = useRef<RoomClient<DndTabletopState> | null>(null);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const remoteEchoRef = useRef<string | null>(null);
  const readOnlyRef = useRef(false);

  const readOnly = online?.status === "open" && online.you?.color === "spectator";
  useEffect(() => { readOnlyRef.current = !!readOnly; }, [readOnly]);

  // --- Audit log + ghost replay --------------------------------------------
  // The current actor stamped onto locally-generated log entries.
  const actor: LogActor = online?.status === "open" && online.you
    ? { name: online.you.name, color: online.you.color === "spectator" ? "#8b94a8" : online.you.color }
    : { name: playerName.trim() || "You", color: playerColor };
  const actorRef = useRef(actor);
  useEffect(() => { actorRef.current = actor; });
  // Previous board (for diffing) + the JSON of the last remotely-applied
  // state (so remote updates aren't re-logged locally).
  const prevRef = useRef(state);
  const appliedRemoteRef = useRef<string | null>(null);
  const diffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ghost, setGhost] = useState<LogEntry["move"] | null>(null);
  const ghostTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showGhost(m: LogEntry["move"]) {
    if (!m) return;
    setGhost(m);
    if (ghostTimer.current) clearTimeout(ghostTimer.current);
    ghostTimer.current = setTimeout(() => setGhost(null), 5000);
  }

  // Generate log entries by diffing local changes. Debounced so a drag
  // (which updates state every frame) logs one move on settle, not dozens.
  // Remote applications set prevRef without logging (the actor's own client
  // already logged them).
  useEffect(() => {
    const curJson = JSON.stringify(state);
    if (appliedRemoteRef.current === curJson) { prevRef.current = state; return; }
    if (diffTimer.current) clearTimeout(diffTimer.current);
    diffTimer.current = setTimeout(() => {
      const prev = prevRef.current;
      prevRef.current = state;
      const entries = diffDnd(prev, state, actorRef.current);
      if (entries.length) setState((s) => ({ ...s, log: appendLog(s.log, entries) }));
    }, 350);
  }, [state]);

  function buildHandlers(): RoomHandlers<DndTabletopState> {
    return {
      onStatus: (status, detail) => setOnline((o) => (o ? { ...o, status, error: detail } : o)),
      onDenied: () => setOnline((o) => (o ? { ...o, status: "error", error: "That code belongs to a Legion game. Use a different code." } : o)),
      onWelcome: (you, remoteState, peers) => {
        setOnline({ status: "open", code: roomRef.current?.code ?? "", you, peers });
        if (remoteState) {
          const js = JSON.stringify(remoteState);
          remoteEchoRef.current = js;
          appliedRemoteRef.current = js;
          setState(remoteState);
        } else {
          remoteEchoRef.current = JSON.stringify(stateRef.current);
          roomRef.current?.sendState(stateRef.current);
        }
      },
      onState: (remoteState) => {
        const js = JSON.stringify(remoteState);
        remoteEchoRef.current = js;
        appliedRemoteRef.current = js;
        setState(remoteState);
      },
      onPresence: (peers) => setOnline((o) => {
        if (!o) return o;
        const you = o.you ? peers.find((p) => p.id === o.you!.id) ?? o.you : o.you;
        return { ...o, peers, you };
      }),
    };
  }

  function startRoom(code: string) {
    const name = playerName.trim() || "Player";
    localStorage.setItem(NAME_KEY, name);
    localStorage.setItem(COLOR_KEY, playerColor);
    roomRef.current?.close();
    remoteEchoRef.current = null;
    const identity = spectator ? "spectator" : playerColor;
    const client = new RoomClient<DndTabletopState>(code, name, identity, buildHandlers(), "dnd");
    roomRef.current = client;
    setOnline({ status: "connecting", code: client.code, you: null, peers: [] });
    client.connect();
  }
  function hostRoom() { if (playerName.trim()) startRoom(generateRoomCode()); }
  function joinRoom() { const c = joinCode.trim().toUpperCase(); if (c.length >= 4 && playerName.trim()) startRoom(c); }
  function changeIdentity(spec: boolean, color: string) {
    setSpectator(spec);
    setPlayerColor(color);
    localStorage.setItem(COLOR_KEY, color);
    roomRef.current?.setColor(spec ? "spectator" : color);
  }
  function leaveRoom() { roomRef.current?.close(); roomRef.current = null; remoteEchoRef.current = null; setOnline(null); }

  // Push local changes to the room (skipped for spectators; the server
  // ignores them anyway).
  useEffect(() => {
    const client = roomRef.current;
    if (!client || online?.status !== "open" || readOnly) return;
    const js = JSON.stringify(state);
    if (js === remoteEchoRef.current) return;
    remoteEchoRef.current = js;
    client.sendState(state);
  }, [state, online?.status, readOnly]);

  useEffect(() => () => roomRef.current?.close(), []);

  const selected = state.tokens.find((t) => t.id === selectedId) ?? null;
  const order = initiativeOrder(state.tokens);

  function patch(p: Partial<DndTabletopState>) { if (readOnlyRef.current) return; setState((s) => ({ ...s, ...p })); }
  function patchMap(p: Partial<DndTabletopState["map"]>) { if (readOnlyRef.current) return; setState((s) => ({ ...s, map: { ...s.map, ...p } })); }
  function updateToken(id: string, p: Partial<DndToken>) {
    if (readOnlyRef.current) return;
    setState((s) => ({ ...s, tokens: s.tokens.map((t) => (t.id === id ? { ...t, ...p } : t)) }));
  }
  function removeToken(id: string) {
    if (readOnlyRef.current) return;
    setState((s) => ({ ...s, tokens: s.tokens.filter((t) => t.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  }

  function addToken(partial: Partial<DndToken>) {
    if (readOnlyRef.current) return;
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
      // Smaller for multiplayer-friendliness — the map rides along in the
      // synced room state.
      const dataUrl = await downscaleImage(f, 1200, 0.72);
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
        <div className="dnd-mp-wrap">
          <button className={"dnd-mp-btn" + (online?.status === "open" ? " live" : "")}
                  onClick={() => setOnlineOpen((v) => !v)}>
            {online?.status === "open" ? `● ${online.code}` : online ? "● connecting…" : "Multiplayer"}
          </button>
          {onlineOpen && (
            <MultiplayerPanel
              online={online}
              joinCode={joinCode} onJoinCodeChange={setJoinCode}
              playerName={playerName} onNameChange={setPlayerName}
              playerColor={playerColor} spectator={spectator}
              onIdentityChange={changeIdentity}
              onHost={hostRoom} onJoin={joinRoom} onLeave={leaveRoom}
              onClosePanel={() => setOnlineOpen(false)}
            />
          )}
        </div>
      </div>

      {readOnly && (
        <div className="dnd-tt-spectating">👁 Spectating — you can watch, pan and zoom, but not change the board.</div>
      )}

      <div className="dnd-tt-body">
        <DungeonCanvas
          state={state}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onMoveToken={(id, x, y) => updateToken(id, { x, y })}
          ghost={ghost}
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
            <div className="dnd-tt-init-head">
              <h3>Log</h3>
              {(state.log?.length ?? 0) > 0 && (
                <button className="ghost-btn small" onClick={() => patch({ log: [] })} title="Clear the log">Clear</button>
              )}
            </div>
            <AuditLogView log={state.log} onReplay={showGhost} />
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

function DungeonCanvas({ state, selectedId, onSelect, onMoveToken, ghost }: {
  state: DndTabletopState;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMoveToken: (id: string, x: number, y: number) => void;
  ghost: LogEntry["move"] | null;
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

          {/* Ghost replay: the last move's origin, path and destination. */}
          {ghost && (() => {
            const sz = ghost.size ?? 1;
            const col = ghost.color ?? "#ffd24a";
            const fx = (ghost.from.x + sz / 2) * U, fy = (ghost.from.y + sz / 2) * U;
            const tx = (ghost.to.x + sz / 2) * U, ty = (ghost.to.y + sz / 2) * U;
            const r = (sz * U) / 2 - 2;
            return (
              <g pointerEvents="none" className="dnd-ghost">
                <circle cx={fx} cy={fy} r={r} fill={col} fillOpacity={0.25} stroke={col} strokeDasharray={`${5 / view.scale} ${4 / view.scale}`} strokeWidth={2 / view.scale} />
                <line x1={fx} y1={fy} x2={tx} y2={ty} stroke={col} strokeWidth={3 / view.scale} strokeDasharray={`${6 / view.scale} ${5 / view.scale}`} />
                <circle cx={tx} cy={ty} r={r + 3 / view.scale} fill="none" stroke={col} strokeWidth={3 / view.scale} />
              </g>
            );
          })()}
        </g>
      </svg>
      <div className="dnd-tt-overlay small muted">
        {cols}×{rows} · {state.tokens.length} tokens · zoom {(view.scale * 100).toFixed(0)}%
        <button className="ghost-btn small" onClick={fit} title="Fit to view">⤢</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const MP_ORIGIN = "https://wrangler.sm-af6.workers.dev";

function MultiplayerPanel(props: {
  online: OnlineState | null;
  joinCode: string; onJoinCodeChange: (v: string) => void;
  playerName: string; onNameChange: (v: string) => void;
  playerColor: string; spectator: boolean;
  onIdentityChange: (spectator: boolean, color: string) => void;
  onHost: () => void; onJoin: () => void; onLeave: () => void;
  onClosePanel: () => void;
}) {
  const {
    online, joinCode, onJoinCodeChange, playerName, onNameChange,
    playerColor, spectator, onIdentityChange, onHost, onJoin, onLeave, onClosePanel,
  } = props;
  const connected = online?.status === "open";
  const failed = online && (online.status === "error" || online.status === "closed");
  const nameOk = playerName.trim().length > 0;
  const amSpectator = online?.you?.color === "spectator";
  const myColor = amSpectator ? "#8b94a8" : (online?.you?.color ?? playerColor);

  const onPlaySite = (() => {
    try { return location.origin === new URL(MP_ORIGIN).origin; } catch { return false; }
  })();
  function openPlaySite() {
    const code = online?.code ?? new URLSearchParams(location.search).get("room") ?? "";
    window.open(dndPlayUrl(code || undefined), "_blank", "noopener");
  }
  const shareUrl = online?.code ? `${MP_ORIGIN}/?app=dnd&room=${online.code}` : "";
  function copy(t: string) { navigator.clipboard?.writeText(t).catch(() => {}); }

  return (
    <div className="dnd-mp-panel" onClick={(e) => e.stopPropagation()}>
      <div className="dnd-mp-head">
        <strong>Multiplayer</strong>
        <button className="ghost-btn small" onClick={onClosePanel}>×</button>
      </div>

      {!onPlaySite && (
        <div className="dnd-mp-site">
          <button className="dnd-primary" onClick={openPlaySite}>Open multiplayer site ↗</button>
          <p className="muted small">Remote play runs on the game server; this button opens it in a new tab (carrying your room code).</p>
        </div>
      )}

      {!online && (
        <>
          <p className="muted small">Share a live map with your table. One person hosts and shares the code; others join. Tokens, initiative, HP and the map stay in sync.</p>
          <label className="dnd-tt-field">Your name
            <input value={playerName} maxLength={24} autoFocus
                   onChange={(e) => onNameChange(e.target.value)}
                   onKeyDown={(e) => { if (e.key !== "Enter" || !nameOk) return; if (joinCode.trim().length >= 4) onJoin(); else onHost(); }} />
          </label>
          <div className="dnd-mp-identity">
            <label className="dnd-tt-field">Your color
              <input type="color" value={playerColor} disabled={spectator}
                     onChange={(e) => onIdentityChange(false, e.target.value)} />
            </label>
            <label className="dnd-tt-check">
              <input type="checkbox" checked={spectator}
                     onChange={(e) => onIdentityChange(e.target.checked, playerColor)} />
              Spectate (watch only)
            </label>
          </div>
          <button className="dnd-primary" onClick={onHost} disabled={!nameOk}>Host a new game</button>
          <div className="dnd-mp-join">
            <input placeholder="CODE" value={joinCode} maxLength={12}
                   onChange={(e) => onJoinCodeChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                   onKeyDown={(e) => { if (e.key === "Enter" && nameOk) onJoin(); }} />
            <button onClick={onJoin} disabled={joinCode.trim().length < 4 || !nameOk}>Join</button>
          </div>
          {!nameOk && <p className="muted small">Enter a name to host or join.</p>}
        </>
      )}

      {online && (
        <>
          <div className="dnd-mp-status">
            <span className={"dnd-mp-dot " + online.status} />
            <span>{connected ? "Connected" : online.status === "connecting" ? "Connecting…" : "Disconnected"}
              {connected && online.you && <> · <b style={{ color: myColor }}>{amSpectator ? "Spectator" : online.you.name}</b></>}
            </span>
          </div>

          {connected && (
            <div className="dnd-mp-identity">
              <label className="dnd-tt-field">Your color
                <input type="color" value={amSpectator ? "#8b94a8" : myColor} disabled={amSpectator}
                       onChange={(e) => onIdentityChange(false, e.target.value)} />
              </label>
              <label className="dnd-tt-check">
                <input type="checkbox" checked={amSpectator}
                       onChange={(e) => onIdentityChange(e.target.checked, playerColor)} />
                Spectate
              </label>
            </div>
          )}

          <div className="dnd-mp-code-row">
            <div className="dnd-mp-code">{online.code}</div>
            <button onClick={() => copy(online.code)}>Copy code</button>
          </div>
          {shareUrl && <button className="ghost-btn small" onClick={() => copy(shareUrl)}>Copy invite link</button>}

          <div className="dnd-mp-peers">
            {online.peers.length === 0 ? <span className="muted small">No one else here yet — share the code.</span> :
              online.peers.map((p) => (
                <span key={p.id} className="dnd-mp-peer">
                  <span className="dnd-mp-peer-dot" style={{ background: p.color === "spectator" ? "#8b94a8" : p.color }} />
                  {p.name}{p.color === "spectator" && " (spectator)"}{online.you?.id === p.id && " (you)"}
                </span>
              ))}
          </div>

          {failed && <p className="muted small">{online.error ?? "Disconnected — retrying…"}</p>}
          <button className="danger" onClick={onLeave}>Leave game</button>
        </>
      )}
    </div>
  );
}

