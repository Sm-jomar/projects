import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { TabletopCanvas, type Tool } from "./TabletopCanvas";
import { DiceRoller } from "./DiceRoller";
import {
  GAME_TYPES, DEPLOYMENTS, newTabletop, terrainElevation, pruneModels, addToken, addTerrain, addTokenForUnit,
  loadTabletop, saveTabletop, newId, newCommandHand, tokenSide, diffLegion, boardBytes, BOARD_BYTES_SAFE,
  templateAnchor, templatePoints,
  type GameType, type TabletopState, type Terrain, type Token, type FactionColor,
  type DeploymentKey, type MoveTemplate, type CommandHand, type MapImage,
} from "../lib/tabletop";
import { downscaleImage } from "../lib/image";
import { appendLog, type LogActor, type LogEntry } from "../lib/auditLog";
import { legionPlayUrl, roomsAvailableHere } from "../lib/appRouting";
import { AuditLogView } from "./AuditLogView";
import { ChatButton, ChatDock } from "./ChatDock";
import { useChatToggle, useSessionChat } from "./useSessionChat";
import { AiInvitePanel, AiSeatBanner } from "./AiInvites";
import { useAiInvites, type AiInvitesState } from "./useAiInvites";
import { AI_DENIED_TEXT, aiCodeFromUrl, parseAiCode } from "../lib/aiInvite";
import { MediaButton, MediaDock } from "./MediaPlayer";
import { useMediaPlayback, useMediaToggle } from "./useMediaPlayer";
import { parseTableMusic } from "../lib/media";
import {
  moveToken, startSquad, joinSquad, leaveSquad, makeLeader, disbandSquad, regroupSquad,
  normalizeSquads, listSquads, squadMembers, unlockedIds,
} from "../lib/squads";
import { listArmies } from "../lib/storage";
import { unitById } from "../data/catalog";
import { endPhaseStatus, showsUnitStatus, WOUND_INFO, WOUND_URL } from "../lib/statusTokens";
import { StatusTokenPanel } from "./StatusTokenPanel";
import { MissionSection } from "./MissionSection";
import { InfoDot } from "./InfoDot";
import { cardForUnit } from "../lib/cardLookup";
import { FACTIONS } from "../lib/factions";
import type { SavedArmy, Unit } from "../lib/types";
import {
  RoomClient, generateRoomCode,
  type ConnStatus, type Peer, type RoomHandlers, type PlayerColor,
} from "../lib/roomClient";

type Props = { onClose: () => void };

// Live-multiplayer connection state surfaced to the UI.
type OnlineState = {
  status: ConnStatus;
  code: string;
  you: Peer | null;
  peers: Peer[];
  error?: string;
  /** Whether this room is hidden from the public Live games list. */
  isPrivate?: boolean;
};

// three.js is only fetched once someone switches the board into 3D.
const Legion3D = lazy(() => import("./Legion3D"));

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

// Remembers the player's display name between sessions.
const NAME_KEY = "legion-tabletop.playername";
const PRIVATE_KEY = "legion-tabletop.privategame";

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

// Display color for a Legion player in the audit log (blue/red/spectator).
function legionActorColor(color: string): string {
  if (color === "blue") return "#6fa8e6";
  if (color === "red") return "#e67a6f";
  return "#8b94a8";
}

export function TabletopPanel({ onClose }: Props) {
  // Restore an in-progress game if one was auto-saved.
  const [state, setState] = useState<TabletopState>(() => loadTabletop() ?? newTabletop("standard"));
  const [tool, setTool] = useState<Tool>("move");
  const [snap, setSnap] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [view3d, setView3d] = useState(false);
  const modelFileRef = useRef<HTMLInputElement | null>(null);
  // A unit under direct control in 3D is mid-run (see Legion3D's onMoveToken).
  const runningRef = useRef(false);
  const [modelBusy, setModelBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Upload result/error, tied to the piece it was for.
  const [modelNote, setModelNote] = useState<{ id: string | null; text: string } | null>(null);
  const modelMsg = modelNote && modelNote.id === selectedId ? modelNote.text : null;
  const setModelMsg = (text: string | null) => setModelNote(text == null ? null : { id: selectedId, text });
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

  // Spectators are watch-only. Read via a ref so commit (defined before
  // the `online` state) can see the current value.
  const readOnlyRef = useRef(false);

  function commit(next: TabletopState) {
    if (readOnlyRef.current) return;
    pushHistory(state);
    setState(next);
  }

  function undo() {
    const prev = historyRef.current.pop();
    if (prev) {
      // Undo is for the board, not the music.
      setState((s) => ({ ...prev, music: s.music }));
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
  // An AI invite link (?ai=<code>) fills the join box with the whole code.
  const [joinCode, setJoinCode] = useState(
    () => aiCodeFromUrl() ?? new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "",
  );
  // Player identity, remembered between sessions. Empty name forces the
  // prompt; color is the requested side (server honors it if free).
  const [playerName, setPlayerName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [preferredColor, setPreferredColor] = useState<PlayerColor>("blue");
  // Host-time-only choice: keep the game off the public Live games list. A
  // joiner connects into whatever privacy the host already chose.
  const [wantPrivate, setWantPrivate] = useState(() => localStorage.getItem(PRIVATE_KEY) === "1");
  const [colorNote, setColorNote] = useState<string | null>(null);
  const roomRef = useRef<RoomClient<TabletopState> | null>(null);

  // Watch-only when connected as a spectator. Kept in a ref (above) so the
  // early-defined commit() can honor it without a stale-closure hazard.
  // An AI whose invite can't move pieces is watch-only too.
  const ai = useAiInvites(() => roomRef.current);
  const aiCodeRef = useRef<string | null>(null);
  const readOnly = online?.status === "open" && (online.you?.color === "spectator" || (!!online.you?.ai && !ai.self?.board));
  useEffect(() => { readOnlyRef.current = !!readOnly; }, [readOnly]);
  const chat = useSessionChat("legion", () => roomRef.current, online?.code ?? null, online?.you ?? null, online?.status === "open");
  const chatToggle = useChatToggle(chat, online?.you?.id ?? null);
  const mediaToggle = useMediaToggle("legion");
  const music = parseTableMusic(state.music);
  const media = useMediaPlayback(music);
  // Always-fresh state for the seed-on-join callback (which fires outside
  // the render that owns `state`). Kept in sync via an effect rather than
  // assigned during render.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // --- Audit log + ghost replay --------------------------------------------
  const actor: LogActor = online?.status === "open" && online.you
    ? { name: online.you.name, color: legionActorColor(online.you.color) }
    : { name: playerName.trim() || "You", color: "#8b94a8" };
  const actorRef = useRef(actor);
  useEffect(() => { actorRef.current = actor; });
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
  // Auto-log local changes by diffing; debounced so a drag logs one move on
  // settle. States applied from the network only advance the diff baseline.
  useEffect(() => {
    const curJson = JSON.stringify(state);
    if (appliedRemoteRef.current === curJson) { prevRef.current = state; return; }
    if (diffTimer.current) clearTimeout(diffTimer.current);
    diffTimer.current = setTimeout(() => {
      const prev = prevRef.current;
      prevRef.current = state;
      const entries = diffLegion(prev, state, actorRef.current);
      if (entries.length) setState((s) => ({ ...s, log: appendLog(s.log, entries) }));
    }, 350);
  }, [state]);

  // JSON of the last board we sent OR received, so the outbound sync
  // effect can tell a local edit (push it) from an echo of a remote one
  // (skip it) and avoid an infinite relay loop.
  const remoteEchoRef = useRef<string | null>(null);

  function buildHandlers(): RoomHandlers<TabletopState> {
    return {
      ...chat.handlers,
      // A refusal's reason (onDenied) outlives the close that follows it.
      onStatus: (status, detail) =>
        setOnline((o) => (o ? { ...o, status, error: detail ?? (status === "closed" ? o.error : undefined) } : o)),
      onDenied: (reason) =>
        setOnline((o) => (o ? {
          ...o, status: "error",
          error: AI_DENIED_TEXT[reason] ?? "That code belongs to a D&D game. Use a different code.",
        } : o)),
      onAppMessage: (msg) => { ai.handle(msg); },
      onWelcome: (you, remoteState, peers, extra) => {
        chat.onWelcome(roomRef.current?.code ?? "", extra);
        ai.onWelcome(extra);
        setOnline((o) => ({
          status: "open",
          code: roomRef.current?.code ?? o?.code ?? "",
          you,
          peers,
          isPrivate: roomRef.current?.isPrivate ?? false,
        }));
        if (remoteState) {
          // Joining an existing room — adopt its board.
          const js = JSON.stringify(remoteState);
          remoteEchoRef.current = js;
          appliedRemoteRef.current = js;
          setState(remoteState);
        } else {
          // First one in — seed the room with our current board.
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
    // A whole AI code joins as that AI (no name needed: the invite has one).
    const asAi = parseAiCode(code);
    if (asAi) { startRoom(asAi.room, asAi.code); return; }
    if (code.length < 4 || !playerName.trim()) return;
    startRoom(code);
  }

  function startRoom(code: string, aiCode: string | null = null) {
    aiCodeRef.current = aiCode;
    const name = playerName.trim();
    // An AI join (usually my own preview) leaves my saved identity alone.
    if (!aiCode) {
      localStorage.setItem(NAME_KEY, name);
      localStorage.setItem(PRIVATE_KEY, wantPrivate ? "1" : "0");
    }
    roomRef.current?.close();
    remoteEchoRef.current = null;
    const client = new RoomClient<TabletopState>(code, name, preferredColor, buildHandlers(), "legion", wantPrivate && !aiCode, aiCode);
    roomRef.current = client;
    setOnline({ status: "connecting", code: client.code, you: null, peers: [] });
    client.connect();
  }

  // Opened from "Preview as AI" (or an AI link): join straight away.
  useEffect(() => {
    const code = aiCodeFromUrl();
    const parsed = code ? parseAiCode(code) : null;
    if (!parsed) return;
    const t = setTimeout(() => startRoom(parsed.room, parsed.code), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeMyColor(color: PlayerColor) {
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
    if (aiCodeRef.current) {
      // Drop the AI code from the address bar so a reload doesn't rejoin.
      const u = new URL(location.href);
      u.searchParams.delete("ai");
      history.replaceState(null, "", u.toString());
      if (joinCode.includes("-AI-")) setJoinCode(roomRef.current?.code ?? "");
    }
    aiCodeRef.current = null;
    ai.reset();
    chat.reset();
    roomRef.current?.close();
    roomRef.current = null;
    remoteEchoRef.current = null;
    setOnline(null);
    setColorNote(null);
  }

  // Push local board changes to the room. The echo guard skips states
  // that originated remotely (just applied via setState above). Spectators
  // never push — the server ignores them anyway, but this avoids the noise.
  useEffect(() => {
    const client = roomRef.current;
    if (!client || online?.status !== "open" || readOnly) return;
    const js = JSON.stringify(state);
    if (js === remoteEchoRef.current) return;
    remoteEchoRef.current = js;
    client.sendState(state);
  }, [state, online?.status, readOnly]);

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

  // --- Map image --------------------------------------------------------------
  // The picture rides along in the synced board state, so uploads are
  // shrunk to a JPEG that stays well inside the room's size cap.
  const mapFileRef = useRef<HTMLInputElement | null>(null);
  const [mapNote, setMapNote] = useState<string | null>(null);

  function setMapImage(img: MapImage | null) {
    const next = { ...state, mapImage: img };
    if (img && boardBytes(next) > BOARD_BYTES_SAFE) {
      setMapNote("That image makes the board too large to sync. Try a smaller picture.");
      return;
    }
    setMapNote(null);
    commit(next);
  }

  function patchMapImage(patch: Partial<MapImage>) {
    if (state.mapImage) setMapImage({ ...state.mapImage, ...patch });
  }

  async function onMapFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const url = await downscaleImage(f, 1600, 0.75);
      setMapImage({ fit: "stretch", dim: 0, ...state.mapImage, url });
    } catch {
      setMapNote("Could not read that image.");
    } finally {
      if (mapFileRef.current) mapFileRef.current.value = "";
    }
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
    const gone = state.tokens.find((t) => t.id === selectedId);
    commit(pruneModels({
      ...state,
      tokens: normalizeSquads(state.tokens.filter((t) => t.id !== selectedId), gone),
      terrain: state.terrain.filter((t) => t.id !== selectedId),
    }));
    setSelectedId(null);
  }

  function duplicateSelected() {
    if (!selectedId) return;
    const tk = state.tokens.find((t) => t.id === selectedId);
    if (tk) {
      const copy: Token = { ...tk, id: newId("tk"), x: tk.x + 1, y: tk.y + 1, activated: false, squadId: undefined, squadLead: undefined };
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

  // STL upload for the selected unit or terrain piece. The model is stored
  // once in state.models and referenced by id, so a whole squad (or a row
  // of identical buildings) shares one copy in the synced board.
  async function onModelFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (modelFileRef.current) modelFileRef.current.value = "";
    const id = selectedId;
    if (!f || !id || readOnly) return;
    if (f.size > 80 * 1024 * 1024) { setModelMsg("That STL is over 80 MB — export a lighter version."); return; }
    setModelBusy(true);
    setModelMsg(null);
    try {
      const { encodeStlFile } = await import("../lib/stlModel");
      const m = await encodeStlFile(f);
      const modelId = newId("md");
      const models = { ...(state.models ?? {}), [modelId]: { name: f.name, data: m.data } };
      const tr = state.terrain.find((t) => t.id === id);
      let next: TabletopState;
      if (tr) {
        // Reshape the block to the model's proportions, keeping its width.
        const d = tr.shape === "circle" ? tr.width : Math.max(0.25, Math.round((tr.width * m.size.z / m.size.x) * 4) / 4);
        const elevation = Math.max(0.25, Math.round((m.size.y / Math.max(m.size.x, m.size.z)) * Math.max(tr.width, d) * 4) / 4);
        next = { ...state, models, terrain: state.terrain.map((t) => t.id === id ? { ...t, modelId, elevation, height: t.shape === "circle" ? t.height : d } : t) };
      } else {
        next = { ...state, models, tokens: state.tokens.map((t) => t.id === id ? { ...t, modelId } : t) };
      }
      commit(pruneModels(next));
      setModelMsg(m.shared
        ? `${f.name}: ${m.triangles.toLocaleString()} triangles, ${(m.bytes / 1048576).toFixed(1)} MB, shared with the table`
        : `${f.name}: couldn't reach the model server, so it was trimmed to ${m.triangles.toLocaleString()} triangles to fit the board`);
      setView3d(true);
    } catch (err) {
      setModelMsg(err instanceof Error && err.message ? err.message : "Could not read that STL file.");
    } finally {
      setModelBusy(false);
    }
  }

  function clearModel(id: string) {
    commit(pruneModels({
      ...state,
      tokens: state.tokens.map((t) => t.id === id ? { ...t, modelId: undefined } : t),
      terrain: state.terrain.map((t) => t.id === id ? { ...t, modelId: undefined } : t),
    }));
  }

  // Give every token of the same catalog unit (or the same label, for
  // generic tokens) the selected token's model.
  function shareModelWithUnit(tk: Token) {
    if (!tk.modelId) return;
    const same = (t: Token) => t.id !== tk.id && (tk.unitId ? t.unitId === tk.unitId : t.label === tk.label);
    commit(pruneModels({ ...state, tokens: state.tokens.map((t) => same(t) ? { ...t, modelId: tk.modelId } : t) }));
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
    // Squads stay base locked: a leader's move carries the squad, and a
    // member lands at the nearest spot still in contact.
    const moved = moveToken(state, tk.id, newCx - r, newCy - r);
    commit({
      ...moved,
      moveTemplate: null,
      tokens: moved.tokens.map((x) => x.id === tk.id ? { ...x, rotation: finalHeading } : x),
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
      tokens: state.tokens.map((t) => endPhaseStatus({ ...t, activated: false, ordered: false })),
      hands: { blue: sweep(state.hands.blue), red: sweep(state.hands.red) },
    });
  }

  function resetGame() {
    if (!confirm("Reset round to 1, zero both VP scores, ready all units, clear all wounds and tokens, and shuffle both command decks? The board layout stays.")) return;
    commit({
      ...state,
      round: 1,
      vp: { blue: 0, red: 0 },
      moveTemplate: null,
      tokens: state.tokens.map((t) => ({ ...t, activated: false, ordered: false, wounds: 0, suppression: 0, status: undefined })),
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
  // Other tokens of the selected unit that don't share its model yet.
  const sameUnitWithoutModel = selectedToken?.modelId
    ? state.tokens.filter((t) => t.id !== selectedToken.id && t.modelId !== selectedToken.modelId &&
        (selectedToken.unitId ? t.unitId === selectedToken.unitId : t.label === selectedToken.label)).length
    : 0;

  // Per-side order tallies for the status bar — only counts unit tokens
  // that belong to that side.
  const orderTally = useMemo(() => {
    const t = { blue: { ordered: 0, total: 0 }, red: { ordered: 0, total: 0 } };
    for (const tk of state.tokens) {
      const s = tokenSide(tk);
      // A squad is one unit with one order token.
      if (s === "neutral" || tk.kind !== "unit" || !showsUnitStatus(tk)) continue;
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
            <button className={"cb-tab tt-3d-btn" + (view3d ? " active" : "")} onClick={() => setView3d((v) => !v)}
                    title={view3d ? "Back to the flat board" : "See terrain height and depth in 3D"}>
              {view3d ? "2D view" : "3D view"}
            </button>
            <MediaButton toggle={mediaToggle} playing={!!media.playing} className="cb-tab" />
            <ChatButton toggle={chatToggle} className="cb-tab" />
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
                wantPrivate={wantPrivate}
                onWantPrivateChange={setWantPrivate}
                onHost={hostRoom}
                onJoin={joinRoom}
                onChangeColor={changeMyColor}
                onRename={renameMe}
                onLeave={leaveRoom}
                onClosePanel={() => setOnlineOpen(false)}
                ai={ai}
              />
            )}
          </div>
          <button className="close-btn" onClick={onClose}>×</button>
        </header>

        <div className="tabletop-body">
          <input ref={modelFileRef} type="file" accept=".stl,model/stl,application/sla" hidden onChange={onModelFile} />
          <div className="tt-canvas-col">
            <ChatDock chat={chat} myId={online?.you?.id ?? null} toggle={chatToggle} colorOf={(a) => legionActorColor(a.color)} />
            <MediaDock music={music} playback={media} toggle={mediaToggle}
                       canSet={!readOnly} myName={playerName.trim()}
                       cantSetWhy="Spectators can't change the table's music."
                       onSet={(m) => setState((s) => ({ ...s, music: m }))} />
            {online && ai.self && (
              <AiSeatBanner app="legion" ai={ai} onLeave={leaveRoom} error={online.status === "open" ? undefined : online.error} />
            )}
            {readOnly && (
              <div className="tt-spectating-bar">
                {online?.you?.ai
                  ? "👁 This AI invite can't move pieces — it can watch, pan and measure, chat and roll."
                  : "👁 Spectating — you can watch, pan and measure, but not change the board."}
              </div>
            )}
            <div className={"tt-status-bar" + (readOnly ? " readonly" : "")}>
              <div className="tt-tok-group">
                <span className="tt-status-label">Round</span>
                <button onClick={() => commit({ ...state, round: Math.max(1, state.round - 1) })} aria-label="Previous round">−</button>
                <b>{state.round}</b>
                <button onClick={() => commit({ ...state, round: state.round + 1 })} aria-label="Next round">+</button>
                <button className="tt-endround" onClick={endRound} title="Advance to the next round: ready all units, drop green tokens, and remove 1 suppression from each unit">End round ▸</button>
              </div>
              <div className="tt-tok-group tt-status-blue">
                <span className="tt-status-label">Blue VP</span>
                <button onClick={() => bumpVp("blue", -1)} aria-label="Blue VP minus">−</button>
                <b>{state.vp.blue}</b>
                <button onClick={() => bumpVp("blue", 1)} aria-label="Blue VP plus">+</button>
                <span className="tt-status-label tt-status-sub" title="Units with orders this round / total units">
                  Orders <b>{orderTally.blue.ordered}/{orderTally.blue.total}</b>
                </span>
              </div>
              <div className="tt-tok-group tt-status-red">
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
              {view3d ? (
                <div className="tt-canvas-wrap board3d-host">
                  <Suspense fallback={<div className="board3d board3d-loading">Loading 3D view…</div>}>
                    <Legion3D state={state} selectedId={selectedId} onSelect={setSelectedId} showGrid={showGrid}
                              onUploadModel={readOnly ? undefined : () => modelFileRef.current?.click()}
                              step={snap || 1}
                              onMoveToken={readOnly ? undefined : (id, x, y, run) => {
                                if (run) {
                                  // A unit under direct control moves freely. Its
                                  // run is one undo step: the first report saves
                                  // history, the rest just update the board. A
                                  // unit that shows a facing arrow keeps it turned.
                                  const moved = moveToken(state, id, x, y);
                                  const next = { ...moved, tokens: moved.tokens.map((t) => t.id === id && t.rotation != null ? { ...t, rotation: run.facing } : t) };
                                  if (runningRef.current) setState(next); else commit(next);
                                  runningRef.current = run.live;
                                  return;
                                }
                                const sn = (n: number) => snap ? Math.round(n / snap) * snap : n;
                                commit(moveToken(state, id, sn(x), sn(y)));
                              }} />
                  </Suspense>
                </div>
              ) : (
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
                readOnly={readOnly}
                ghost={ghost}
              />
              )}

              {/* Command card hands docked beneath the canvas — one row
                  per side. Click a pip to mark it played; click again to
                  bring it back. The yellow ring marks this round's pick. */}
              <div className={"tt-hands" + (readOnly ? " readonly" : "")}>
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
              <div className={"tt-setup" + (readOnly ? " readonly" : "")}>
                {readOnly && (
                  <p className="tt-spectating-note">
                    👁 Spectating — board editing is disabled. Switch to Blue or Red
                    in <b>Play online</b> to take a side.
                  </p>
                )}
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
                  <h3>Map image</h3>
                  <div className="tt-edit-actions">
                    <button onClick={() => mapFileRef.current?.click()}>{state.mapImage ? "Replace image" : "Upload image"}</button>
                    <button className="ghost-btn" onClick={() => setMapImage(null)} disabled={!state.mapImage}>Clear</button>
                    <input ref={mapFileRef} type="file" accept="image/*" hidden onChange={onMapFile} />
                  </div>
                  <label className="tt-map-field">Or paste image URL
                    <input value={state.mapImage?.url.startsWith("http") ? state.mapImage.url : ""}
                           placeholder="https://…"
                           onChange={(e) => {
                             const url = e.target.value.trim();
                             setMapImage(url ? { fit: "stretch", dim: 0, ...state.mapImage, url } : null);
                           }} />
                  </label>
                  {state.mapImage && (
                    <>
                      <div className="tt-faction-pills">
                        <button className={"tt-faction-pill" + (state.mapImage.fit === "stretch" ? " active" : "")}
                                onClick={() => patchMapImage({ fit: "stretch" })}
                                title="Squash or stretch the picture to fill the board exactly">Stretch to board</button>
                        <button className={"tt-faction-pill" + (state.mapImage.fit === "cover" ? " active" : "")}
                                onClick={() => patchMapImage({ fit: "cover" })}
                                title="Keep the picture's shape and crop the edges that overhang the board">Fill and crop</button>
                      </div>
                      <label className="tt-map-field">Darken {Math.round(state.mapImage.dim * 100)}%
                        <input type="range" min={0} max={0.8} step={0.05} value={state.mapImage.dim}
                               onChange={(e) => patchMapImage({ dim: Number(e.target.value) })} />
                      </label>
                    </>
                  )}
                  {mapNote && <p className="muted small">{mapNote}</p>}
                  <p className="muted small">The picture is laid under the board as the map, for every player and in 3D. A pasted link only shows in 3D if its host allows it.</p>
                </section>

                <MissionSection state={state} onCommit={commit} />

                <section>
                  <h3>Deployment zones</h3>
                  {state.mission && <p className="muted small">The mission's Territories are shown. Pick a preset to use it instead.</p>}
                  <div className="tt-faction-pills">
                    <button className={"tt-faction-pill" + (!state.mission && state.deployment === null ? " active" : "")}
                            onClick={() => commit({ ...state, mission: null, deployment: null })}>
                      None
                    </button>
                    {(Object.keys(DEPLOYMENTS) as DeploymentKey[]).map((k) => (
                      <button key={k}
                              className={"tt-faction-pill" + (!state.mission && state.deployment === k ? " active" : "")}
                              onClick={() => commit({ ...state, mission: null, deployment: k })}>
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
                      <span className="tt-tok-name">Wounds <InfoDot title="Wound token" text={WOUND_INFO} url={WOUND_URL} /></span>
                      <div className="tt-counter-controls">
                        <button onClick={() => updateSelectedToken({ wounds: Math.max(0, (selectedToken.wounds ?? 0) - 1) })}>−</button>
                        <b>{selectedToken.wounds ?? 0}</b>
                        <button onClick={() => updateSelectedToken({ wounds: (selectedToken.wounds ?? 0) + 1 })}>+</button>
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
                    <StatusTokenPanel state={state} token={selectedToken} readOnly={readOnly} onCommit={commit}
                                      rank={selectedToken.unitId ? unitById(selectedToken.unitId)?.rank : undefined} />
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
                    <label title="How high the unit hovers or flies, in inches. It clears terrain this tall or shorter, and stands on floating terrain it reaches (see the 3D view).">
                      Hover / fly height (in)
                      <input type="number" min={0} max={24} step={0.5} value={selectedToken.elevation ?? 0}
                             onChange={(e) => updateSelectedToken({ elevation: Math.max(0, Number(e.target.value) || 0) || undefined })} />
                    </label>
                    <ModelField
                      model={selectedToken.modelId ? state.models?.[selectedToken.modelId] : undefined}
                      busy={modelBusy} msg={modelMsg} disabled={readOnly}
                      onUpload={() => modelFileRef.current?.click()}
                      onClear={() => clearModel(selectedToken.id)}
                      hint="Shown in the 3D view in place of the faction figure."
                    >
                      {sameUnitWithoutModel > 0 && !readOnly && (
                        <button className="ghost-btn" onClick={() => shareModelWithUnit(selectedToken)}>
                          Use on {sameUnitWithoutModel} more “{selectedToken.label}”
                        </button>
                      )}
                    </ModelField>
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

                    <SquadControls state={state} token={selectedToken} onCommit={commit} />

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
                    <label title="How tall the terrain stands, in inches. Hovering/flying units at or above this height pass over it.">
                      Height (in)
                      <input type="number" min={0} max={24} step={0.25} value={terrainElevation(selectedTerrain)}
                             onChange={(e) => updateSelectedTerrain({ elevation: Math.max(0, Number(e.target.value) || 0) })} />
                    </label>
                    <label title="Lift the piece off the table, in inches: floating rocks, gantries, upper floors. Units under it stay on the ground; a unit hovering at this height or higher stands on top (3D view).">
                      Floats (in)
                      <input type="number" min={0} max={48} step={0.25} value={selectedTerrain.float ?? 0}
                             onChange={(e) => updateSelectedTerrain({ float: Math.max(0, Number(e.target.value) || 0) || undefined })} />
                    </label>
                    <ModelField
                      model={selectedTerrain.modelId ? state.models?.[selectedTerrain.modelId] : undefined}
                      busy={modelBusy} msg={modelMsg} disabled={readOnly}
                      onUpload={() => modelFileRef.current?.click()}
                      onClear={() => clearModel(selectedTerrain.id)}
                      hint="Replaces the block in the 3D view, stretched to fill its width, depth and height."
                    />
                    <div className="tt-edit-actions">
                      <button onClick={duplicateSelected}>Duplicate</button>
                      <button className="danger" onClick={deleteSelected}>Delete</button>
                    </div>
                  </section>
                )}

                <section>
                  <div className="tt-init-head">
                    <h3>Log</h3>
                    {(state.log?.length ?? 0) > 0 && (
                      <button className="ghost-btn small" onClick={() => commit({ ...state, log: [] })}>Clear</button>
                    )}
                  </div>
                  <AuditLogView log={state.log} onReplay={showGhost} />
                </section>

                <section>
                  <h3>Board</h3>
                  <div className="tt-edit-actions">
                    <button onClick={resetGame}>Reset game</button>
                    <button className="danger" onClick={() => { if (confirm("Remove every token and terrain piece from the board?")) commit({ ...state, terrain: [], tokens: [] }); }}>Clear board</button>
                  </div>
                </section>

                <p className="muted small tt-hint">
                  Drag pieces with mouse or finger; pinch or scroll to zoom; shift-drag or <b>Pan</b> to move the view.
                  Double-click a token to mark it activated. Pick a Move template <b>1/2/3</b> while a token is selected; drag joint dots to bend, then <b>Apply</b>. Use <b>Start squad</b> / <b>Join squad</b> to base lock units to a leader: the leader drags the squad, members stay in contact.
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

// Squad section of the token inspector: start a squad, join one, or manage
// the squad this token is in. Squads are base locked (see lib/squads).
function SquadControls({ state, token, onCommit }: {
  state: TabletopState;
  token: Token;
  onCommit: (s: TabletopState) => void;
}) {
  const squads = listSquads(state.tokens);
  if (!token.squadId) {
    return (
      <div className="tt-squad">
        <span className="tt-counter-label">Squad</span>
        <div className="tt-edit-actions">
          <button onClick={() => onCommit(startSquad(state, token.id))}>Start squad</button>
          {squads.length > 0 && (
            <select value="" aria-label="Join squad"
                    onChange={(e) => { if (e.target.value) onCommit(joinSquad(state, token.id, e.target.value)); }}>
              <option value="">Join squad…</option>
              {squads.map((sq) => (
                <option key={sq.id} value={sq.id}>{sq.leader.label || "Squad"} ({sq.members.length})</option>
              ))}
            </select>
          )}
        </div>
      </div>
    );
  }
  const members = squadMembers(state.tokens, token.squadId);
  const leader = members.find((m) => m.squadLead) ?? members[0]!;
  const loose = unlockedIds(members);
  return (
    <div className="tt-squad">
      <span className="tt-counter-label">Squad</span>
      <p className="tt-squad-status">
        {token.squadLead
          ? <>★ Leader of {members.length}</>
          : <>Member of {leader.label || "the leader"}'s squad ({members.length})</>}
        {" · "}
        {loose.size === 0
          ? <span className="tt-squad-ok">Base locked</span>
          : <span className="tt-squad-bad">{loose.size} out of contact</span>}
      </p>
      <div className="tt-edit-actions">
        {!token.squadLead && <button onClick={() => onCommit(makeLeader(state, token.id))}>Make leader</button>}
        {loose.size > 0 && <button onClick={() => onCommit(regroupSquad(state, token.squadId!))}>Regroup</button>}
        <button onClick={() => onCommit(leaveSquad(state, token.id))}>Leave</button>
        <button onClick={() => onCommit(disbandSquad(state, token.squadId!))}>Disband</button>
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
  preferredColor: PlayerColor;
  onPreferredColorChange: (c: PlayerColor) => void;
  colorNote: string | null;
  wantPrivate: boolean;
  onWantPrivateChange: (v: boolean) => void;
  onHost: () => void;
  onJoin: () => void;
  onChangeColor: (c: PlayerColor) => void;
  onRename: (name: string) => void;
  onLeave: () => void;
  onClosePanel: () => void;
  ai: AiInvitesState;
}) {
  const {
    online, joinCode, onJoinCodeChange, playerName, onNameChange,
    preferredColor, onPreferredColorChange, colorNote, wantPrivate, onWantPrivateChange,
    onHost, onJoin, onChangeColor, onRename, onLeave, onClosePanel, ai,
  } = props;
  const connected = online?.status === "open";
  const connecting = online && (online.status === "connecting" || online.status === "reconnecting");
  const failed = online && (online.status === "error" || online.status === "closed");
  // A whole AI code in the join box joins as that AI, which needs no name.
  const joinAsAi = !!parseAiCode(joinCode);
  const nameOk = playerName.trim().length > 0 || joinAsAi;
  const amAi = !!online?.you?.ai;
  // Colors held by OTHER players — used to disable those swap buttons.
  const takenByOthers = new Set(
    (online?.peers ?? [])
      .filter((p) => p.id !== online?.you?.id)
      .map((p) => p.color),
  );

  // Whether this page is already served by the multiplayer-capable site.
  // If not (e.g. the static GitHub Pages mirror), surface a button to jump
  // there — carrying any ?room= code along so an invite still lands.
  const onPlaySite = roomsAvailableHere();
  function openPlaySite() {
    const code = online?.code ?? new URLSearchParams(location.search).get("room") ?? "";
    window.open(legionPlayUrl(code || undefined), "_blank", "noopener");
  }

  const shareUrl = online?.code ? legionPlayUrl(online.code) : "";

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
              {(["blue", "red", "spectator"] as const).map((c) => (
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

          <label className="tt-online-check">
            <input type="checkbox" checked={wantPrivate}
                   onChange={(e) => onWantPrivateChange(e.target.checked)} />
            Private game (hide from the public Live games list)
          </label>
          <button className="pdf-run-btn" onClick={onHost} disabled={!nameOk}>
            Host a new game
          </button>
          <div className="tt-online-join">
            <input
              type="text"
              placeholder="CODE"
              value={joinCode}
              maxLength={40}
              className={joinAsAi ? "ai-code" : undefined}
              onChange={(e) => onJoinCodeChange(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter" && nameOk) onJoin(); }}
            />
            <button onClick={onJoin} disabled={joinCode.trim().length < 4 || !nameOk}>{joinAsAi ? "Join as AI" : "Join"}</button>
          </div>
          {joinAsAi && <p className="muted small">That's an AI invite code: you'll join as the AI it admits, to see what it can do.</p>}
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
            {connected && online.isPrivate && (
              <span className="tt-online-private" title="Hidden from the public Live games list">🔒 Private</span>
            )}
          </div>

          {connected && !amAi && (
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
                  {(["blue", "red", "spectator"] as const).map((c) => {
                    const isMine = online.you?.color === c;
                    // Spectator is shared (many allowed); blue/red are exclusive.
                    const taken = c !== "spectator" && takenByOthers.has(c);
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
                  {p.ai && <> <span className="ai-tag">AI</span></>}
                  {online.you?.id === p.id && " (you)"}
                </span>
              ))
            )}
          </div>

          {connected && !amAi && <AiInvitePanel app="legion" ai={ai} you={online.you} peers={online.peers} />}

          {failed && online.error && <p className="muted small tt-online-warn">{online.error}</p>}
          {failed && !online.error && (
            <p className="muted small tt-online-note">
              Couldn't reach the room server. Remote play only works on the
              Worker deployment — if you're on the static site, reopen the app
              from the Worker URL. Retrying automatically…
            </p>
          )}

          <button className="danger" onClick={onLeave}>{amAi ? "Leave AI preview" : "Leave game"}</button>
        </>
      )}
    </div>
  );
}

// STL upload row shared by the unit and terrain inspectors.
function ModelField({ model, busy, msg, disabled, onUpload, onClear, hint, children }: {
  model: { name: string; data: string } | undefined;
  busy: boolean;
  msg: string | null;
  disabled: boolean;
  onUpload: () => void;
  onClear: () => void;
  hint: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="tt-model-field">
      <span className="tt-counter-label">3D model (STL)</span>
      <div className="tt-edit-actions">
        <button onClick={onUpload} disabled={busy || disabled}>
          {busy ? "Processing…" : model ? "Replace STL" : "Upload STL"}
        </button>
        {model && !disabled && <button className="ghost-btn" onClick={onClear}>Clear</button>}
        {children}
      </div>
      <span className="muted small">
        {msg ?? (model ? `${model.name} · ${Math.max(1, Math.round(model.data.length / 1024))} KB synced` : hint)}
      </span>
    </div>
  );
}
