import { useEffect, useMemo, useRef, useState } from "react";
import type { Peer, RoomApp, RoomClient, RoomHandlers } from "../lib/roomClient";

type ChatTransport = Pick<RoomClient<unknown>, "sendChat" | "requestChatHistory">;
import {
  CHAT_MAX_CHARS, chatCid, mergeChat, parseChatMessage, saveChatArchive,
  type ChatMessage, type ChatRole,
} from "../lib/chat";

// The session chat for one tabletop's room connection. The app owns the
// RoomClient; it spreads `handlers` into the client's handlers and calls
// `onWelcome` from its own welcome handler. Everything here only touches
// setters and refs, so handlers built once at connect time stay valid.

type ChatHandlers = Pick<RoomHandlers<unknown>, "onChat" | "onChatHistory" | "onChatDenied">;

export type SessionChat = {
  app: RoomApp;
  code: string | null;
  connected: boolean;
  messages: ChatMessage[];
  /** Older messages exist on the server beyond those loaded. */
  more: boolean;
  loadingOlder: boolean;
  /** Newest seq in the backlog sent on joining (not counted as unread). */
  joinSeq: number;
  notice: string | null;
  send: (text: string) => void;
  loadOlder: () => void;
  /** Page in the whole stored log (for a download). */
  fetchAll: () => Promise<ChatMessage[]>;
  handlers: ChatHandlers;
  onWelcome: (code: string, extra: Record<string, unknown>) => void;
  /** Clear the live log (leaving a game). The archive is kept. */
  reset: () => void;
};

const HISTORY_TIMEOUT_MS = 6000;

function roleOf(you: Peer): ChatRole {
  if (you.dm) return "dm";
  return you.color === "spectator" ? "spectator" : "player";
}

export function useSessionChat(
  app: RoomApp,
  getClient: () => ChatTransport | null,
  code: string | null,
  you: Peer | null,
  connected: boolean,
): SessionChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [more, setMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [joinSeq, setJoinSeq] = useState(0);
  const codeRef = useRef<string | null>(null);
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  // fetchAll() waits on history replies; each resolves the oldest waiter.
  const waitersRef = useRef<((page: { messages: ChatMessage[]; more: boolean }) => void)[]>([]);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flash(text: string) {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }

  const handlers = useMemo<ChatHandlers>(() => ({
    onChat: (raw) => {
      const m = parseChatMessage(raw);
      if (!m) return;
      setMessages((list) => {
        // My own echo replaces its pending copy.
        const rest = m.cid ? list.filter((x) => !(x.seq == null && x.cid === m.cid)) : list;
        const pending = rest.filter((x) => x.seq == null);
        return [...mergeChat(rest.filter((x) => x.seq != null), [m]), ...pending];
      });
    },
    onChatHistory: (raw, hasMore) => {
      const page = raw.map(parseChatMessage).filter((m): m is ChatMessage => !!m);
      setLoadingOlder(false);
      const waiter = waitersRef.current.shift();
      if (waiter) { waiter({ messages: page, more: hasMore }); return; }
      setMore(hasMore);
      setMessages((list) => [...mergeChat(list.filter((x) => x.seq != null), page), ...list.filter((x) => x.seq == null)]);
    },
    onChatDenied: (cid, reason, retryAfterMs) => {
      const why = reason === "rate"
        ? `Slow down — try again in ${Math.ceil((retryAfterMs ?? 1000) / 1000)}s.`
        : "The message wasn't sent.";
      setMessages((list) => list.map((x) => (x.seq == null && x.cid === cid ? { ...x, pending: false, failed: why } : x)));
      flash(why);
    },
  }), []);

  function onWelcome(roomCode: string, extra: Record<string, unknown>) {
    const backlog = (Array.isArray(extra.chat) ? extra.chat : [])
      .map(parseChatMessage).filter((m): m is ChatMessage => !!m);
    const sameRoom = codeRef.current === roomCode;
    codeRef.current = roomCode;
    setMore(extra.chatMore === true);
    setLoadingOlder(false);
    setJoinSeq(backlog.length ? backlog[backlog.length - 1]!.seq! : 0);
    waitersRef.current = [];
    // A reconnect to the same game keeps what was loaded; a new game starts
    // clean. Lines still pending were lost with the old socket.
    setMessages((list) => mergeChat(sameRoom ? list.filter((x) => x.seq != null) : [], backlog));
  }

  function reset() {
    codeRef.current = null;
    waitersRef.current = [];
    setMessages([]);
    setMore(false);
    setLoadingOlder(false);
    setNotice(null);
  }

  function send(raw: string) {
    const text = raw.trim().slice(0, CHAT_MAX_CHARS);
    if (!text || !you) return;
    const cid = chatCid();
    const client = getClient();
    if (!client || !connected || !client.sendChat(text, cid)) { flash("Not connected — the message wasn't sent."); return; }
    const mine: ChatMessage = {
      ts: Date.now(), text, cid, pending: true,
      from: { id: you.id, name: you.name, color: you.color, role: roleOf(you), kind: you.ai ? "ai" : "human" },
    };
    setMessages((list) => [...list, mine]);
  }

  function oldestSeq(list: ChatMessage[]): number | null {
    for (const m of list) if (m.seq != null) return m.seq;
    return null;
  }

  function loadOlder() {
    const client = getClient();
    if (!client || !connected || loadingOlder || !more) return;
    setLoadingOlder(true);
    client.requestChatHistory(oldestSeq(messagesRef.current), 100);
  }

  async function fetchAll(): Promise<ChatMessage[]> {
    let all = messagesRef.current.filter((m) => m.seq != null);
    const client = getClient();
    if (!client || !connected || !more || loadingOlder) return all;
    let before = oldestSeq(all);
    setLoadingOlder(true);
    for (let guard = 0; guard < 20; guard++) {
      const page = await new Promise<{ messages: ChatMessage[]; more: boolean } | null>((resolve) => {
        const timer = setTimeout(() => {
          waitersRef.current = waitersRef.current.filter((w) => w !== done);
          resolve(null);
        }, HISTORY_TIMEOUT_MS);
        const done = (p: { messages: ChatMessage[]; more: boolean }) => { clearTimeout(timer); resolve(p); };
        waitersRef.current.push(done);
        client.requestChatHistory(before, 200);
      });
      if (!page) break;
      all = mergeChat(all, page.messages);
      if (!page.more || page.messages.length === 0) {
        setMore(false);
        break;
      }
      before = page.messages[0]!.seq ?? null;
    }
    setLoadingOlder(false);
    setMessages((list) => [...mergeChat(list.filter((x) => x.seq != null), all), ...list.filter((x) => x.seq == null)]);
    return all;
  }

  // Keep a copy on this device so the log can be recalled after leaving.
  useEffect(() => {
    if (!code) return;
    const t = setTimeout(() => saveChatArchive(app, code, messages), 600);
    return () => clearTimeout(t);
  }, [app, code, messages]);

  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  return {
    app, code, connected, messages, more, loadingOlder, joinSeq, notice,
    send, loadOlder, fetchAll, handlers, onWelcome, reset,
  };
}

const OPEN_KEY = "chat.dock.open";

function readOpen(app: string): boolean {
  try { return localStorage.getItem(`${OPEN_KEY}.${app}`) === "1"; } catch { return false; }
}

export type ChatToggle = { open: boolean; setOpen: (v: boolean) => void; unread: number };

/** Open/closed state of the chat window (remembered per app) and the count
 * of others' lines that arrived while it was closed. */
export function useChatToggle(chat: SessionChat, myId: string | null): ChatToggle {
  const [open, setOpenRaw] = useState(() => readOpen(chat.app));
  const [seen, setSeen] = useState<{ code: string | null; seq: number }>({ code: null, seq: 0 });
  const seenSeq = seen.code === chat.code ? seen.seq : 0;

  const confirmed = chat.messages.filter((m) => m.seq != null);
  const lastSeq = confirmed.length ? confirmed[confirmed.length - 1]!.seq! : 0;
  const since = Math.max(seenSeq, chat.joinSeq);
  const unread = open ? 0 : confirmed.filter((m) => m.seq! > since && m.from.id !== myId).length;

  function setOpen(v: boolean) {
    setOpenRaw(v);
    if (v) setSeen({ code: chat.code, seq: lastSeq });
    try { localStorage.setItem(`${OPEN_KEY}.${chat.app}`, v ? "1" : "0"); } catch { /* storage unavailable */ }
  }

  // While open, everything is seen.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setSeen({ code: chat.code, seq: lastSeq }), 0);
    return () => clearTimeout(t);
  }, [open, lastSeq, chat.code]);

  return { open, setOpen, unread };
}
