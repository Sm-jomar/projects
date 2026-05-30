import { useState } from "react";
import { TabletopCanvas, type Tool } from "./TabletopCanvas";
import { DiceRoller } from "./DiceRoller";
import {
  GAME_TYPES, newTabletop, addToken, addTerrain,
  type GameType, type TabletopState, type Terrain, type Token, type FactionColor,
} from "../lib/tabletop";

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

export function TabletopPanel({ onClose }: Props) {
  const [state, setState] = useState<TabletopState>(() => newTabletop("standard"));
  const [tool, setTool] = useState<Tool>("move");
  const [snap, setSnap] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState<"setup" | "dice">("setup");
  const [customW, setCustomW] = useState(72);
  const [customH, setCustomH] = useState(36);

  function setGameType(gt: GameType) {
    const size = gt === "custom" ? { widthInches: customW, heightInches: customH } : GAME_TYPES[gt].size;
    setState({ ...state, gameType: gt, map: size });
  }

  function spawnTerrain(p: typeof TERRAIN_PRESETS[number]) {
    setState((s) => addTerrain(s, { kind: p.kind, label: p.label, width: p.width, height: p.height, shape: p.shape }));
  }

  function spawnToken(color: FactionColor) {
    setState((s) => addToken(s, { color, label: "Unit" }));
  }

  function deleteSelected() {
    if (!selectedId) return;
    setState({
      ...state,
      tokens: state.tokens.filter((t) => t.id !== selectedId),
      terrain: state.terrain.filter((t) => t.id !== selectedId),
    });
    setSelectedId(null);
  }

  function updateSelectedToken(patch: Partial<Token>) {
    if (!selectedId) return;
    setState({ ...state, tokens: state.tokens.map((t) => t.id === selectedId ? { ...t, ...patch } : t) });
  }

  function updateSelectedTerrain(patch: Partial<Terrain>) {
    if (!selectedId) return;
    setState({ ...state, terrain: state.terrain.map((t) => t.id === selectedId ? { ...t, ...patch } : t) });
  }

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
          <div className="tt-canvas-host">
            <TabletopCanvas
              state={state}
              onState={setState}
              tool={tool}
              snapInches={snap}
              showGrid={showGrid}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>

          <aside className="tt-sidebar">
            <div className="tt-sidebar-tabs">
              <button className={"cb-tab" + (sidebar === "setup" ? " active" : "")} onClick={() => setSidebar("setup")}>Setup</button>
              <button className={"cb-tab" + (sidebar === "dice" ? " active" : "")} onClick={() => setSidebar("dice")}>Dice</button>
            </div>

            {sidebar === "setup" ? (
              <div className="tt-setup">
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
                      <label>W <input type="number" min={12} max={144} value={customW} onChange={(e) => { const v = Number(e.target.value) || 0; setCustomW(v); setState({ ...state, map: { ...state.map, widthInches: v } }); }} /></label>
                      <label>H <input type="number" min={12} max={144} value={customH} onChange={(e) => { const v = Number(e.target.value) || 0; setCustomH(v); setState({ ...state, map: { ...state.map, heightInches: v } }); }} /></label>
                      <span className="muted small">inches</span>
                    </div>
                  )}
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
                  <h3>Tokens</h3>
                  <div className="tt-palette">
                    {FACTION_COLORS.map((f) => (
                      <button key={f.id} className="tt-palette-btn" onClick={() => spawnToken(f.id)}>+ {f.label}</button>
                    ))}
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
                    <label>Badge <input value={selectedToken.badge ?? ""} placeholder="e.g. 2" onChange={(e) => updateSelectedToken({ badge: e.target.value || undefined })} /></label>
                    <button className="danger" onClick={deleteSelected}>Delete</button>
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
                    <button className="danger" onClick={deleteSelected}>Delete</button>
                  </section>
                )}

                <section>
                  <h3>Board</h3>
                  <button onClick={() => setState({ ...state, terrain: [], tokens: [] })} className="danger">Clear board</button>
                </section>

                <p className="muted small tt-hint">
                  Drag tokens & terrain. Wheel or pinch to zoom. Hold shift or pick <b>Pan</b> to drag the view.
                  The selected token shows range bands (6/12/18/24"). Use the <b>Ruler</b> tool to measure between two points.
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
