import { useEffect, useRef, useState } from "react";
import {
  newDndTabletop, loadDndTabletop, saveDndTabletop, diffDnd,
  type DndTabletopState,
} from "./dndTabletop";
import { RoomClient, generateRoomCode, type RoomHandlers } from "../lib/roomClient";
import { appendLog, logId, type LogActor } from "../lib/auditLog";
import type { DndCharacter } from "./dndTypes";
import { loadCharacter } from "./dndStorage";
import {
  DndRoomCtx, rollId,
  type DndRoomValue, type OnlineState, type SharedRoll, type RollPayload, type SendRollOpts,
} from "./dndRoom";
import {
  clearSeatToken, deniedText, readSeatToken, writeSeatToken,
  type CampaignInvite, type DmNotice, type IncomingRollRequest, type LinkedCampaign,
  type OutgoingRollRequest, type RollRequest,
} from "./dndProtocol";
import { bestCodeFor } from "./campaignKeyring";
import type { DndToken } from "./dndTabletop";
import { useSessionChat } from "../components/useSessionChat";
import { useAiInvites } from "../components/useAiInvites";
import { AI_DENIED_TEXT, aiCodeFromUrl, parseAiCode } from "../lib/aiInvite";

const NAME_KEY = "dnd.playername";
const COLOR_KEY = "dnd.playercolor";
const PRIVATE_KEY = "dnd.privategame";
// The uploaded avatar image itself (small data URL). Kept in localStorage
// (not just the synced board) so it survives a reconnect — connection ids
// are per-socket, so the board's `avatars` entry for an old id goes stale
// the moment you rejoin; this lets it be silently reapplied under the new
// id instead of forcing a re-upload every time.
const AVATAR_KEY = "dnd.myavatar";
// Which saved sheet I last shared with a game, so it can be re-shared under
// my new connection id after a reconnect (same churn problem as avatars).
const ATTACHED_KEY = "dnd.attachedChar";
// My own board, parked while I'm in a game (joining replaces the local
// board with the room's) and restored when I leave.
const SOLO_KEY = "dnd.tabletop.solo.v1";
// DM: tokens set aside off-board until revealed (only on this device).
const STAGED_KEY = "dnd.staged.v1";
const DEFAULT_COLOR = "#4a86c8";

function readStaged(): DndToken[] {
  try {
    const raw = localStorage.getItem(STAGED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as DndToken[]) : [];
  } catch {
    return [];
  }
}

export function DndRoomProvider({ children }: { children: React.ReactNode }) {
  const [state, setStateRaw] = useState<DndTabletopState>(() => loadDndTabletop() ?? newDndTabletop());
  const hasRoomParam = new URLSearchParams(location.search).has("room");
  const [online, setOnline] = useState<OnlineState | null>(null);
  const [onlineOpen, setOnlineOpen] = useState(hasRoomParam);
  // An AI invite link (?ai=<code>) fills the join box with the whole code.
  const [joinCode, setJoinCode] = useState(() => aiCodeFromUrl() ?? new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "");
  const [playerName, setPlayerName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [playerColor, setPlayerColor] = useState(() => localStorage.getItem(COLOR_KEY) ?? DEFAULT_COLOR);
  const [spectator, setSpectator] = useState(false);
  // Only meaningful when hosting — a joiner connects into whatever privacy
  // the host already chose. Remembered so the checkbox keeps your last pick.
  const [wantPrivate, setWantPrivate] = useState(() => localStorage.getItem(PRIVATE_KEY) === "1");
  const [myAvatarUrl, setMyAvatarUrl] = useState<string | null>(() => localStorage.getItem(AVATAR_KEY));
  const [rollFeed, setRollFeed] = useState<SharedRoll[]>([]);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  // DM seat & campaign (protocol 2).
  const [proto, setProto] = useState(1);
  const [linkedCampaign, setLinkedCampaign] = useState<LinkedCampaign | null>(null);
  const [dmNotice, setDmNotice] = useState<DmNotice | null>(null);
  const [campaignInvites, setCampaignInvites] = useState<CampaignInvite[]>([]);
  const [dmRollPublic, setDmRollPublic] = useState(false);
  const [outgoingRequests, setOutgoingRequests] = useState<OutgoingRollRequest[]>([]);
  const [rollRequests, setRollRequests] = useState<IncomingRollRequest[]>([]);
  const [staged, setStagedState] = useState<DndToken[]>(readStaged);

  const roomRef = useRef<RoomClient<DndTabletopState> | null>(null);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const remoteEchoRef = useRef<string | null>(null);
  const appliedRemoteRef = useRef<string | null>(null);
  const readOnlyRef = useRef(false);
  const diffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // replaceBoard() summary awaiting the next diff pass.
  const replaceSummaryRef = useRef<string | null>(null);
  // Host intent, read by onWelcome when the new room has no state yet.
  const hostBlankRef = useRef(false);
  // Campaign code to run (claim the DM seat + link) when hosting.
  const hostCampaignRef = useRef<string | null>(null);

  // The AI code this connection joined with (null for a person).
  const aiCodeRef = useRef<string | null>(null);
  const ai = useAiInvites(() => roomRef.current);
  // Watch-only as a spectator, or as an AI whose invite can't touch the board.
  const readOnly = online?.status === "open" && (online.you?.color === "spectator" || (!!online.you?.ai && !ai.self?.board));
  const chat = useSessionChat("dnd", () => roomRef.current, online?.code ?? null, online?.you ?? null, online?.status === "open");
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
      const summary = replaceSummaryRef.current;
      replaceSummaryRef.current = null;
      const entries = summary
        ? [{ id: logId(), ts: Date.now(), actor: actorRef.current, kind: "misc" as const, text: summary }]
        : diffDnd(prev, state, actorRef.current);
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
    // An AI (or my preview of one) never wears my avatar.
    if (!id || !myAvatarUrl || aiCodeRef.current) return;
    const t = setTimeout(() => {
      setStateRaw((s) => {
        if (s.avatars?.[id] === myAvatarUrl) return s;
        return { ...s, avatars: { ...(s.avatars ?? {}), [id]: myAvatarUrl } };
      });
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online?.you?.id]);

  // Re-share my last-shared sheet under a fresh connection id, unless I'm
  // spectating or it was deleted.
  useEffect(() => {
    const you = online?.status === "open" ? online.you : null;
    if (!you || aiCodeRef.current) return;
    const t = setTimeout(() => {
      if (readOnlyRef.current) return;
      let charId: string | null = null;
      try { charId = localStorage.getItem(ATTACHED_KEY); } catch { /* storage unavailable */ }
      const character = charId ? loadCharacter(charId) : undefined;
      if (!character) return;
      setStateRaw((s) => {
        if (s.profiles?.[you.id]) return s;
        return {
          ...s,
          profiles: {
            ...(s.profiles ?? {}),
            [you.id]: { name: you.name, color: you.color === "spectator" ? "#8b94a8" : you.color, charId: character.id, character },
          },
        };
      });
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online?.you?.id]);

  function buildHandlers(): RoomHandlers<DndTabletopState> {
    return {
      ...chat.handlers,
      // A refusal's reason (onDenied) outlives the close that follows it.
      onStatus: (status, detail) => setOnline((o) => (o ? { ...o, status, error: detail ?? (status === "closed" ? o.error : undefined) } : o)),
      onDenied: (reason) => setOnline((o) => (o ? {
        ...o, status: "error",
        error: AI_DENIED_TEXT[reason] ?? "That code belongs to a Legion game. Use a different code.",
      } : o)),
      onWelcome: (you, remoteState, peers, extra) => {
        const client = roomRef.current;
        const code = client?.code ?? "";
        chat.onWelcome(code, extra);
        ai.onWelcome(extra);
        setOnline({ status: "open", code, you, peers, isPrivate: client?.isPrivate ?? false });
        const p = typeof extra.proto === "number" ? extra.proto : 1;
        setProto(p);
        const linked = (extra.campaign && typeof extra.campaign === "object") ? extra.campaign as LinkedCampaign : null;
        setLinkedCampaign(linked);
        // An AI's seat comes from its invite (the server seats an AI DM).
        if (client && p >= 2 && !aiCodeRef.current) {
          // Back in the DM seat after a reload / dropped connection, or
          // take it now if I'm hosting a campaign.
          const token = readSeatToken(code);
          const hostCode = hostCampaignRef.current;
          hostCampaignRef.current = null;
          if (token) {
            client.sendApp({ t: "claimDm", token, code: (linked && bestCodeFor(linked.id, "codm")) || undefined });
          } else if (hostCode) {
            client.sendApp({ t: "claimDm", code: hostCode, link: true });
          }
        }
        if (remoteState) {
          const js = JSON.stringify(remoteState);
          remoteEchoRef.current = js;
          appliedRemoteRef.current = js;
          setStateRaw(remoteState);
        } else {
          // New room: seed it from my board, or from a blank one if asked
          // (so DM prep on my local board isn't shown to players).
          const seed = hostBlankRef.current ? newDndTabletop() : stateRef.current;
          hostBlankRef.current = false;
          const js = JSON.stringify(seed);
          remoteEchoRef.current = js;
          if (seed !== stateRef.current) { appliedRemoteRef.current = js; setStateRaw(seed); }
          roomRef.current?.sendState(seed);
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
      onAppMessage: (msg) => {
        if (ai.handle(msg)) {
          // e.g. revoking the AI DM's code: the "seat went to the AI" note is done.
          if (msg.t === "aiInvites") setDmNotice(null);
          return;
        }
        const code = roomRef.current?.code ?? "";
        switch (msg.t) {
          case "stateRejected": {
            const mb = (n: unknown) => (Number(n) / 1_000_000).toFixed(1);
            setSyncWarning(`The board is too large to sync (${mb(msg.bytes)} MB of ${mb(msg.max)} MB) — your last change didn't reach the table. Try a smaller map image or fewer token icons.`);
            break;
          }
          case "dmGranted":
            if (typeof msg.token === "string") writeSeatToken(code, msg.token);
            setDmNotice(null);
            break;
          case "dmRevoked":
            clearSeatToken(code);
            if (msg.reason === "moved") setDmNotice({ kind: "err", text: "The DM seat moved to your other tab or device." });
            if (msg.reason === "ai") setDmNotice({ kind: "err", text: "An AI joined with your DM invite and took the DM seat. Revoke its code to take the seat back." });
            break;
          case "opDenied":
            setDmNotice({ kind: "err", text: deniedText(String(msg.op), String(msg.reason), typeof msg.retryAfterMs === "number" ? msg.retryAfterMs : undefined) });
            break;
          case "campaign":
            setLinkedCampaign(msg.campaign && typeof msg.campaign === "object" ? msg.campaign as LinkedCampaign : null);
            break;
          case "inviteSent":
            setDmNotice({ kind: "ok", text: `Invited ${Number(msg.count) || 0} player${Number(msg.count) === 1 ? "" : "s"} to the campaign.` });
            break;
          case "rollRequest": {
            const req = msg.req as RollRequest | undefined;
            if (!req || typeof req.id !== "string") break;
            const incoming: IncomingRollRequest = { ...req, from: String(msg.from ?? ""), fromName: String(msg.fromName ?? "DM"), receivedAt: Date.now() };
            setRollRequests((rs) => (rs.some((r) => r.id === req.id) ? rs : [incoming, ...rs].slice(0, 8)));
            break;
          }
          case "campaignInvite": {
            const inv = msg.invite as Omit<CampaignInvite, "from"> | undefined;
            if (!inv || typeof inv.code !== "string" || !inv.code) break;
            const full: CampaignInvite = { ...inv, from: String(msg.from ?? "DM") };
            setCampaignInvites((list) => [full, ...list.filter((x) => x.campaignId !== full.campaignId)]);
            break;
          }
        }
      },
      onDice: (id, _color, entry, vis) => {
        const r = entry as SharedRoll;
        if (!r || !r.id) return;
        // Trust the server's delivery (vis), not the sender's payload.
        const roll: SharedRoll = { ...r, fromId: id, vis: vis === "dm" ? "dm" : undefined };
        setRollFeed((f) => [roll, ...f].slice(0, 60));
      },
    };
  }

  function startRoom(code: string, aiCode: string | null = null) {
    aiCodeRef.current = aiCode;
    // An AI join (usually my own preview, in another tab) leaves my parked
    // board and saved identity alone — they belong to my own seat.
    if (!aiCode) {
      // Park my own board before the room's replaces it (only on the first
      // connect — a reload mid-game must not overwrite the parked one).
      try {
        if (!roomRef.current && !localStorage.getItem(SOLO_KEY)) {
          localStorage.setItem(SOLO_KEY, JSON.stringify(stateRef.current));
        }
      } catch { /* quota — the solo board just won't be restored */ }
      localStorage.setItem(NAME_KEY, playerName.trim() || "Player");
      localStorage.setItem(COLOR_KEY, playerColor);
      localStorage.setItem(PRIVATE_KEY, wantPrivate ? "1" : "0");
    }
    const name = playerName.trim() || "Player";
    roomRef.current?.close();
    remoteEchoRef.current = null;
    const identity = spectator ? "spectator" : playerColor;
    const client = new RoomClient<DndTabletopState>(code, name, identity, buildHandlers(), "dnd", wantPrivate && !aiCode, aiCode);
    roomRef.current = client;
    setOnline({ status: "connecting", code: client.code, you: null, peers: [] });
    client.connect();
  }
  function hostRoom(opts?: { blankBoard?: boolean; campaignCode?: string }) {
    if (!playerName.trim()) return;
    hostBlankRef.current = !!opts?.blankBoard;
    hostCampaignRef.current = opts?.campaignCode ?? null;
    startRoom(generateRoomCode());
  }
  function joinRoom() {
    const c = joinCode.trim().toUpperCase();
    // A whole AI code joins as that AI (no name needed: the invite has one).
    const asAi = parseAiCode(c);
    if (asAi) { startRoom(asAi.room, asAi.code); return; }
    if (c.length >= 4 && playerName.trim()) startRoom(c);
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
  function changeIdentity(spec: boolean, color: string) {
    setSpectator(spec);
    setPlayerColor(color);
    localStorage.setItem(COLOR_KEY, color);
    roomRef.current?.setColor(spec ? "spectator" : color);
  }
  function leaveRoom() {
    const client = roomRef.current;
    const wasAi = !!aiCodeRef.current;
    aiCodeRef.current = null;
    if (client) {
      if (online?.you?.dm) client.sendApp({ t: "releaseDm" });
      clearSeatToken(client.code);
    }
    ai.reset();
    if (wasAi) {
      // Drop the AI code from the address bar so a reload doesn't rejoin.
      const u = new URL(location.href);
      u.searchParams.delete("ai");
      history.replaceState(null, "", u.toString());
      if (joinCode.includes("-AI-")) setJoinCode(client?.code ?? "");
    }
    setProto(1);
    setLinkedCampaign(null);
    setRollRequests([]);
    setOutgoingRequests([]);
    setCampaignInvites([]);
    setDmNotice(null);
    chat.reset();
    roomRef.current?.close();
    roomRef.current = null;
    remoteEchoRef.current = null;
    setOnline(null);
    setSyncWarning(null);
    if (wasAi) return; // my own parked board stays parked for my own seat
    // Back to my own board.
    try {
      const raw = localStorage.getItem(SOLO_KEY);
      localStorage.removeItem(SOLO_KEY);
      if (raw) {
        const solo = { ...newDndTabletop(), ...(JSON.parse(raw) as Partial<DndTabletopState>), profiles: {}, avatars: {} };
        appliedRemoteRef.current = JSON.stringify(solo);
        setStateRaw(solo);
      }
    } catch { /* keep the room's board */ }
  }

  function replaceBoard(update: (s: DndTabletopState) => DndTabletopState, summary: string) {
    if (readOnlyRef.current) return;
    replaceSummaryRef.current = summary;
    setStateRaw(update);
  }

  const connected = online?.status === "open";
  const isDm = connected && !!online?.you?.dm;
  const dmPeer = connected ? online?.peers.find((p) => p.dm) ?? null : null;

  // Add a roll to my feed and share it as appropriate:
  //  - DM rolls are hidden by default: kept in the DM's own feed, never sent.
  //  - A player's secret roll (vis "dm") goes to the DM's socket only.
  //  - Everything else is broadcast to the table, as before.
  function sendRoll(payload: RollPayload, opts?: SendRollOpts) {
    const client = roomRef.current;
    const live = !!client && connected;
    const vis = live ? (opts?.vis ?? (isDm && !dmRollPublic ? "dm" : "table")) : "table";
    const roll: SharedRoll = {
      ...payload,
      id: rollId(), ts: Date.now(), actor: { name: actor.name, color: actor.color },
      ...(vis === "dm" ? { vis: "dm" as const } : {}),
      ...(opts?.requestId ? { requestId: opts.requestId } : {}),
      ...(opts?.dc != null ? { dc: opts.dc } : {}),
    };
    setRollFeed((f) => [roll, ...f].slice(0, 60));
    if (!live) return;
    if (vis === "dm") {
      if (isDm) return;
      if (proto >= 2 && dmPeer) client!.sendDice(roll, "dm");
      else setDmNotice({ kind: "err", text: deniedText("roll", "no-dm") });
      return;
    }
    client!.sendDice(roll);
  }

  // --- DM seat & campaign ---
  function claimDm(opts?: { code?: string }) {
    const client = roomRef.current;
    if (!client || !connected) return;
    setDmNotice(null);
    client.sendApp({
      t: "claimDm",
      token: readSeatToken(client.code) ?? undefined,
      code: opts?.code ?? ((linkedCampaign && bestCodeFor(linkedCampaign.id, "codm")) || undefined),
    });
  }
  function releaseDm() {
    const client = roomRef.current;
    if (!client) return;
    client.sendApp({ t: "releaseDm" });
    clearSeatToken(client.code);
  }
  function linkCampaign(code: string) { setDmNotice(null); roomRef.current?.sendApp({ t: "linkCampaign", code }); }
  function unlinkCampaign() { roomRef.current?.sendApp({ t: "unlinkCampaign" }); }
  function inviteToCampaign(playerCode: string) { setDmNotice(null); roomRef.current?.sendApp({ t: "campaignInvite", code: playerCode }); }

  function sendRollRequest(to: string[], req: Omit<RollRequest, "id" | "dc">, dc?: number, revealDc?: boolean) {
    const client = roomRef.current;
    if (!client || !isDm || to.length === 0) return;
    const full: RollRequest = { ...req, id: rollId(), ...(revealDc && dc != null ? { dc } : {}) };
    client.sendApp({ t: "rollRequest", to, req: full });
    setOutgoingRequests((list) => [{ req: full, dc, to, sentAt: Date.now() }, ...list].slice(0, 20));
  }

  function setStaged(next: DndToken[]) {
    setStagedState(next);
    try { localStorage.setItem(STAGED_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  }
  function stageTokens(tokens: DndToken[]) { setStaged([...staged, ...tokens]); }
  function revealStaged(id: string | "all") {
    const reveal = id === "all" ? staged : staged.filter((t) => t.id === id);
    if (reveal.length === 0 || readOnlyRef.current) return;
    setBoard((s) => ({ ...s, tokens: [...s.tokens, ...reveal.filter((t) => !s.tokens.some((x) => x.id === t.id))] }));
    setStaged(id === "all" ? [] : staged.filter((t) => t.id !== id));
  }
  function discardStaged(id: string | "all") { setStaged(id === "all" ? [] : staged.filter((t) => t.id !== id)); }
  function clearRolls() { setRollFeed([]); }

  // Attach (or clear) my character sheet to the shared board so everyone in
  // the game can view it. Keyed by my connection id; prunes profiles of
  // players no longer connected.
  const myId = online?.status === "open" ? online.you?.id ?? null : null;
  function attachCharacter(character: DndCharacter | null) {
    if (!myId || readOnlyRef.current) return;
    try {
      if (character) localStorage.setItem(ATTACHED_KEY, character.id);
      else localStorage.removeItem(ATTACHED_KEY);
    } catch { /* storage unavailable */ }
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
    state, setBoard, replaceBoard, readOnly: !!readOnly, actor,
    syncWarning, clearSyncWarning: () => setSyncWarning(null),
    online, onlineOpen, setOnlineOpen, joinCode, setJoinCode,
    playerName, setPlayerName, playerColor, spectator,
    wantPrivate, setWantPrivate,
    myAvatarUrl, setMyAvatar,
    hostRoom, joinRoom, leaveRoom, changeIdentity,
    rollFeed, sendRoll, clearRolls,
    myId, profiles: state.profiles ?? {}, attachCharacter,
    avatars: state.avatars ?? {},
    proto, isDm, dmPeer, claimDm, releaseDm,
    dmNotice, clearDmNotice: () => setDmNotice(null),
    linkedCampaign, linkCampaign, unlinkCampaign, inviteToCampaign,
    campaignInvites, dismissInvite: (id) => setCampaignInvites((l) => l.filter((x) => x.campaignId !== id)),
    dmRollPublic, setDmRollPublic,
    sendRollRequest, outgoingRequests, clearOutgoingRequests: () => setOutgoingRequests([]),
    rollRequests, dismissRollRequest: (id) => setRollRequests((l) => l.filter((x) => x.id !== id)),
    staged, stageTokens, revealStaged, discardStaged,
    chat, ai,
  };
  return <DndRoomCtx.Provider value={value}>{children}</DndRoomCtx.Provider>;
}
