// Session chat, shared by the Legion and D&D tabletops: the message shape
// the room server sends, a per-device archive of past games' chat (so a
// player can recall a log after leaving), and the text/JSON export used
// to save a log to their computer. Wire protocol: docs/session-chat.md.
import type { RoomApp } from "./roomClient";

export type ChatRole = "player" | "dm" | "spectator";
/** "human" today. Reserved: "ai", for an AI player or DM admitted later by
 * its own invite code — the UI already labels non-human authors. */
export type ChatAuthorKind = "human" | "ai";

export type ChatAuthor = { id: string; name: string; color: string; role: ChatRole; kind: ChatAuthorKind };
export type ChatMessage = {
  /** Server-assigned order within the room; absent while still pending. */
  seq?: number;
  ts: number;
  from: ChatAuthor;
  text: string;
  /** Sender's client id, used to match the server echo to a pending copy. */
  cid?: string;
  /** Local only: sent, not yet confirmed by the server. */
  pending?: boolean;
  /** Local only: the server refused it. */
  failed?: string;
};

export type ChatArchive = { app: RoomApp; code: string; updatedAt: number; messages: ChatMessage[] };

export const CHAT_MAX_CHARS = 1000;

// A confirmed message without its local-only fields (and, for export,
// without the sender's client id).
function stored(m: ChatMessage, keepCid: boolean): ChatMessage {
  const out: ChatMessage = { seq: m.seq, ts: m.ts, from: m.from, text: m.text };
  if (keepCid && m.cid) out.cid = m.cid;
  return out;
}

const ARCHIVE_PREFIX = "chat.archive.";
const ARCHIVE_INDEX = "chat.archive.index";
// Per device: the most recent games, and the newest messages of each.
const ARCHIVE_ROOMS = 20;
const ARCHIVE_MESSAGES = 1000;

/** Parse one message from the server, or null if it's malformed. */
export function parseChatMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const f = (r.from && typeof r.from === "object" ? r.from : {}) as Record<string, unknown>;
  if (typeof r.text !== "string" || typeof r.seq !== "number") return null;
  const role: ChatRole = f.role === "dm" || f.role === "spectator" ? f.role : "player";
  return {
    seq: r.seq,
    ts: typeof r.ts === "number" ? r.ts : Date.now(),
    text: r.text,
    from: {
      id: String(f.id ?? ""),
      name: String(f.name ?? "Player"),
      color: String(f.color ?? ""),
      role,
      kind: f.kind === "ai" ? "ai" : "human",
    },
    ...(typeof r.cid === "string" && r.cid ? { cid: r.cid } : {}),
  };
}

/** Merge server messages into a list: dedupe by seq, keep seq order. */
export function mergeChat(list: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const bySeq = new Map<number, ChatMessage>();
  for (const m of list) if (m.seq != null) bySeq.set(m.seq, m);
  for (const m of incoming) if (m.seq != null) bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq! - b.seq!);
}

let cidCounter = 0;
export function chatCid(): string {
  cidCounter = (cidCounter + 1) % 100000;
  return `c${Date.now().toString(36)}${cidCounter}${Math.random().toString(36).slice(2, 6)}`;
}

// --- Per-device archive -----------------------------------------------------

const archiveKey = (app: RoomApp, code: string) => `${ARCHIVE_PREFIX}${app}.${code}`;

function readIndex(): { app: RoomApp; code: string; updatedAt: number }[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ARCHIVE_INDEX) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndex(index: { app: RoomApp; code: string; updatedAt: number }[]): void {
  try { localStorage.setItem(ARCHIVE_INDEX, JSON.stringify(index)); } catch { /* storage unavailable */ }
}

/** Save this game's confirmed messages, merged with any already saved. */
export function saveChatArchive(app: RoomApp, code: string, messages: ChatMessage[]): void {
  const confirmed = messages.filter((m) => m.seq != null).map((m) => stored(m, true));
  if (!code || confirmed.length === 0) return;
  const prev = loadChatArchive(app, code);
  const merged = mergeChat(prev?.messages ?? [], confirmed).slice(-ARCHIVE_MESSAGES);
  const updatedAt = Date.now();
  const index = [{ app, code, updatedAt }, ...readIndex().filter((e) => !(e.app === app && e.code === code))];
  for (const old of index.splice(ARCHIVE_ROOMS)) {
    try { localStorage.removeItem(archiveKey(old.app, old.code)); } catch { /* storage unavailable */ }
  }
  try {
    localStorage.setItem(archiveKey(app, code), JSON.stringify({ app, code, updatedAt, messages: merged } satisfies ChatArchive));
    writeIndex(index);
  } catch { /* quota: the live log is still downloadable */ }
}

export function loadChatArchive(app: RoomApp, code: string): ChatArchive | null {
  try {
    const raw = localStorage.getItem(archiveKey(app, code));
    if (!raw) return null;
    const a = JSON.parse(raw) as ChatArchive;
    return Array.isArray(a.messages) ? a : null;
  } catch {
    return null;
  }
}

/** Saved logs for one app, newest first. */
export function listChatArchives(app: RoomApp): { code: string; updatedAt: number; count: number }[] {
  return readIndex()
    .filter((e) => e.app === app)
    .map((e) => ({ code: e.code, updatedAt: e.updatedAt, count: loadChatArchive(app, e.code)?.messages.length ?? 0 }))
    .filter((e) => e.count > 0);
}

export function deleteChatArchive(app: RoomApp, code: string): void {
  try { localStorage.removeItem(archiveKey(app, code)); } catch { /* storage unavailable */ }
  writeIndex(readIndex().filter((e) => !(e.app === app && e.code === code)));
}

// --- Export -----------------------------------------------------------------

const APP_TITLE: Record<RoomApp, string> = { legion: "Star Wars: Legion", dnd: "Dungeons & Dragons" };

function authorLabel(a: ChatAuthor): string {
  const tags: string[] = [];
  if (a.role === "dm") tags.push("DM");
  else if (a.role === "spectator") tags.push("spectator");
  if (a.kind === "ai") tags.push("AI");
  return tags.length ? `${a.name} (${tags.join(", ")})` : a.name;
}

export function chatToText(app: RoomApp, code: string, messages: ChatMessage[]): string {
  const lines = [`${APP_TITLE[app]} — game ${code} — session chat`, `Saved ${new Date().toLocaleString()}`, ""];
  for (const m of messages) {
    if (m.seq == null) continue;
    const when = new Date(m.ts).toLocaleString();
    const body = m.text.split("\n").join("\n    ");
    lines.push(`[${when}] ${authorLabel(m.from)}: ${body}`);
  }
  return lines.join("\n") + "\n";
}

export function chatToJson(app: RoomApp, code: string, messages: ChatMessage[]): string {
  return JSON.stringify({
    format: "eslegion-session-chat", version: 1, app, code, savedAt: new Date().toISOString(),
    messages: messages.filter((m) => m.seq != null).map((m) => stored(m, false)),
  }, null, 2);
}

/** Hand the browser a file to save. */
export function downloadChat(app: RoomApp, code: string, messages: ChatMessage[], format: "txt" | "json"): void {
  const body = format === "json" ? chatToJson(app, code, messages) : chatToText(app, code, messages);
  const blob = new Blob([body], { type: format === "json" ? "application/json" : "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const day = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `${app}-chat-${code}-${day}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Display label for an author role/kind badge, or null for a plain player. */
export function authorBadge(a: ChatAuthor): string | null {
  if (a.kind === "ai") return a.role === "dm" ? "AI DM" : "AI";
  if (a.role === "dm") return "DM";
  if (a.role === "spectator") return "watching";
  return null;
}
