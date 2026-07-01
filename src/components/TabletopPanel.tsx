import { useEffect, useMemo, useRef, useState } from "react";
import { TabletopCanvas, type Tool } from "./TabletopCanvas";
import { DiceRoller } from "./DiceRoller";
import {
  GAME_TYPES, DEPLOYMENTS, newTabletop, addToken, addTerrain, addTokenForUnit,
  loadTabletop, saveTabletop, newId, newCommandHand, tokenSide,
  templateAnchor, templatePoints,
  type GameType, type TabletopState, type Terrain, type Token, type FactionColor,
  type DeploymentKey, type MoveTemplate, type CommandHand,
} from "../lib/tabletop";
import { listArmies } from "../lib/storage";
import { unitById } from "../data/catalog";
import { cardForUnit } from "../lib/cardLookup";
import { FACTIONS } from "../lib/factions";
import type { SavedArmy, Unit } from "../lib/types";
import {
  RoomClient, generateRoomCode,
  type ConnStatus, type Peer, type RoomHandlers,
} from "../lib/roomClient";

type Props = { onClose: () => void };

// Live-multiplayer connection state surfaced to the UI.
type OnlineState = {
  status: ConnStatus;
  code: string;
  you: Peer | null;
  peers: Peer[];
  error?: string;
};

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

// The deployment where remote multiplayer actually works (the Cloudflare
// Worker that serves /api/room). The static GitHub Pages site has no room
// endpoint, so the "Open multiplayer site" button jumps here. Swap this to
// https://play.eslegion.com once eslegion.com's DNS is on Cloudflare and a
// custom-domain route is added back to wrangler.jsonc.
const PLAY_SITE_URL = "https://wrangler.sm-af6.workers.dev";

// Remembers the player's display name between sessions.
const NAME_KEY = "legion-tabletop.playername";

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

  // --- Remote play (Durable Object room) -----------------------------------
  const hasRoomParam = new URLSearchParams(location.search).has("room");
  const [online, setOnline] = useState<OnlineState | null>(null);
  // Auto-open the panel when arriving via an invite link so the player is
  // immediately prompted for a name + color before joining.
  const [onlineOpen, setOnlineOpen] = useState(hasRoomParam);
  const [joinCode, setJoinCode] = useState(
    () => new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "",
  );
  // Player identity, remembered between sessions. Empty name forces the
  // prompt; color is the requested side (server honors it if free).
  const [playerName, setPlayerName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [preferredColor, setPreferredColor] = useState<"blue" | "red">("blue");
  const [colorNote, setColorNote] = useState<string | null>(null);
  const roomRef = useRef<RoomClient | null>(null);
  // Always-fresh state for the seed-on-join callback (which fires outside
  // the render that owns `state`). Kept in sync via an effect rather than
  // assigned during render.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  // JSON of the last board we sent OR received, so the outbound sync
  // effect can tell a local edit (push it) from an echo of a remote one
  // (skip it) and avoid an infinite relay loop.
  const remoteEchoRef = useRef<string | null>(null);

  function buildHandlers(): RoomHandlers {
    return {
      onStatus: (status, detail) =>
        setOnline((o) => (o ? { ...o, status, error: detail } : o)),
      onWelcome: (you, remoteState, peers) => {
        setOnline((o) => ({
          status: "open",
          code: roomRef.current?.code ?? o?.code ?? "",
          you,
          peers,
        }));
        if (remoteState) {
          // Joining an existing room — adopt its board.
          remoteEchoRef.current = JSON.stringify(remoteState);
          setState(remoteState);
        } else {
          // First one in — seed the room with our current board.
          remoteEchoRef.current = JSON.stringify(stateRef.current);
          roomRef.current?.sendState(stateRef.current);
        }
      },
      onState: (remoteState) => {
        remoteEchoRef.current = JSON.stringify(remoteState);
        setState(remoteState);
      },
      onPresence: (peers) =>
        // Refresh the roster and re-derive our own identity (color/name
        // can change after welcome) by matching the client's id.
        setOnline((o) => {
          if (!o) return o;
          const you = o.you ? peers.find((p) => p.id === o.you!.id) ?? o.you : o.you;
          return { ...o, peers, you };
        }),
      onColorDenied: (color) => {
        setColorNote(`${color} is already taken by the other player.`);
        setTimeout(() => setColorNote(null), 3000);
      },
    };
  }

  function hostRoom() {
    if (!playerName.trim()) return;
    startRoom(generateRoomCode());
  }

  function joinRoom() {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4 || !playerName.trim()) return;
    startRoom(code);
  }

  function startRoom(code: string) {
    const name = playerName.trim();
    localStorage.setItem(NAME_KEY, name);
    roomRef.current?.close();
    remoteEchoRef.current = null;
    const client = new RoomClient(code, name, preferredColor, buildHandlers());
    roomRef.current = client;
    setOnline({ status: "connecting", code: client.code, you: null, peers: [] });
    client.connect();
  }

  function changeMyColor(color: "blue" | "red") {
    setPreferredColor(color);
    roomRef.current?.setColor(color);
  }

  function renameMe(name: string) {
    setPlayerName(name);
    const trimmed = name.trim();
    if (trimmed) {
      localStorage.setItem(NAME_KEY, trimmed);
      roomRef.current?.setName(trimmed);
    }
  }

  function leaveRoom() {
    roomRef.current?.close();
    roomRef.current = null;
    remoteEchoRef.current = null;
    setOnline(null);
    setColorNote(null);
  }

  // Push local board changes to the room. The echo guard skips states
  // that originated remotely (just applied via setState above).
  useEffect(() => {
    const client = roomRef.current;
    if (!client || online?.status !== "open") return;
    const js = JSON.stringify(state);
    if (js === remoteEchoRef.current) return;
    remoteEchoRef.current = js;
    client.sendState(state);
  }, [state, online?.status]);

  // Tear the socket down when the Tabletop closes.
  useEffect(() => () => roomRef.current?.close(), []);

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

  // --- Movement templates --------------------------------------------------
  function startTemplate(speed: 1 | 2 | 3) {
    if (!selectedToken) return;
    // Default each segment to point the same way the token is facing (so
    // the template starts as a straight line out the front of the base).
    const initial = selectedToken.rotation ?? 0;
    const angles = Array.from({ length: speed }, () => initial);
    commit({ ...state, moveTemplate: { tokenId: selectedToken.id, speed, angles } });
  }

  function updateTemplate(template: MoveTemplate) {
    // Transient updates while dragging — don't push to undo history every
    // frame; the initial startTemplate already snapshotted.
    setState({ ...state, moveTemplate: template });
  }

  function applyTemplate() {
    const t = state.moveTemplate;
    if (!t) return;
    const tk = state.tokens.find((x) => x.id === t.tokenId);
    if (!tk) return;
    const pts = templatePoints(templateAnchor(tk), t.angles);
    const endPt = pts[pts.length - 1]!;
    // The end of the template becomes the new FRONT of the token, so the
    // token center is the end point minus a base radius along the new
    // heading. The new facing is the heading of the last segment.
    const finalHeading = t.angles[t.angles.length - 1]!;
    const rad = (finalHeading * Math.PI) / 180;
    const r = tk.size / 2;
    const newCx = endPt.x - Math.sin(rad) * r;
    const newCy = endPt.y + Math.cos(rad) * r;
    commit({
      ...state,
      moveTemplate: null,
      tokens: state.tokens.map((x) => x.id === tk.id
        ? { ...x, x: newCx - r, y: newCy - r, rotation: finalHeading }
        : x),
    });
  }

  function cancelTemplate() {
    commit({ ...state, moveTemplate: null });
  }

  // --- Command hand -------------------------------------------------------
  function togglePlayed(side: "blue" | "red", index: number) {
    const hand = state.hands[side];
    const cards = hand.cards.map((c, i) => i === index ? { ...c, played: !c.played } : c);
    commit({ ...state, hands: { ...state.hands, [side]: { ...hand, cards } } });
  }

  function pickThisRound(side: "blue" | "red", index: number | null) {
    const hand = state.hands[side];
    commit({ ...state, hands: { ...state.hands, [side]: { ...hand, thisRound: index } } });
  }

  function resetHand(side: "blue" | "red") {
    commit({ ...state, hands: { ...state.hands, [side]: newCommandHand() } });
  }

  function endRound() {
    // Mark each side's "this round" card as played, clear the bid for the
    // next round, then ready and de-order every unit.
    const sweep = (h: CommandHand): CommandHand => ({
      cards: h.thisRound != null
        ? h.cards.map((c, i) => i === h.thisRound ? { ...c, played: true } : c)
        : h.cards,
      thisRound: null,
    });
    commit({
      ...state,
      round: state.round + 1,
      tokens: state.tokens.map((t) => ({ ...t, activated: false, ordered: false })),
      hands: { blue: sweep(state.hands.blue), red: sweep(state.hands.red) },
    });
  }

  function resetGame() {
    if (!confirm("Reset round to 1, zero both VP scores, ready all units, and shuffle both command decks? The board layout stays.")) return;
    commit({
      ...state,
      round: 1,
      vp: { blue: 0, red: 0 },
      moveTemplate: null,
      tokens: state.tokens.map((t) => ({ ...t, activated: false, ordered: false, wounds: 0, suppression: 0 })),
      hands: { blue: newCommandHand(), red: newCommandHand() },
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

  // Per-side order tallies for the status bar — only counts unit tokens
  // that belong to that side.
  const orderTally = useMemo(() => {
    const t = { blue: { ordered: 0, total: 0 }, red: { ordered: 0, total: 0 } };
    for (const tk of state.tokens) {
      const s = tokenSide(tk);
      if (s === "neutral" || tk.kind !== "unit") continue;
      t[s].total++;
      if (tk.ordered) t[s].ordered++;
    }
    return t;
  }, [state.tokens]);

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
          <div className="tt-online-wrap">
            <button
              className={"tt-online-btn" + (online?.status === "open" ? " live" : "")}
              onClick={() => setOnlineOpen((v) => !v)}
              title="Play online with a friend"
            >
              {online?.status === "open"
                ? `● ${online.code}`
                : online
                  ? "● connecting…"
                  : "Play online"}
            </button>
            {onlineOpen && (
              <OnlinePanel
                online={online}
                joinCode={joinCode}
                onJoinCodeChange={setJoinCode}
                playerName={playerName}
                onNameChange={setPlayerName}
                preferredColor={preferredColor}
                onPreferredColorChange={setPreferredColor}
                colorNote={colorNote}
                onHost={hostRoom}
                onJoin={joinRoom}
                onChangeColor={changeMyColor}
                onRename={renameMe}
                onLeave={leaveRoom}
                onClosePanel={() => setOnlineOpen(false)}
              />
            )}
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
                <span className="tt-status-label tt-status-sub" title="Units with orders this round / total units">
                  Orders <b>{orderTally.blue.ordered}/{orderTally.blue.total}</b>
                </span>
              </div>
              <div className="tt-status-group tt-status-red">
                <span className="tt-status-label">Red VP</span>
                <button onClick={() => bumpVp("red", -1)} aria-label="Red VP minus">−</button>
                <b>{state.vp.red}</b>
                <button onClick={() => bumpVp("red", 1)} aria-label="Red VP plus">+</button>
                <span className="tt-status-label tt-status-sub" title="Units with orders this round / total units">
                  Orders <b>{orderTally.red.ordered}/{orderTally.red.total}</b>
                </span>
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
                onTemplateUpdate={updateTemplate}
              />

              {/* Command card hands docked beneath the canvas — one row
                  per side. Click a pip to mark it played; click again to
                  bring it back. The yellow ring marks this round's pick. */}
              <div className="tt-hands">
                <HandRow side="blue" hand={state.hands.blue}
                  onTogglePlayed={togglePlayed}
                  onPickRound={pickThisRound}
                  onReset={resetHand} />
                <HandRow side="red" hand={state.hands.red}
                  onTogglePlayed={togglePlayed}
                  onPickRound={pickThisRound}
                  onReset={resetHand} />
              </div>
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
                    <label className="tt-check">
                      <input type="checkbox" checked={!!selectedToken.ordered}
                             onChange={(e) => updateSelectedToken({ ordered: e.target.checked })} />
                      Has an order
                    </label>
                    <label>Side
                      <select value={selectedToken.side ?? "(auto)"}
                              onChange={(e) => {
                                const v = e.target.value;
                                updateSelectedToken({ side: v === "(auto)" ? undefined : (v as "blue" | "red") });
                              }}>
                        <option value="(auto)">Auto ({tokenSide(selectedToken)})</option>
                        <option value="blue">Blue</option>
                        <option value="red">Red</option>
                      </select>
                    </label>
                    <label>Badge <input value={selectedToken.badge ?? ""} placeholder="e.g. ion" onChange={(e) => updateSelectedToken({ badge: e.target.value || undefined })} /></label>

                    {/* Movement templates appear here when a token is
                        selected. The buttons are disabled while a template
                        is already in play for a different token. */}
                    <div className="tt-move-row">
                      <span className="tt-counter-label">Move</span>
                      <div className="tt-move-controls">
                        {([1, 2, 3] as const).map((sp) => {
                          const active = state.moveTemplate?.tokenId === selectedToken.id && state.moveTemplate.speed === sp;
                          return (
                            <button key={sp}
                                    className={"tt-move-btn" + (active ? " active" : "")}
                                    onClick={() => active ? cancelTemplate() : startTemplate(sp)}>
                              {sp}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {state.moveTemplate?.tokenId === selectedToken.id && (
                      <div className="tt-edit-actions">
                        <button className="tt-apply" onClick={applyTemplate}>Apply move ▸</button>
                        <button className="ghost-btn" onClick={cancelTemplate}>Cancel</button>
                      </div>
                    )}

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
                  Double-click a token to mark it activated. Pick a Move template <b>1/2/3</b> while a token is selected; drag joint dots to bend, then <b>Apply</b>.
                  <b>Delete</b> removes the selection, <b>Ctrl+Z</b> undoes. The board auto-saves.
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

function HandRow(props: {
  side: "blue" | "red";
  hand: CommandHand;
  onTogglePlayed: (side: "blue" | "red", index: number) => void;
  onPickRound: (side: "blue" | "red", index: number | null) => void;
  onReset: (side: "blue" | "red") => void;
}) {
  const { side, hand, onTogglePlayed, onPickRound, onReset } = props;
  const remaining = hand.cards.filter((c) => !c.played).length;
  return (
    <div className={"tt-hand tt-hand-" + side}>
      <span className="tt-hand-label">{side === "blue" ? "Blue" : "Red"} hand</span>
      <div className="tt-hand-pips">
        {hand.cards.map((c, i) => {
          const isPick = hand.thisRound === i;
          return (
            <button key={i}
              className={
                "tt-pip" +
                (c.played ? " played" : "") +
                (isPick ? " bid" : "")
              }
              title={
                c.played
                  ? `Played (${c.pips} pip${c.pips === 1 ? "" : "s"}). Click to undo.`
                  : isPick
                    ? "This round's pick — click to clear"
                    : `Click to bid this card (${c.pips} pip${c.pips === 1 ? "" : "s"}). Long press / shift-click to mark played.`
              }
              onClick={(e) => {
                // Shift-click directly marks the card played; plain click
                // bids it for this round (or clears the bid if already set).
                if (e.shiftKey) {
                  onTogglePlayed(side, i);
                } else if (isPick) {
                  onPickRound(side, null);
                } else {
                  onPickRound(side, i);
                }
              }}>
              {c.pips}
            </button>
          );
        })}
      </div>
      <span className="tt-hand-meta muted small">
        {remaining}/{hand.cards.length} left
      </span>
      <button className="ghost-btn small" onClick={() => onReset(side)} title="Reshuffle / restore all seven cards">↻</button>
    </div>
  );
}

function OnlinePanel(props: {
  online: OnlineState | null;
  joinCode: string;
  onJoinCodeChange: (v: string) => void;
  playerName: string;
  onNameChange: (v: string) => void;
  preferredColor: "blue" | "red";
  onPreferredColorChange: (c: "blue" | "red") => void;
  colorNote: string | null;
  onHost: () => void;
  onJoin: () => void;
  onChangeColor: (c: "blue" | "red") => void;
  onRename: (name: string) => void;
  onLeave: () => void;
  onClosePanel: () => void;
}) {
  const {
    online, joinCode, onJoinCodeChange, playerName, onNameChange,
    preferredColor, onPreferredColorChange, colorNote,
    onHost, onJoin, onChangeColor, onRename, onLeave, onClosePanel,
  } = props;
  const connected = online?.status === "open";
  const connecting = online && (online.status === "connecting" || online.status === "reconnecting");
  const failed = online && (online.status === "error" || online.status === "closed");
  const nameOk = playerName.trim().length > 0;
  // Colors held by OTHER players — used to disable those swap buttons.
  const takenByOthers = new Set(
    (online?.peers ?? [])
      .filter((p) => p.id !== online?.you?.id)
      .map((p) => p.color),
  );

  // Whether this page is already served by the multiplayer-capable site.
  // If not (e.g. the static GitHub Pages mirror), surface a button to jump
  // there — carrying any ?room= code along so an invite still lands.
  const onPlaySite = (() => {
    try {
      return location.origin === new URL(PLAY_SITE_URL).origin;
    } catch {
      return false;
    }
  })();
  function openPlaySite() {
    const code = online?.code ?? new URLSearchParams(location.search).get("room") ?? "";
    const url = code ? `${PLAY_SITE_URL}/?room=${encodeURIComponent(code)}` : PLAY_SITE_URL;
    window.open(url, "_blank", "noopener");
  }

  const shareUrl =
    online?.code
      ? `${location.origin}${location.pathname}?room=${online.code}`
      : "";

  function copy(text: string) {
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  return (
    <div className="tt-online-panel" onClick={(e) => e.stopPropagation()}>
      <div className="tt-online-head">
        <strong>Remote play</strong>
        <button className="close-btn" onClick={onClosePanel}>×</button>
      </div>

      {!onPlaySite && (
        <div className="tt-online-site">
          <button className="pdf-run-btn" onClick={openPlaySite}>
            Open multiplayer site ↗
          </button>
          <p className="muted small tt-online-note">
            Remote play only works on the multiplayer site. This button opens it
            in a new tab (carrying your room code if you have one).
          </p>
        </div>
      )}

      {!online && (
        <>
          <p className="muted small">
            Play on a shared board with a friend. One person hosts and shares the
            code; the other joins. Moves, terrain, dice and scores stay in sync.
          </p>

          <label className="tt-online-field">
            Your name
            <input
              type="text"
              placeholder="e.g. Sam"
              value={playerName}
              maxLength={24}
              autoFocus
              onChange={(e) => onNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !nameOk) return;
                if (joinCode.trim().length >= 4) onJoin();
                else onHost();
              }}
            />
          </label>

          <div className="tt-online-field">
            <span>Play as</span>
            <div className="tt-color-choice">
              {(["blue", "red"] as const).map((c) => (
                <button
                  key={c}
                  className={"tt-color-btn tt-side-" + c + (preferredColor === c ? " active" : "")}
                  onClick={() => onPreferredColorChange(c)}
                >
                  {preferredColor === c ? "● " : ""}{c[0]!.toUpperCase() + c.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <button className="pdf-run-btn" onClick={onHost} disabled={!nameOk}>
            Host a new game
          </button>
          <div className="tt-online-join">
            <input
              type="text"
              placeholder="CODE"
              value={joinCode}
              maxLength={12}
              onChange={(e) => onJoinCodeChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter" && nameOk) onJoin(); }}
            />
            <button onClick={onJoin} disabled={joinCode.trim().length < 4 || !nameOk}>Join</button>
          </div>
          {!nameOk && <p className="muted small">Enter a name to host or join.</p>}
          <p className="muted small tt-online-note">
            Your preferred color is granted if it's free; otherwise you get the
            other side and can swap once it opens up.
          </p>
        </>
      )}

      {online && (
        <>
          <div className="tt-online-status-row">
            <span className={"tt-online-dot " + online.status} />
            <span>
              {connected ? "Connected" : connecting ? "Connecting…" : "Disconnected"}
              {online.you && connected && (
                <> · you are <b className={"tt-side-" + online.you.color}>{online.you.color}</b></>
              )}
            </span>
          </div>

          {connected && (
            <>
              <label className="tt-online-field">
                Your name
                <input
                  type="text"
                  value={playerName}
                  maxLength={24}
                  onChange={(e) => onNameChange(e.target.value)}
                  onBlur={() => onRename(playerName)}
                  onKeyDown={(e) => { if (e.key === "Enter") onRename(playerName); }}
                />
              </label>
              <div className="tt-online-field">
                <span>Your color</span>
                <div className="tt-color-choice">
                  {(["blue", "red"] as const).map((c) => {
                    const isMine = online.you?.color === c;
                    const taken = takenByOthers.has(c);
                    return (
                      <button
                        key={c}
                        className={"tt-color-btn tt-side-" + c + (isMine ? " active" : "")}
                        disabled={taken && !isMine}
                        title={taken && !isMine ? `${c} is taken` : `Play as ${c}`}
                        onClick={() => onChangeColor(c)}
                      >
                        {isMine ? "● " : ""}{c[0]!.toUpperCase() + c.slice(1)}
                        {taken && !isMine ? " ✕" : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
              {colorNote && <p className="muted small tt-online-warn">{colorNote}</p>}
            </>
          )}

          <div className="tt-online-code-row">
            <div className="tt-online-code">{online.code}</div>
            <button onClick={() => copy(online.code)} title="Copy code">Copy code</button>
          </div>
          {shareUrl && (
            <button className="ghost-btn small tt-online-share" onClick={() => copy(shareUrl)}>
              Copy invite link
            </button>
          )}

          <div className="tt-online-peers">
            {online.peers.length === 0 ? (
              <span className="muted small">No one else here yet — share the code.</span>
            ) : (
              online.peers.map((p) => (
                <span key={p.id} className={"tt-online-peer tt-side-" + p.color}>
                  ● {p.name}
                  {online.you?.id === p.id && " (you)"}
                </span>
              ))
            )}
          </div>

          {failed && (
            <p className="muted small tt-online-note">
              Couldn't reach the room server. Remote play only works on the
              Worker deployment — if you're on the static site, reopen the app
              from the Worker URL. Retrying automatically…
            </p>
          )}

          <button className="danger" onClick={onLeave}>Leave game</button>
        </>
      )}
    </div>
  );
}
