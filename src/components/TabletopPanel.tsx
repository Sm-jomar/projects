import { useEffect, useMemo, useRef, useState } from "react";
import { TabletopCanvas, type Tool } from "./TabletopCanvas";
import { DiceRoller } from "./DiceRoller";
import {
  GAME_TYPES, DEPLOYMENTS, newTabletop, addToken, addTerrain, addTokenForUnit,
  loadTabletop, saveTabletop, newId,
  type GameType, type TabletopState, type Terrain, type Token, type FactionColor,
  type DeploymentKey,
} from "../lib/tabletop";
import { listArmies } from "../lib/storage";
import { unitById } from "../data/catalog";
import { cardForUnit } from "../lib/cardLookup";
import { FACTIONS } from "../lib/factions";
import type { SavedArmy, Unit } from "../lib/types";

type Props = { onClose: () => void };

const TERRAIN_PRESETS: Array<{ kind: Terrain["kind"]; label: string; width: number; height: number; shape: Terrain["shape"] }> = [
  { kind: "rock",      label: "Rock",      width: 3, height: 2, shape: "circle" },
  { kind: "wall",      label: "Wall",      width: 6, height: 0.5, shape: "rect" },
  { kind: "building",  label: "Building",  width: 5, height: 4, shape: "rect" },
  { kind: "forest",    label: "Forest",    width: 6, height: 4, shape: "rect" },
  { kind: "barricade", label: "Barricade", width: 4, height: 0.5, shape: "rect" },
  { kind: "objective", label: "Objective", width: 1.5, height: 1.5, shape: "circle" },
];

const FACTION_COLORS: Array<{ id: FactionColor; label: string }> = [
  { id: "rebels",      label: "Rebels" },
  { id: "imperials",   label: "Empire" },
  { id: "republic",    label: "Republic" },
  { id: "separatists", label: "Separatists" },
  { id: "mercenary",   label: "Mercenary" },
  { id: "neutral",     label: "Neutral" },
];

const SNAP_OPTIONS = [
  { value: 0,   label: "off" },
  { value: 0.5, label: '½"' },
  { value: 1,   label: '1"' },
  { value: 3,   label: '3"' },
];

const HISTORY_LIMIT = 50;

// One roster entry resolved from a SavedArmy: links the saved entry ID
// (slot) to the catalog Unit and its card image URL.
type RosterEntry = {
  entryId: string;
  unit: Unit;
  portraitUrl: string | null;
};

function resolveRoster(army: SavedArmy): { entries: RosterEntry[]; unmatched: number } {
  const entries: RosterEntry[] = [];
  let unmatched = 0;
  for (const e of army.entries) {
    const u = unitById(e.unitId);
    if (!u) { unmatched++; continue; }
    entries.push({ entryId: e.entryId, unit: u, portraitUrl: cardForUnit(u) });
  }
  return { entries, unmatched };
}

export function TabletopPanel({ onClose }: Props) {
  // Restore an in-progress game if one was auto-saved.
  const [state, setState] = useState<TabletopState>(() => loadTabletop() ?? newTabletop("standard"));
  const [tool, setTool] = useState<Tool>("move");
  const [snap, setSnap] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState<"setup" | "dice">("setup");
  const [customW, setCustomW] = useState(72);
  const [customH, setCustomH] = useState(36);

  // --- Undo ----------------------------------------------------------------
  // History holds snapshots taken *before* each discrete mutation. Item
  // drags snapshot once at drag start (via onDragStart) so the per-frame
  // transient updates don't flood the stack.
  const historyRef = useRef<TabletopState[]>([]);
  const [histLen, setHistLen] = useState(0);

  function pushHistory(snapshot: TabletopState) {
    const h = historyRef.current;
    h.push(snapshot);
    if (h.length > HISTORY_LIMIT) h.shift();
    setHistLen(h.length);
  }

  function commit(next: TabletopState) {
    pushHistory(state);
    setState(next);
  }

  function undo() {
    const prev = historyRef.current.pop();
    if (prev) {
      setState(prev);
      setHistLen(historyRef.current.length);
    }
  }

  // --- Autosave --------------------------------------------------------------
  // Debounced so dragging (a state update per pointermove) doesn't hammer
  // localStorage with synchronous writes.
  useEffect(() => {
    const t = setTimeout(() => saveTabletop(state), 400);
    return () => clearTimeout(t);
  }, [state]);

  // Player + army loading. localStorage is synchronous, so we can read the
  // saved-army list straight into initial state — no effect needed.
  const [armies, setArmies] = useState<SavedArmy[]>(() => listArmies());
  const [armyPickerOpen, setArmyPickerOpen] = useState(false);
  const [loadedArmy, setLoadedArmy] = useState<SavedArmy | null>(null);
  const [opponentFaction, setOpponentFaction] = useState<FactionColor>("imperials");

  function openArmyPicker() {
    // Re-read in case the user saved a list in another tab while this
    // modal was open.
    setArmies(listArmies());
    setArmyPickerOpen(true);
  }

  const { entries: roster, unmatched } = useMemo(
    () => loadedArmy ? resolveRoster(loadedArmy) : { entries: [], unmatched: 0 },
    [loadedArmy],
  );
  // Count of tokens already placed for each unit, so the row can show
  // "(2 on board)".
  const placedByUnit: Record<string, number> = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of state.tokens) if (t.unitId) m[t.unitId] = (m[t.unitId] ?? 0) + 1;
    return m;
  }, [state.tokens]);

  function setGameType(gt: GameType) {
    const size = gt === "custom" ? { widthInches: customW, heightInches: customH } : GAME_TYPES[gt].size;
    commit({ ...state, gameType: gt, map: size });
  }

  function spawnTerrain(p: typeof TERRAIN_PRESETS[number]) {
    commit(addTerrain(state, { kind: p.kind, label: p.label, width: p.width, height: p.height, shape: p.shape }));
  }

  function spawnToken(color: FactionColor) {
    commit(addToken(state, { color, label: color === "neutral" ? "Unit" : "Opp" }));
  }

  function placeUnitAtCenter(r: RosterEntry) {
    commit(addTokenForUnit(state, r.unit, r.portraitUrl));
  }

  function onDropPayload(payload: string, at: { x: number; y: number }) {
    try {
      const data = JSON.parse(payload) as { unitId: string };
      const u = unitById(data.unitId);
      if (!u) return;
      const portrait = cardForUnit(u);
      commit(addTokenForUnit(state, u, portrait, at));
    } catch {
      // Ignore — payload wasn't ours.
    }
  }

  function loadArmy(a: SavedArmy) {
    setLoadedArmy(a);
    setArmyPickerOpen(false);
    // Default opponent color to a different faction.
    if (a.faction === opponentFaction) {
      const fallback = (FACTION_COLORS.find((f) => f.id !== a.faction && f.id !== "neutral")?.id) ?? "imperials";
      setOpponentFaction(fallback as FactionColor);
    }
  }

  function deleteSelected() {
    if (!selectedId) return;
    commit({
      ...state,
      tokens: state.tokens.filter((t) => t.id !== selectedId),
      terrain: state.terrain.filter((t) => t.id !== selectedId),
    });
    setSelectedId(null);
  }

  function duplicateSelected() {
    if (!selectedId) return;
    const tk = state.tokens.find((t) => t.id === selectedId);
    if (tk) {
      const copy: Token = { ...tk, id: newId("tk"), x: tk.x + 1, y: tk.y + 1, activated: false };
      commit({ ...state, tokens: [...state.tokens, copy] });
      setSelectedId(copy.id);
      return;
    }
    const tr = state.terrain.find((t) => t.id === selectedId);
    if (tr) {
      const copy: Terrain = { ...tr, id: newId("tr"), x: tr.x + 1, y: tr.y + 1 };
      commit({ ...state, terrain: [...state.terrain, copy] });
      setSelectedId(copy.id);
    }
  }

  function updateSelectedToken(patch: Partial<Token>) {
    if (!selectedId) return;
    commit({ ...state, tokens: state.tokens.map((t) => t.id === selectedId ? { ...t, ...patch } : t) });
  }

  function updateSelectedTerrain(patch: Partial<Terrain>) {
    if (!selectedId) return;
    commit({ ...state, terrain: state.terrain.map((t) => t.id === selectedId ? { ...t, ...patch } : t) });
  }

  function toggleActivated(tokenId: string) {
    commit({
      ...state,
      tokens: state.tokens.map((t) => t.id === tokenId ? { ...t, activated: !t.activated } : t),
    });
  }

  function endRound() {
    commit({
      ...state,
      round: state.round + 1,
      tokens: state.tokens.map((t) => ({ ...t, activated: false })),
    });
  }

  function resetGame() {
    if (!confirm("Reset round to 1, zero both VP scores, and ready all units? The board layout stays.")) return;
    commit({
      ...state,
      round: 1,
      vp: { blue: 0, red: 0 },
      tokens: state.tokens.map((t) => ({ ...t, activated: false, wounds: 0, suppression: 0 })),
    });
  }

  function bumpVp(side: "blue" | "red", delta: number) {
    commit({ ...state, vp: { ...state.vp, [side]: Math.max(0, state.vp[side] + delta) } });
  }

  // --- Keyboard shortcuts ----------------------------------------------------
  // Declared after the handlers it dispatches to. No dependency array on
  // purpose: the listener is cheap to re-attach and always sees fresh state.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        deleteSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      } else if (e.key === "Escape") {
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const selectedToken = state.tokens.find((t) => t.id === selectedId);
  const selectedTerrain = state.terrain.find((t) => t.id === selectedId);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="tabletop-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Tabletop</h2>
          <div className="tt-tool-row">
            <button className={"cb-tab" + (tool === "move" ? " active" : "")} onClick={() => setTool("move")}>Move</button>
            <button className={"cb-tab" + (tool === "ruler" ? " active" : "")} onClick={() => setTool("ruler")}>Ruler</button>
            <button className={"cb-tab" + (tool === "pan" ? " active" : "")} onClick={() => setTool("pan")}>Pan</button>
            <label className="tt-snap">
              snap
              <select value={snap} onChange={(e) => setSnap(Number(e.target.value))}>
                {SNAP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="tt-snap">
              <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> grid
            </label>
          </div>
          <button className="close-btn" onClick={onClose}>×</button>
        </header>

        <div className="tabletop-body">
          <div className="tt-canvas-col">
            <div className="tt-status-bar">
              <div className="tt-status-group">
                <span className="tt-status-label">Round</span>
                <button onClick={() => commit({ ...state, round: Math.max(1, state.round - 1) })} aria-label="Previous round">−</button>
                <b>{state.round}</b>
                <button onClick={() => commit({ ...state, round: state.round + 1 })} aria-label="Next round">+</button>
                <button className="tt-endround" onClick={endRound} title="Advance to the next round and ready all units">End round ▸</button>
              </div>
              <div className="tt-status-group tt-status-blue">
                <span className="tt-status-label">Blue VP</span>
                <button onClick={() => bumpVp("blue", -1)} aria-label="Blue VP minus">−</button>
                <b>{state.vp.blue}</b>
                <button onClick={() => bumpVp("blue", 1)} aria-label="Blue VP plus">+</button>
              </div>
              <div className="tt-status-group tt-status-red">
                <span className="tt-status-label">Red VP</span>
                <button onClick={() => bumpVp("red", -1)} aria-label="Red VP minus">−</button>
                <b>{state.vp.red}</b>
                <button onClick={() => bumpVp("red", 1)} aria-label="Red VP plus">+</button>
              </div>
              <button className="tt-undo" onClick={undo} disabled={histLen === 0} title="Undo (Ctrl+Z)">↶ Undo</button>
            </div>
            <div className="tt-canvas-host">
              <TabletopCanvas
                state={state}
                onState={setState}
                tool={tool}
                snapInches={snap}
                showGrid={showGrid}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onDropPayload={onDropPayload}
                onDragStart={() => pushHistory(state)}
                onToggleActivated={toggleActivated}
              />
            </div>
          </div>

          <aside className="tt-sidebar">
            <div className="tt-sidebar-tabs">
              <button className={"cb-tab" + (sidebar === "setup" ? " active" : "")} onClick={() => setSidebar("setup")}>Setup</button>
              <button className={"cb-tab" + (sidebar === "dice" ? " active" : "")} onClick={() => setSidebar("dice")}>Dice</button>
            </div>

            {sidebar === "setup" ? (
              <div className="tt-setup">
                <section>
                  <h3>Your army</h3>
                  {loadedArmy ? (
                    <div className="tt-army-loaded">
                      <div className="tt-army-loaded-info">
                        <span className="tt-army-loaded-name">{loadedArmy.name || "Untitled"}</span>
                        <span className="muted small">
                          {FACTIONS[loadedArmy.faction]?.short ?? loadedArmy.faction} · {loadedArmy.entries.length} units
                        </span>
                      </div>
                      <div className="tt-army-loaded-actions">
                        <button onClick={() => openArmyPicker()}>Change</button>
                        <button className="ghost-btn" onClick={() => setLoadedArmy(null)}>Clear</button>
                      </div>
                    </div>
                  ) : (
                    <button className="tt-palette-btn" onClick={() => openArmyPicker()}>
                      {armies.length === 0 ? "No saved lists" : `Choose from ${armies.length} saved list${armies.length === 1 ? "" : "s"}…`}
                    </button>
                  )}
                  {armyPickerOpen && (
                    <ul className="tt-army-picker">
                      {armies.length === 0 ? (
                        <li className="muted small empty">Save a list from the Builder first, then come back.</li>
                      ) : (
                        armies.map((a) => (
                          <li key={a.id}>
                            <button onClick={() => loadArmy(a)}>
                              <span className="tt-army-picker-name">{a.name || "Untitled"}</span>
                              <span className="muted small">
                                {FACTIONS[a.faction]?.short ?? a.faction} · {a.entries.length} units
                              </span>
                            </button>
                          </li>
                        ))
                      )}
                      <li><button className="ghost-btn" onClick={() => setArmyPickerOpen(false)}>Cancel</button></li>
                    </ul>
                  )}
                </section>

                {loadedArmy && (
                  <section>
                    <h3>Deploy units</h3>
                    {roster.length === 0 ? (
                      <p className="muted small empty-roster">
                        {loadedArmy.entries.length === 0
                          ? "This list has no units yet. Add some in the Builder and save."
                          : `None of the ${loadedArmy.entries.length} entr${loadedArmy.entries.length === 1 ? "y" : "ies"} in this list match the unit catalog — the saved IDs may be from an older version.`}
                      </p>
                    ) : (
                      <>
                        <ul className="tt-roster">
                          {roster.map((r) => {
                            const placed = placedByUnit[r.unit.id] ?? 0;
                            return (
                              <li key={r.entryId}
                                  className="tt-roster-row"
                                  draggable
                                  onDragStart={(e) => {
                                    e.dataTransfer.setData("application/x-legion-token", JSON.stringify({ unitId: r.unit.id }));
                                    e.dataTransfer.effectAllowed = "copy";
                                  }}>
                                <div className="tt-roster-portrait"
                                     style={r.portraitUrl ? { backgroundImage: `url(${r.portraitUrl})` } : undefined}>
                                  {!r.portraitUrl && r.unit.name.slice(0, 2)}
                                </div>
                                <div className="tt-roster-info">
                                  <span className="tt-roster-name">{r.unit.name}</span>
                                  <span className="muted small">
                                    {r.unit.rank}{placed > 0 ? ` · ${placed} on board` : ""}
                                  </span>
                                </div>
                                <button className="tt-roster-add" onClick={() => placeUnitAtCenter(r)} title="Deploy to center of board">＋</button>
                              </li>
                            );
                          })}
                        </ul>
                        {unmatched > 0 && (
                          <p className="muted small">
                            {unmatched} unit{unmatched === 1 ? "" : "s"} in this list couldn't be matched to the catalog.
                          </p>
                        )}
                        <p className="muted small tt-hint">
                          Drag a unit onto the board, or tap <b>＋</b> to deploy at the center.
                        </p>
                      </>
                    )}
                  </section>
                )}

                <section>
                  <h3>Game type</h3>
                  <div className="tt-game-types">
                    {(Object.keys(GAME_TYPES) as GameType[]).map((gt) => (
                      <button key={gt}
                              className={"tt-game-type" + (state.gameType === gt ? " active" : "")}
                              onClick={() => setGameType(gt)}>
                        <span className="tt-game-type-label">{GAME_TYPES[gt].label}</span>
                        <span className="tt-game-type-desc muted small">{GAME_TYPES[gt].description}</span>
                      </button>
                    ))}
                  </div>
                  {state.gameType === "custom" && (
                    <div className="tt-custom-size">
                      <label>W <input type="number" min={12} max={144} value={customW} onChange={(e) => { const v = Number(e.target.value) || 0; setCustomW(v); commit({ ...state, map: { ...state.map, widthInches: v } }); }} /></label>
                      <label>H <input type="number" min={12} max={144} value={customH} onChange={(e) => { const v = Number(e.target.value) || 0; setCustomH(v); commit({ ...state, map: { ...state.map, heightInches: v } }); }} /></label>
                      <span className="muted small">inches</span>
                    </div>
                  )}
                </section>

                <section>
                  <h3>Deployment zones</h3>
                  <div className="tt-faction-pills">
                    <button className={"tt-faction-pill" + (state.deployment === null ? " active" : "")}
                            onClick={() => commit({ ...state, deployment: null })}>
                      None
                    </button>
                    {(Object.keys(DEPLOYMENTS) as DeploymentKey[]).map((k) => (
                      <button key={k}
                              className={"tt-faction-pill" + (state.deployment === k ? " active" : "")}
                              onClick={() => commit({ ...state, deployment: k })}>
                        {DEPLOYMENTS[k]}
                      </button>
                    ))}
                  </div>
                </section>

                <section>
                  <h3>Terrain</h3>
                  <div className="tt-palette">
                    {TERRAIN_PRESETS.map((p) => (
                      <button key={p.kind} className="tt-palette-btn" onClick={() => spawnTerrain(p)}>+ {p.label}</button>
                    ))}
                  </div>
                </section>

                <section>
                  <h3>Opponent / quick tokens</h3>
                  <div className="tt-faction-pills">
                    {FACTION_COLORS.filter((f) => f.id !== "neutral").map((f) => (
                      <button key={f.id}
                              className={"tt-faction-pill faction-" + f.id + (opponentFaction === f.id ? " active" : "")}
                              onClick={() => setOpponentFaction(f.id)}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <div className="tt-quick-token-row">
                    <button className="tt-palette-btn" onClick={() => spawnToken(opponentFaction)}>+ {FACTION_COLORS.find((f) => f.id === opponentFaction)?.label} token</button>
                    <button className="tt-palette-btn" onClick={() => spawnToken("neutral")}>+ Neutral</button>
                  </div>
                </section>

                {selectedToken && (
                  <section className="tt-edit">
                    <h3>Token · {selectedToken.label || "(no label)"}</h3>
                    <label>Label <input value={selectedToken.label} onChange={(e) => updateSelectedToken({ label: e.target.value })} /></label>
                    <label>Color
                      <select value={selectedToken.color} onChange={(e) => updateSelectedToken({ color: e.target.value as FactionColor })}>
                        {FACTION_COLORS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                      </select>
                    </label>
                    <label>Size (in) <input type="number" min={0.5} max={4} step={0.25} value={selectedToken.size} onChange={(e) => updateSelectedToken({ size: Number(e.target.value) || 1 })} /></label>

                    <div className="tt-counter-row">
                      <span>Wounds</span>
                      <div className="tt-counter-controls">
                        <button onClick={() => updateSelectedToken({ wounds: Math.max(0, (selectedToken.wounds ?? 0) - 1) })}>−</button>
                        <b>{selectedToken.wounds ?? 0}</b>
                        <button onClick={() => updateSelectedToken({ wounds: (selectedToken.wounds ?? 0) + 1 })}>+</button>
                      </div>
                    </div>
                    <div className="tt-counter-row">
                      <span>Suppression</span>
                      <div className="tt-counter-controls">
                        <button onClick={() => updateSelectedToken({ suppression: Math.max(0, (selectedToken.suppression ?? 0) - 1) })}>−</button>
                        <b>{selectedToken.suppression ?? 0}</b>
                        <button onClick={() => updateSelectedToken({ suppression: (selectedToken.suppression ?? 0) + 1 })}>+</button>
                      </div>
                    </div>
                    <div className="tt-counter-row">
                      <span>Facing</span>
                      <div className="tt-counter-controls">
                        {selectedToken.rotation != null ? (
                          <>
                            <button onClick={() => updateSelectedToken({ rotation: ((selectedToken.rotation ?? 0) - 45 + 360) % 360 })} title="Rotate left 45°">⟲</button>
                            <b>{selectedToken.rotation}°</b>
                            <button onClick={() => updateSelectedToken({ rotation: ((selectedToken.rotation ?? 0) + 45) % 360 })} title="Rotate right 45°">⟳</button>
                            <button onClick={() => updateSelectedToken({ rotation: undefined })} title="Remove facing arrow">×</button>
                          </>
                        ) : (
                          <button onClick={() => updateSelectedToken({ rotation: 0 })}>Add arrow</button>
                        )}
                      </div>
                    </div>

                    <label className="tt-check">
                      <input type="checkbox" checked={!!selectedToken.activated}
                             onChange={(e) => updateSelectedToken({ activated: e.target.checked })} />
                      Activated this round
                    </label>
                    <label>Badge <input value={selectedToken.badge ?? ""} placeholder="e.g. ion" onChange={(e) => updateSelectedToken({ badge: e.target.value || undefined })} /></label>
                    <div className="tt-edit-actions">
                      <button onClick={duplicateSelected}>Duplicate</button>
                      <button className="danger" onClick={deleteSelected}>Delete</button>
                    </div>
                  </section>
                )}

                {selectedTerrain && (
                  <section className="tt-edit">
                    <h3>Terrain · {selectedTerrain.label || selectedTerrain.kind}</h3>
                    <label>Label <input value={selectedTerrain.label} onChange={(e) => updateSelectedTerrain({ label: e.target.value })} /></label>
                    <div className="tt-edit-row">
                      <label>W <input type="number" min={0.5} max={48} step={0.5} value={selectedTerrain.width} onChange={(e) => updateSelectedTerrain({ width: Number(e.target.value) || 1 })} /></label>
                      <label>H <input type="number" min={0.5} max={48} step={0.5} value={selectedTerrain.height} onChange={(e) => updateSelectedTerrain({ height: Number(e.target.value) || 1 })} disabled={selectedTerrain.shape === "circle"} /></label>
                      <label>Rot <input type="number" min={-180} max={180} step={5} value={selectedTerrain.rotation} onChange={(e) => updateSelectedTerrain({ rotation: Number(e.target.value) || 0 })} /></label>
                    </div>
                    <div className="tt-edit-actions">
                      <button onClick={duplicateSelected}>Duplicate</button>
                      <button className="danger" onClick={deleteSelected}>Delete</button>
                    </div>
                  </section>
                )}

                <section>
                  <h3>Board</h3>
                  <div className="tt-edit-actions">
                    <button onClick={resetGame}>Reset game</button>
                    <button className="danger" onClick={() => { if (confirm("Remove every token and terrain piece from the board?")) commit({ ...state, terrain: [], tokens: [] }); }}>Clear board</button>
                  </div>
                </section>

                <p className="muted small tt-hint">
                  Drag pieces with mouse or finger; pinch or scroll to zoom; shift-drag or <b>Pan</b> to move the view.
                  Double-click a token to mark it activated. <b>Delete</b> removes the selection, <b>Ctrl+Z</b> undoes.
                  The board auto-saves — close and come back any time.
                </p>
              </div>
            ) : (
              <DiceRoller />
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
