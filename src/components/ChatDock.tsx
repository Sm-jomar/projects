import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CHAT_MAX_CHARS, authorBadge, deleteChatArchive, downloadChat, listChatArchives, loadChatArchive,
  type ChatArchive, type ChatAuthor, type ChatMessage,
} from "../lib/chat";
import type { SessionChat } from "./useSessionChat";
import "./chat.css";

// Floating session-chat window, shared by both tabletops. Collapsed it's a
// small button with an unread count; open it shows the live game chat, or
// the logs saved on this device from earlier games.

type Props = {
  chat: SessionChat;
  myId: string | null;
  /** Display color for an author (Legion maps its side names to colors). */
  colorOf?: (a: ChatAuthor) => string;
  className?: string;
};

const OPEN_KEY = "chat.dock.open";
const NO_MESSAGES: ChatMessage[] = [];

function readOpen(app: string): boolean {
  try { return localStorage.getItem(`${OPEN_KEY}.${app}`) === "1"; } catch { return false; }
}

function timeLabel(ts: number): string {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ChatDock({ chat, myId, colorOf, className }: Props) {
  const [open, setOpenRaw] = useState(() => readOpen(chat.app));
  const [view, setView] = useState<"live" | "saved">("live");
  const [archive, setArchive] = useState<ChatArchive | null>(null);
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  // Count of others' lines that arrived while the window was closed.
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

  // Stick to the bottom as lines arrive, unless the reader scrolled up.
  const listRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const prevFirstRef = useRef<number | undefined>(undefined);
  const prevHeightRef = useRef(0);
  const shown = view === "saved" ? archive?.messages ?? NO_MESSAGES : chat.messages;
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const first = shown[0]?.seq;
    if (prevFirstRef.current != null && first != null && first < prevFirstRef.current && !pinnedRef.current) {
      // Older lines were prepended: keep the reader's place.
      el.scrollTop += el.scrollHeight - prevHeightRef.current;
    } else if (pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevFirstRef.current = first;
    prevHeightRef.current = el.scrollHeight;
  }, [shown, open, view]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    prevHeightRef.current = el.scrollHeight;
    if (el.scrollTop < 30 && view === "live" && chat.more && !chat.loadingOlder) chat.loadOlder();
  }

  function submit() {
    if (!draft.trim()) return;
    chat.send(draft);
    setDraft("");
    pinnedRef.current = true;
  }

  async function download(format: "txt" | "json") {
    setMenu(false);
    if (view === "saved") {
      if (archive) downloadChat(chat.app, archive.code, archive.messages, format);
      return;
    }
    if (!chat.code) return;
    setBusy(true);
    try {
      const all = await chat.fetchAll();
      downloadChat(chat.app, chat.code, all, format);
    } finally {
      setBusy(false);
    }
  }

  const color = (a: ChatAuthor) => colorOf?.(a) ?? (/^#[0-9a-f]{6}$/i.test(a.color) ? a.color : "var(--muted)");
  const canDownload = view === "saved" ? !!archive?.messages.length : confirmed.length > 0;

  if (!open) {
    return (
      <div className={"chat-dock collapsed " + (className ?? "")}>
        <button className="chat-dock-toggle" onClick={() => setOpen(true)} title="Open the game chat">
          💬 Chat{unread > 0 && <span className="chat-unread">{unread > 99 ? "99+" : unread}</span>}
        </button>
      </div>
    );
  }

  return (
    <div className={"chat-dock " + (className ?? "")} role="dialog" aria-label="Game chat">
      <div className="chat-head">
        {view === "saved" ? (
          <>
            <button className="ghost-btn small" onClick={() => (archive ? setArchive(null) : setView("live"))}>‹ Back</button>
            <b className="chat-title">{archive ? `Saved · ${archive.code}` : "Saved chats"}</b>
          </>
        ) : (
          <b className="chat-title">
            Chat{chat.code ? ` · ${chat.code}` : ""}
            {chat.code && !chat.connected && <span className="chat-offline"> (offline)</span>}
          </b>
        )}
        <div className="chat-head-actions">
          {view === "live" && (
            <button className="ghost-btn small" onClick={() => { setView("saved"); setArchive(null); }}
                    title="Chat logs saved on this device from your games">Saved</button>
          )}
          <div className="chat-menu-wrap">
            <button className="ghost-btn small" disabled={!canDownload || busy} onClick={() => setMenu((v) => !v)}
                    title="Save this chat log to your computer">{busy ? "…" : "⤓"}</button>
            {menu && (
              <div className="chat-menu" onMouseLeave={() => setMenu(false)}>
                <button onClick={() => download("txt")}>Text file (.txt)</button>
                <button onClick={() => download("json")}>Data file (.json)</button>
              </div>
            )}
          </div>
          <button className="ghost-btn small" onClick={() => setOpen(false)} aria-label="Minimize chat">–</button>
        </div>
      </div>

      {view === "saved" && !archive ? (
        <SavedList app={chat.app} onOpen={(code) => setArchive(loadChatArchive(chat.app, code))} />
      ) : (
        <div className="chat-list" ref={listRef} onScroll={onScroll}>
          {view === "live" && chat.more && (
            <button className="ghost-btn small chat-older" disabled={chat.loadingOlder} onClick={chat.loadOlder}>
              {chat.loadingOlder ? "Loading…" : "Load earlier messages"}
            </button>
          )}
          {shown.length === 0 && (
            <p className="muted small chat-empty">
              {view === "saved" ? "This log is empty." : chat.code
                ? "No messages yet. Say hello to the table."
                : "Host or join a game to chat with the other players."}
            </p>
          )}
          {shown.map((m, i) => (
            <ChatLine key={m.seq ?? m.cid ?? i} m={m} mine={view === "live" && m.from.id === myId}
                      prev={shown[i - 1]} color={color(m.from)} />
          ))}
        </div>
      )}

      {view === "live" && (
        <form className="chat-input" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {chat.notice && <div className="chat-notice">{chat.notice}</div>}
          <textarea
            value={draft}
            maxLength={CHAT_MAX_CHARS}
            rows={2}
            disabled={!chat.connected}
            placeholder={chat.connected ? "Message the table — Enter to send, Shift+Enter for a new line" : "Not connected"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
              // Keep tabletop keyboard shortcuts from firing while typing.
              e.stopPropagation();
            }}
          />
          <button type="submit" disabled={!chat.connected || !draft.trim()}>Send</button>
        </form>
      )}
    </div>
  );
}

function ChatLine({ m, mine, prev, color }: { m: ChatMessage; mine: boolean; prev?: ChatMessage; color: string }) {
  // Consecutive lines from one author within a few minutes share a header.
  const grouped = !!prev && prev.from.id === m.from.id && prev.from.name === m.from.name && m.ts - prev.ts < 5 * 60_000;
  const badge = authorBadge(m.from);
  return (
    <div className={"chat-line" + (mine ? " mine" : "") + (m.pending ? " pending" : "") + (m.failed ? " failed" : "") + (grouped ? " grouped" : "")}>
      {!grouped && (
        <div className="chat-line-head">
          <span className="chat-dot" style={{ background: color }} />
          <b style={{ color }}>{m.from.name}</b>
          {badge && <span className={"chat-badge" + (m.from.kind === "ai" ? " ai" : "")}>{badge}</span>}
          <span className="chat-time" title={new Date(m.ts).toLocaleString()}>{timeLabel(m.ts)}</span>
        </div>
      )}
      <div className="chat-text">{m.text}</div>
      {m.failed && <div className="chat-failed">Not sent: {m.failed}</div>}
    </div>
  );
}

function SavedList({ app, onOpen }: { app: ChatArchive["app"]; onOpen: (code: string) => void }) {
  const [items, setItems] = useState(() => listChatArchives(app));
  if (items.length === 0) {
    return <p className="muted small chat-empty">No saved chats yet. Chat from your games is kept here on this device.</p>;
  }
  return (
    <ul className="chat-saved">
      {items.map((it) => (
        <li key={it.code}>
          <button className="chat-saved-open" onClick={() => onOpen(it.code)}>
            <b>Game {it.code}</b>
            <span className="muted small">{new Date(it.updatedAt).toLocaleString()} · {it.count} message{it.count === 1 ? "" : "s"}</span>
          </button>
          <button className="ghost-btn small" title="Delete this saved log from this device"
                  onClick={() => { deleteChatArchive(app, it.code); setItems(listChatArchives(app)); }}>✕</button>
        </li>
      ))}
    </ul>
  );
}
