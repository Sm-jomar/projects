import { useEffect, useRef, useState } from "react";
import {
  newDndTabletop, loadDndTabletop, saveDndTabletop, diffDnd,
  type DndTabletopState,
} from "./dndTabletop";
import { RoomClient, generateRoomCode, type RoomHandlers } from "../lib/roomClient";
import { appendLog, type LogActor } from "../lib/auditLog";
import type { DndCharacter } from "./dndTypes";
import {
  DndRoomCtx, rollId,
  type DndRoomValue, type OnlineState, type SharedRoll, type RollPayload,
} from "./dndRoom";

const NAME_KEY = "dnd.playername";
const COLOR_KEY = "dnd.playercolor";
const PRIVATE_KEY = "dnd.privategame";
// The uploaded avatar image itself (small data URL). Kept in localStorage
// (not just the synced board) so it survives a reconnect — connection ids
// are per-socket, so the board's `avatars` entry for an old id goes stale
// the moment you rejoin; this lets it be silently reapplied under the new
// id instead of forcing a re-upload every time.
const AVATAR_KEY = "dnd.myavatar";
const DEFAULT_COLOR = "#4a86c8";

export function DndRoomProvider({ children }: { children: React.ReactNode }) {
  const [state, setStateRaw] = useState<DndTabletopState>(() => loadDndTabletop() ?? newDndTabletop());
  const hasRoomParam = new URLSearchParams(location.search).has("room");
  const [online, setOnline] = useState<OnlineState | null>(null);
  const [onlineOpen, setOnlineOpen] = useState(hasRoomParam);
  const [joinCode, setJoinCode] = useState(() => new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "");
  const [playerName, setPlayerName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [playerColor, setPlayerColor] = useState(() => localStorage.getItem(COLOR_KEY) ?? DEFAULT_COLOR);
  const [spectator, setSpectator] = useState(false);
  // Only meaningful when hosting — a joiner connects into whatever privacy
  // the host already chose. Remembered so the checkbox keeps your last pick.
  const [wantPrivate, setWantPrivate] = useState(() => localStorage.getItem(PRIVATE_KEY) === "1");
  const [myAvatarUrl, setMyAvatarUrl] = useState<string | null>(() => localStorage.getItem(AVATAR_KEY));
  const [rollFeed, setRollFeed] = useState<SharedRoll[]>([]);

  const roomRef = useRef<RoomClient<DndTabletopState> | null>(null);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const remoteEchoRef = useRef<string | null>(null);
  const appliedRemoteRef = useRef<string | null>(null);
  const readOnlyRef = useRef(false);
  const diffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const readOnly = online?.status === "open" && online.you?.color === "spectator";
  useEffect(() => { readOnlyRef.current = !!readOnly; }, [readOnly]);

  const actor: LogActor = online?.status === "open" && online.you
    ? { name: online.you.name, color: online.you.color === "spectator" ? "#8b94a8" : online.you.color }
    : { name: playerName.trim() || "You", color: playerColor };
  const actorRef = useRef(actor);
  useEffect(() => { actorRef.current = actor; });

  // Guarded board setter — spectators can't change the board.
  const setBoard: React.Dispatch<React.SetStateAction<DndTabletopState>> = (update) => {
    if (readOnlyRef.current) return;
    setStateRaw(update);
  };

  // Persist (debounced).
  useEffect(() => {
    const t = setTimeout(() => saveDndTabletop(state), 500);
    return () => clearTimeout(t);
  }, [state]);

  // Auto-log local changes by diffing (debounced so a drag logs one move).
  const prevRef = useRef(state);
  useEffect(() => {
    const curJson = JSON.stringify(state);
    if (appliedRemoteRef.current === curJson) { prevRef.current = state; return; }
    if (diffTimer.current) clearTimeout(diffTimer.current);
    diffTimer.current = setTimeout(() => {
      const prev = prevRef.current;
      prevRef.current = state;
      const entries = diffDnd(prev, state, actorRef.current);
      if (entries.length) setStateRaw((s) => ({ ...s, log: appendLog(s.log, entries) }));
    }, 350);
  }, [state]);

  // Push local board changes to the room.
  useEffect(() => {
    const client = roomRef.current;
    if (!client || online?.status !== "open" || readOnly) return;
    const js = JSON.stringify(state);
    if (js === remoteEchoRef.current) return;
    remoteEchoRef.current = js;
    client.sendState(state);
  }, [state, online?.status, readOnly]);

  // Close the socket when the whole D&D app unmounts.
  useEffect(() => () => roomRef.current?.close(), []);

  // Re-publish my locally-remembered avatar under a fresh connection id
  // (every reconnect gets a new one) so it doesn't silently vanish from
  // the shared board until you notice and re-upload.
  useEffect(() => {
    const id = online?.status === "open" ? online.you?.id : null;
    if (!id || !myAvatarUrl) return;
    const t = setTimeout(() => {
      setStateRaw((s) => {
        if (s.avatars?.[id] === myAvatarUrl) return s;
        return { ...s, avatars: { ...(s.avatars ?? {}), [id]: myAvatarUrl } };
      });
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online?.you?.id]);

  function buildHandlers(): RoomHandlers<DndTabletopState> {
    return {
      onStatus: (status, detail) => setOnline((o) => (o ? { ...o, status, error: detail } : o)),
      onDenied: () => setOnline((o) => (o ? { ...o, status: "error", error: "That code belongs to a Legion game. Use a different code." } : o)),
      onWelcome: (you, remoteState, peers) => {
        setOnline({ status: "open", code: roomRef.current?.code ?? "", you, peers, isPrivate: roomRef.current?.isPrivate ?? false });
        if (remoteState) {
          const js = JSON.stringify(remoteState);
          remoteEchoRef.current = js;
          appliedRemoteRef.current = js;
          setStateRaw(remoteState);
        } else {
          remoteEchoRef.current = JSON.stringify(stateRef.current);
          roomRef.current?.sendState(stateRef.current);
        }
      },
      onState: (remoteState) => {
        const js = JSON.stringify(remoteState);
        remoteEchoRef.current = js;
        appliedRemoteRef.current = js;
        setStateRaw(remoteState);
      },
      onPresence: (peers) => setOnline((o) => {
        if (!o) return o;
        const you = o.you ? peers.find((p) => p.id === o.you!.id) ?? o.you : o.you;
        return { ...o, peers, you };
      }),
      onDice: (_id, _color, entry) => {
        const r = entry as SharedRoll;
        if (r && r.id) setRollFeed((f) => [r, ...f].slice(0, 60));
      },
    };
  }

  function startRoom(code: string) {
    const name = playerName.trim() || "Player";
    localStorage.setItem(NAME_KEY, name);
    localStorage.setItem(COLOR_KEY, playerColor);
    localStorage.setItem(PRIVATE_KEY, wantPrivate ? "1" : "0");
    roomRef.current?.close();
    remoteEchoRef.current = null;
    const identity = spectator ? "spectator" : playerColor;
    const client = new RoomClient<DndTabletopState>(code, name, identity, buildHandlers(), "dnd", wantPrivate);
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

  // Add a roll to the shared feed and broadcast it if connected.
  function sendRoll(payload: RollPayload) {
    const roll: SharedRoll = { ...payload, id: rollId(), ts: Date.now(), actor: { name: actor.name, color: actor.color } };
    setRollFeed((f) => [roll, ...f].slice(0, 60));
    if (roomRef.current && online?.status === "open") roomRef.current.sendDice(roll);
  }
  function clearRolls() { setRollFeed([]); }

  // Attach (or clear) my character sheet to the shared board so everyone in
  // the game can view it. Keyed by my connection id; prunes profiles of
  // players no longer connected.
  const myId = online?.status === "open" ? online.you?.id ?? null : null;
  function attachCharacter(character: DndCharacter | null) {
    if (!myId) return;
    const you = online?.you;
    setBoard((s) => {
      const profiles = { ...(s.profiles ?? {}) };
      const peerIds = new Set((online?.peers ?? []).map((p) => p.id));
      for (const k of Object.keys(profiles)) if (!peerIds.has(k)) delete profiles[k];
      if (character && you) {
        profiles[myId] = {
          name: you.name,
          color: you.color === "spectator" ? "#8b94a8" : you.color,
          charId: character.id,
          character,
        };
      } else {
        delete profiles[myId];
      }
      return { ...s, profiles };
    });
  }

  // Upload (or clear) my avatar image. Stored locally so it survives
  // reconnects, and mirrored into the shared board (keyed by connection id,
  // same prune-on-roster-change pattern as attachCharacter) so everyone
  // else's party roster picks it up. Uses the raw setter (not setBoard) —
  // your own avatar is identity, not a board edit, so spectators can set
  // one too.
  function setMyAvatar(dataUrl: string | null) {
    if (dataUrl) localStorage.setItem(AVATAR_KEY, dataUrl);
    else localStorage.removeItem(AVATAR_KEY);
    setMyAvatarUrl(dataUrl);
    if (!myId) return;
    setStateRaw((s) => {
      const avatars = { ...(s.avatars ?? {}) };
      const peerIds = new Set((online?.peers ?? []).map((p) => p.id));
      for (const k of Object.keys(avatars)) if (!peerIds.has(k)) delete avatars[k];
      if (dataUrl) avatars[myId] = dataUrl;
      else delete avatars[myId];
      return { ...s, avatars };
    });
  }

  const value: DndRoomValue = {
    state, setBoard, readOnly: !!readOnly, actor,
    online, onlineOpen, setOnlineOpen, joinCode, setJoinCode,
    playerName, setPlayerName, playerColor, spectator,
    wantPrivate, setWantPrivate,
    myAvatarUrl, setMyAvatar,
    hostRoom, joinRoom, leaveRoom, changeIdentity,
    rollFeed, sendRoll, clearRolls,
    myId, profiles: state.profiles ?? {}, attachCharacter,
    avatars: state.avatars ?? {},
  };
  return <DndRoomCtx.Provider value={value}>{children}</DndRoomCtx.Provider>;
}
