/**
 * RoomDO — a Durable Object that hosts one remote Tabletop session.
 *
 * Each room is addressed by a short share code (the DO name). The object
 * holds the authoritative board state and relays updates between the
 * connected players over WebSockets. The model is deliberately simple:
 * any client may push a full board snapshot, the DO stores it and
 * broadcasts it to everyone else (last-write-wins). For a casual
 * 2-player game where the two people aren't grabbing the same piece on
 * the same frame, that's plenty and avoids an operational-transform
 * rabbit hole.
 *
 * Uses the hibernatable WebSocket API so an idle room costs nothing:
 * the runtime can evict the object between messages and rehydrate it,
 * with per-socket metadata stashed via serializeAttachment().
 *
 * D&D rooms (protocol 2) add a single DM seat and DM-only channels:
 *   claimDm / releaseDm, linkCampaign / unlinkCampaign, rollRequest
 *   (DM -> chosen players), campaignInvite (DM -> players, player code
 *   only), and `dice` with vis:"dm" (player -> DM only). Anything meant
 *   for the DM alone is sent to the DM's socket alone — never broadcast
 *   and filtered client-side. Campaign codes are verified against the
 *   CampaignDO and never stored, broadcast or kept on a socket.
 *
 * AI invites (both apps): a person at the table mints a role-scoped code
 * (`<ROOM>-AI-<SECRET>`) that admits an AI as a player or (D&D) the DM.
 * A socket that connects with `?ai=<code>` is stamped from the invite —
 * name, role, kind "ai" — and held to that invite's permissions here, on
 * the server, so a person previewing the code sees exactly what an AI
 * would get. See docs/ai-invites.md.
 */
import { DurableObject } from "cloudflare:workers";
import { parseCode, type CampaignDO } from "./campaign";

export interface RoomEnv {
  ROOM: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
  CAMPAIGN: DurableObjectNamespace<CampaignDO>;
  ALLOWED_ORIGIN: string;
}

// Per-connection metadata, kept on the socket via (de)serializeAttachment
// so it survives hibernation. `color` doubles as identity/role:
//   Legion: "blue" | "red" | "spectator"
//   D&D:    a hex like "#4a86c8" (an editor), or "spectator" (watch-only)
// The literal "spectator" always means watch-only in either app.
// `v` is the client's protocol version; `dm` marks the D&D DM seat.
// `ai` is the id (not the secret) of the AI invite the socket joined with,
// `aiRole` its role, and `aiBoard` whether it may change the board.
// Keep this tiny (platform attachment limit ~2KB) and secret-free.
type Attachment = {
  id: string; color: string; name: string; app?: "dnd" | "legion"; v?: number; dm?: true;
  ai?: string; aiRole?: AiRole; aiBoard?: true;
};

type Peer = { id: string; color: string; name: string; dm?: true; v?: number; ai?: AiRole; aiInvite?: string };

// Messages are small JSON objects tagged with `t`.
type ClientMsg =
  | { t: "state"; state: unknown }
  | { t: "cursor"; x: number; y: number }
  | { t: "name"; name: string }
  | { t: "setColor"; color: string }
  | { t: "dice"; entry: unknown; vis?: unknown }
  | { t: "ping" }
  | { t: "claimDm"; token?: unknown; code?: unknown; link?: unknown }
  | { t: "releaseDm" }
  | { t: "linkCampaign"; code?: unknown }
  | { t: "unlinkCampaign" }
  | { t: "rollRequest"; to?: unknown; req?: unknown }
  | { t: "campaignInvite"; code?: unknown; to?: unknown }
  | { t: "chat"; text?: unknown; cid?: unknown }
  | { t: "chatHistory"; before?: unknown; limit?: unknown }
  | { t: "aiInviteCreate"; role?: unknown; name?: unknown; board?: unknown }
  | { t: "aiInviteList" }
  | { t: "aiInviteRevoke"; id?: unknown };

// A chat line as stored and sent. `from` is a snapshot of the sender at
// send time, so the log still reads right after they rename or leave.
type ChatRole = "player" | "dm" | "spectator";
type ChatAuthor = { id: string; name: string; color: string; role: ChatRole; kind: "human" | "ai" };
type ChatMessage = { seq: number; ts: number; from: ChatAuthor; text: string; cid?: string };

const STATE_KEY = "board-state";
const APP_KEY = "room-app";
// The room's share code, remembered so lobby reports still work after the
// object hibernates and rehydrates (a DO isn't told its own name).
const CODE_KEY = "room-code";
// Set once, from the host's initial connection (?private=1). A private room
// never reports to the lobby, so it never appears in the public Live games
// list — it's still fully joinable by code, just unlisted.
const PRIVATE_KEY = "room-private";
// D&D: the campaign linked to this game ({id, name}) and the DM seat
// record ({token, peerId, name, releasedAt?}).
const CAMPAIGN_KEY = "room-campaign";
const DM_KEY = "room-dm";
// Re-report an in-progress game to the lobby at most this often, so a long
// game that isn't gaining/losing players doesn't age out of the list.
const LOBBY_REFRESH_MS = 60_000;
// Room state can carry a downscaled dungeon-map image (D&D), so allow more
// than a bare board's worth.
const MAX_STATE_BYTES = 2_000_000;
const MAX_DICE_BYTES = 8_000;
// After the DM's connection drops, the seat is held this long for them:
// only their seat token (or a valid owner/Co-DM code) can take it.
const DM_GRACE_MS = 90_000;
const PROTOCOL = 2;
// Session chat: stored one message per key ("chat:<seq>", zero-padded so
// keys sort in order), the newest CHAT_CAP kept.
const CHAT_PREFIX = "chat:";
const CHAT_SEQ_KEY = "chat-seq";
const CHAT_CAP = 1000;
const CHAT_MAX_CHARS = 1000;
const CHAT_WELCOME_COUNT = 50;
const CHAT_PAGE_MAX = 200;
// Per-connection flood guard: at most this many messages per window.
const CHAT_RATE_COUNT = 8;
const CHAT_RATE_WINDOW_MS = 10_000;

// AI invites: one storage key per invite ("ai-invite:<id>"), a few per room.
type AiRole = "player" | "dm";
type AiInvite = { id: string; secret: string; role: AiRole; name: string; board: boolean; by: string; createdAt: number };
const AI_PREFIX = "ai-invite:";
const AI_MAX_INVITES = 8;
// The colour an AI takes in D&D (a person picks their own).
const AI_DND_COLOR = "#9b6dff";
const AI_CODE_RE = /^([A-Z0-9]{4,12})-AI-([A-Z0-9]{8,24})$/;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Legion's two exclusive sides; D&D has no exclusive colors.
const LEGION_EXCLUSIVE = new Set(["blue", "red"]);

type DmRecord = { token: string; peerId: string; name: string; releasedAt?: number };
type LinkedCampaign = { id: string; name: string };

function randomId(): string {
  // Short opaque id for a connection/player.
  return Math.random().toString(36).slice(2, 10);
}

function randomToken(): string {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function randomSecret(len = 10): string {
  const b = new Uint32Array(len);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
}

// The secret from a full AI code ("<ROOM>-AI-<SECRET>") or a bare secret.
function aiSecretOf(raw: string, room: string): string | null {
  const v = raw.trim().toUpperCase();
  const m = AI_CODE_RE.exec(v);
  if (m) return m[1] === room ? m[2]! : null;
  return /^[A-Z0-9]{8,24}$/.test(v) ? v : null;
}

// What an invite lets its holder do — sent to the creator's list and, on
// joining, to the AI itself, so the preview and the server agree.
function aiPublic(inv: AiInvite, room: string): Record<string, unknown> {
  return { id: inv.id, code: `${room}-AI-${inv.secret}`, role: inv.role, name: inv.name, board: inv.role === "dm" || inv.board, by: inv.by, createdAt: inv.createdAt };
}

const chatKey = (seq: number): string => CHAT_PREFIX + String(seq).padStart(9, "0");

function chatRoleOf(att: Attachment): ChatRole {
  if (att.dm) return "dm";
  return att.color === "spectator" ? "spectator" : "player";
}

function peerOf(att: Attachment): Peer {
  const p: Peer = { id: att.id, color: att.color, name: att.name };
  if (att.dm) p.dm = true;
  if (att.v && att.v > 1) p.v = att.v;
  if (att.ai) { p.ai = att.aiRole ?? "player"; p.aiInvite = att.ai; }
  return p;
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const ROLL_KINDS = new Set(["skill", "save", "ability", "initiative", "custom"]);
const ROLL_MODES = new Set(["normal", "adv", "dis"]);

function sanitizeRollRequest(raw: unknown): Record<string, unknown> {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {
    id: str(r.id, 40) || randomId(),
    label: str(r.label, 60),
    kind: typeof r.kind === "string" && ROLL_KINDS.has(r.kind) ? r.kind : "custom",
    mode: typeof r.mode === "string" && ROLL_MODES.has(r.mode) ? r.mode : "normal",
    vis: r.vis === "dm" ? "dm" : "table",
  };
  if (typeof r.key === "string") out.key = r.key.slice(0, 20);
  if (typeof r.dice === "string" && /^[0-9dD+\- ]{1,20}$/.test(r.dice)) out.dice = r.dice;
  if (typeof r.dc === "number" && Number.isFinite(r.dc)) out.dc = Math.max(0, Math.min(50, Math.round(r.dc)));
  const note = str(r.note, 140);
  if (note) out.note = note;
  return out;
}

export class RoomDO extends DurableObject<RoomEnv> {
  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get("Upgrade");
    if (upgrade !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const url = new URL(request.url);
    const app = url.searchParams.get("app") === "dnd" ? "dnd" : "legion";

    // Remember our share code (…/api/room/<CODE>/ws) for lobby reports.
    const codeFromPath = url.pathname.split("/").filter(Boolean)[2] ?? "";
    if (codeFromPath) await this.ctx.storage.put(CODE_KEY, codeFromPath.toUpperCase());

    // A room belongs to one app. The first connection stamps it; a later
    // connection for the other app is refused so a Legion and a D&D room
    // can never share a code and cross-contaminate.
    const stampedApp = (await this.ctx.storage.get<string>(APP_KEY)) ?? null;
    if (stampedApp && stampedApp !== app) {
      this.ctx.acceptWebSocket(server);
      this.send(server, { t: "denied", reason: "room-app-mismatch", app: stampedApp });
      try { server.close(1008, "room belongs to another app"); } catch { /* noop */ }
      return new Response(null, { status: 101, webSocket: client });
    }
    if (!stampedApp) {
      await this.ctx.storage.put(APP_KEY, app);
      // Privacy is decided once, by whoever's connection creates the room.
      // Later connections (joiners) can't flip it — matches the app stamp.
      await this.ctx.storage.put(PRIVATE_KEY, url.searchParams.get("private") === "1");
    }

    // An AI invite decides the connection's name, colour and role; the
    // query's own name/color are ignored for it.
    const aiParam = url.searchParams.get("ai");
    let invite: AiInvite | null = null;
    if (aiParam) {
      const room = (await this.ctx.storage.get<string>(CODE_KEY)) ?? "";
      invite = await this.findAiInvite(aiSecretOf(aiParam, room));
      if (!invite) {
        this.ctx.acceptWebSocket(server);
        this.send(server, { t: "denied", reason: "ai-invite-invalid" });
        try { server.close(1008, "unknown AI invite"); } catch { /* noop */ }
        return new Response(null, { status: 101, webSocket: client });
      }
    }

    // Honor the requested color/identity (see pickColor). Legion keeps its
    // blue/red-then-spectator fallback; D&D takes the picked color as-is.
    const color = invite
      ? (app === "dnd" ? AI_DND_COLOR : this.pickColor(app, null))
      : this.pickColor(app, url.searchParams.get("color"));
    const name = invite?.name || (url.searchParams.get("name") || "").slice(0, 24) || defaultName(color);
    const v = Math.max(1, Math.min(99, Number(url.searchParams.get("v")) || 1));
    const att: Attachment = { id: randomId(), color, name, app, v };
    if (invite) {
      att.ai = invite.id;
      att.aiRole = invite.role;
      if (invite.role === "dm" || invite.board) att.aiBoard = true;
    }

    // Accept with hibernation support and stash the attachment.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(att);

    // Send the welcome (current board + peer list) once the socket opens.
    const state = await this.ctx.storage.get<unknown>(STATE_KEY);
    const isPrivate = (await this.ctx.storage.get<boolean>(PRIVATE_KEY)) ?? false;
    const campaign = app === "dnd" ? (await this.ctx.storage.get<LinkedCampaign>(CAMPAIGN_KEY)) ?? null : null;
    const chat = await this.chatPage(null, CHAT_WELCOME_COUNT);
    this.send(server, {
      t: "welcome",
      you: peerOf(att),
      private: isPrivate,
      proto: PROTOCOL,
      campaign,
      state: state ?? null,
      peers: this.peers(),
      chat: chat.messages,
      chatMore: chat.more,
      ...(invite ? { ai: aiPublic(invite, (await this.ctx.storage.get<string>(CODE_KEY)) ?? "") } : {}),
    });
    // A DM invite seats the AI as DM, taking the seat from whoever has it:
    // only the DM could mint it, so this is the DM handing over.
    if (invite?.role === "dm" && app === "dnd") await this.seatAiDm(server);
    // Notify everyone (including the joiner) of the updated roster. The
    // new socket is already in getWebSockets() at this point, so no
    // exclusion — passing it would hide the joiner from existing peers.
    this.broadcastPresence(null);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw) as ClientMsg;
    } catch {
      return;
    }
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;

    switch (msg.t) {
      case "state": {
        // Spectators are watch-only: never let their board changes
        // persist or reach other players. This is the authoritative
        // guard — the client also locks its UI, but this stops a
        // tampered client too.
        if (att.color === "spectator") return;
        // An AI only changes the board if its invite allows it.
        if (att.ai && !att.aiBoard) { this.opDenied(ws, "state", "ai-no-board"); return; }
        // Persist + relay. Cap stored size so a bad client can't blow up
        // the object's storage.
        const json = JSON.stringify(msg.state);
        if (json.length > MAX_STATE_BYTES) {
          // Tell the sender rather than silently desyncing them from the
          // table (they already believe the change went out).
          this.send(ws, { t: "stateRejected", reason: "too-large", bytes: json.length, max: MAX_STATE_BYTES });
          return;
        }
        await this.ctx.storage.put(STATE_KEY, msg.state);
        this.broadcast({ t: "state", state: msg.state, from: att.id }, ws);
        // Keep a long-running game fresh in the lobby directory even when
        // nobody joins or leaves (throttled — see LOBBY_REFRESH_MS).
        this.reportToLobby(this.peers(), true);
        break;
      }
      case "cursor":
        // Ephemeral — never stored, just relayed.
        this.broadcast({ t: "cursor", id: att.id, color: att.color, x: msg.x, y: msg.y }, ws);
        break;
      case "dice": {
        if (JSON.stringify(msg.entry ?? null).length > MAX_DICE_BYTES) return;
        if (msg.vis === "dm") {
          // A secret roll: to the DM only. With no DM seated it is
          // dropped — never broadcast as a fallback.
          const dm = this.dmSocket(null);
          if (!dm || dm === ws) { this.opDenied(ws, "dice", "no-dm"); return; }
          this.send(dm, { t: "dice", id: att.id, color: att.color, entry: msg.entry, vis: "dm" });
          return;
        }
        this.broadcast({ t: "dice", id: att.id, color: att.color, entry: msg.entry }, ws);
        break;
      }
      case "name": {
        // An AI's name comes from its invite.
        if (att.ai) return this.opDenied(ws, msg.t, "ai-fixed");
        const name = String(msg.name || "").slice(0, 24) || att.name;
        ws.serializeAttachment({ ...att, name });
        this.broadcastPresence(null);
        break;
      }
      case "setColor": {
        if (att.ai) return this.opDenied(ws, msg.t, "ai-fixed");
        const want = String(msg.color || "").slice(0, 16);
        if (!want) break;
        // Only Legion's blue/red are exclusive. If another socket holds
        // the requested exclusive slot, deny so the requester keeps its
        // current color. D&D colors (hex) are freely shared.
        if (LEGION_EXCLUSIVE.has(want)) {
          for (const other of this.ctx.getWebSockets()) {
            if (other === ws) continue;
            const a2 = other.deserializeAttachment() as Attachment | null;
            if (a2 && a2.color === want) {
              this.send(ws, { t: "colorDenied", color: want });
              return;
            }
          }
        }
        let next: Attachment = { ...att, color: want };
        // A spectator can't hold the DM seat: switching gives it up.
        if (att.dm && want === "spectator") {
          next = { ...next };
          delete next.dm;
          await this.ctx.storage.delete(DM_KEY);
          this.send(ws, { t: "dmRevoked", reason: "released" });
        }
        ws.serializeAttachment(next);
        // The requester learns its new color from the presence roster
        // (it can match itself by id), and everyone sees the swap.
        this.broadcastPresence(null);
        break;
      }
      case "ping":
        this.send(ws, { t: "pong" });
        break;

      // --- Session chat (both apps) -------------------------------------
      case "chat":
        await this.onChat(ws, att, msg);
        break;
      case "chatHistory": {
        const before = typeof msg.before === "number" && Number.isFinite(msg.before) ? Math.floor(msg.before) : null;
        const limit = typeof msg.limit === "number" ? Math.max(1, Math.min(CHAT_PAGE_MAX, Math.floor(msg.limit))) : 100;
        const page = await this.chatPage(before, limit);
        this.send(ws, { t: "chatHistory", before, messages: page.messages, more: page.more });
        break;
      }

      // --- AI invites (both apps) --------------------------------------
      case "aiInviteCreate":
        await this.createAiInvite(ws, att, msg);
        break;
      case "aiInviteList":
        if (!this.canManageAi(att)) return this.opDenied(ws, msg.t, att.ai ? "ai-role" : "not-allowed");
        await this.sendAiInvites(ws);
        break;
      case "aiInviteRevoke":
        await this.revokeAiInvite(ws, att, msg.id);
        break;

      // --- D&D DM features (protocol 2) ---------------------------------
      case "claimDm":
        if (att.app !== "dnd") return this.opDenied(ws, msg.t, "not-dnd");
        // An AI's role is fixed by its invite (a DM invite is seated on join).
        if (att.ai) return this.opDenied(ws, msg.t, "ai-role");
        await this.claimDm(ws, msg);
        break;
      case "releaseDm": {
        if (att.app !== "dnd" || !att.dm) return;
        const next = { ...att };
        delete next.dm;
        ws.serializeAttachment(next);
        await this.ctx.storage.delete(DM_KEY);
        this.send(ws, { t: "dmRevoked", reason: "released" });
        this.broadcastPresence(null);
        break;
      }
      case "linkCampaign": {
        if (att.app !== "dnd") return this.opDenied(ws, msg.t, "not-dnd");
        // Campaign codes are for people; an AI never holds one.
        if (att.ai) return this.opDenied(ws, msg.t, "ai-role");
        if (!att.dm) return this.opDenied(ws, msg.t, "not-dm");
        const v = await this.verifyCode(msg.code);
        if (!v || v.role === "player") return this.opDenied(ws, msg.t, "bad-code");
        const linked: LinkedCampaign = { id: v.id, name: v.name };
        await this.ctx.storage.put(CAMPAIGN_KEY, linked);
        this.broadcast({ t: "campaign", campaign: linked }, null);
        break;
      }
      case "unlinkCampaign":
        if (att.app !== "dnd" || !att.dm) return this.opDenied(ws, msg.t, "not-dm");
        if (att.ai) return this.opDenied(ws, msg.t, "ai-role");
        await this.ctx.storage.delete(CAMPAIGN_KEY);
        this.broadcast({ t: "campaign", campaign: null }, null);
        break;
      case "rollRequest": {
        if (att.app !== "dnd" || !att.dm) return this.opDenied(ws, msg.t, "not-dm");
        const to = Array.isArray(msg.to) ? new Set(msg.to.filter((x): x is string => typeof x === "string").slice(0, 16)) : new Set<string>();
        if (to.size === 0) return;
        const req = sanitizeRollRequest(msg.req);
        this.sendTo(to, { t: "rollRequest", from: att.id, fromName: att.name, req });
        break;
      }
      case "campaignInvite": {
        if (att.app !== "dnd" || !att.dm) return this.opDenied(ws, msg.t, "not-dm");
        if (att.ai) return this.opDenied(ws, msg.t, "ai-role");
        const linked = await this.ctx.storage.get<LinkedCampaign>(CAMPAIGN_KEY);
        const v = await this.verifyCode(msg.code);
        // Only ever relay the linked campaign's *player* code, so an owner
        // or Co-DM code can't be handed out to the table by mistake.
        if (!linked || !v || v.role !== "player" || v.id !== linked.id) {
          return this.opDenied(ws, msg.t, "bad-code");
        }
        const wanted = Array.isArray(msg.to) ? new Set(msg.to.filter((x): x is string => typeof x === "string")) : null;
        const targets = new Set<string>();
        for (const other of this.ctx.getWebSockets()) {
          if (other === ws) continue;
          const a2 = other.deserializeAttachment() as Attachment | null;
          if (!a2 || a2.dm || a2.color === "spectator") continue;
          if (wanted && !wanted.has(a2.id)) continue;
          targets.add(a2.id);
        }
        const parsed = parseCode(String(msg.code));
        this.sendTo(targets, {
          t: "campaignInvite",
          from: att.name,
          invite: { campaignId: v.id, name: v.name, code: parsed ? `${parsed.id}.${parsed.secret}` : "" },
        });
        this.send(ws, { t: "inviteSent", count: targets.size });
        break;
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close();
    } catch {
      // already closing
    }
    await this.onSocketGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onSocketGone(ws);
  }

  // --- Session chat -----------------------------------------------------

  private async onChat(ws: WebSocket, att: Attachment, msg: { text?: unknown; cid?: unknown }): Promise<void> {
    // Collapse runs of blank lines and trim; an empty message is dropped.
    const text = (typeof msg.text === "string" ? msg.text : "")
      .replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, CHAT_MAX_CHARS);
    const cid = str(msg.cid, 40);
    if (!text) return;

    const now = Date.now();
    const recent = (this.chatSends.get(att.id) ?? []).filter((t) => now - t < CHAT_RATE_WINDOW_MS);
    if (recent.length >= CHAT_RATE_COUNT) {
      this.send(ws, { t: "chatDenied", cid, reason: "rate", retryAfterMs: CHAT_RATE_WINDOW_MS - (now - recent[0]!) });
      return;
    }
    recent.push(now);
    this.chatSends.set(att.id, recent);

    // Identity comes from the socket, never from the message.
    const seq = ((await this.ctx.storage.get<number>(CHAT_SEQ_KEY)) ?? 0) + 1;
    const entry: ChatMessage = {
      seq, ts: now, text,
      from: { id: att.id, name: att.name, color: att.color, role: chatRoleOf(att), kind: att.ai ? "ai" : "human" },
    };
    if (cid) entry.cid = cid;
    await this.ctx.storage.put({ [CHAT_SEQ_KEY]: seq, [chatKey(seq)]: entry });
    if (seq > CHAT_CAP) await this.ctx.storage.delete(chatKey(seq - CHAT_CAP));
    // Everyone, sender included: the echo is the sender's delivery receipt.
    this.broadcast({ t: "chat", msg: entry }, null);
  }

  // Up to `limit` messages older than `before` (or the newest, when null),
  // oldest first, and whether any older ones remain.
  private async chatPage(before: number | null, limit: number): Promise<{ messages: ChatMessage[]; more: boolean }> {
    const opts: DurableObjectListOptions = { prefix: CHAT_PREFIX, reverse: true, limit: limit + 1 };
    if (before != null) opts.end = chatKey(Math.max(0, before));
    const rows = await this.ctx.storage.list<ChatMessage>(opts);
    const messages = [...rows.values()];
    const more = messages.length > limit;
    return { messages: messages.slice(0, limit).reverse(), more };
  }

  /** Recent chat send times per connection id (in-memory flood guard). */
  private chatSends = new Map<string, number[]>();

  // --- AI invites ---------------------------------------------------------

  // Who may mint, list and revoke AI invites: a person at the table (not a
  // spectator, not an AI). In D&D, once a person holds the DM seat, only
  // that DM; while an AI holds it, any person can (so the table can always
  // revoke an AI DM and get the seat back).
  private canManageAi(att: Attachment): boolean {
    if (att.ai || att.color === "spectator") return false;
    if (att.app === "dnd" && !att.dm) {
      const dm = this.dmSocket(null)?.deserializeAttachment() as Attachment | null | undefined;
      if (dm && !dm.ai) return false;
    }
    return true;
  }

  private async aiInvites(): Promise<AiInvite[]> {
    const rows = await this.ctx.storage.list<AiInvite>({ prefix: AI_PREFIX });
    return [...rows.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  private async findAiInvite(secret: string | null): Promise<AiInvite | null> {
    if (!secret) return null;
    return (await this.aiInvites()).find((i) => i.secret === secret) ?? null;
  }

  private async sendAiInvites(ws: WebSocket): Promise<void> {
    const room = (await this.ctx.storage.get<string>(CODE_KEY)) ?? "";
    this.send(ws, { t: "aiInvites", invites: (await this.aiInvites()).map((i) => aiPublic(i, room)) });
  }

  private async createAiInvite(ws: WebSocket, att: Attachment, msg: { role?: unknown; name?: unknown; board?: unknown }): Promise<void> {
    if (!this.canManageAi(att)) return this.opDenied(ws, "aiInviteCreate", att.ai ? "ai-role" : "not-allowed");
    const role: AiRole = msg.role === "dm" ? "dm" : "player";
    if (role === "dm") {
      if (att.app !== "dnd") return this.opDenied(ws, "aiInviteCreate", "not-dnd");
      // Handing the DM seat to an AI is the DM's call alone (it skips the
      // campaign-code check a person would face).
      if (!att.dm) return this.opDenied(ws, "aiInviteCreate", "not-dm");
    }
    const existing = await this.aiInvites();
    if (existing.length >= AI_MAX_INVITES) return this.opDenied(ws, "aiInviteCreate", "ai-too-many");
    const name = str(msg.name, 24).trim() || (role === "dm" ? "AI DM" : "AI player");
    const inv: AiInvite = {
      id: randomId(), secret: randomSecret(), role, name,
      board: role === "dm" || msg.board === true, by: att.name, createdAt: Date.now(),
    };
    await this.ctx.storage.put(AI_PREFIX + inv.id, inv);
    await this.sendAiInvites(ws);
  }

  // Delete an invite and disconnect anyone using it (giving up the DM seat
  // outright — no grace hold for a revoked AI).
  private async revokeAiInvite(ws: WebSocket, att: Attachment, id: unknown): Promise<void> {
    if (!this.canManageAi(att)) return this.opDenied(ws, "aiInviteRevoke", att.ai ? "ai-role" : "not-allowed");
    if (typeof id !== "string") return;
    await this.ctx.storage.delete(AI_PREFIX + id);
    for (const other of this.ctx.getWebSockets()) {
      const a = other.deserializeAttachment() as Attachment | null;
      if (a?.ai !== id) continue;
      if (a.dm) {
        const rec = await this.ctx.storage.get<DmRecord>(DM_KEY);
        if (rec?.peerId === a.id) await this.ctx.storage.delete(DM_KEY);
      }
      other.serializeAttachment({ id: a.id, color: "spectator", name: a.name, app: a.app, v: a.v });
      this.send(other, { t: "denied", reason: "ai-invite-revoked" });
      try { other.close(4001, "AI invite revoked"); } catch { /* noop */ }
    }
    this.broadcastPresence(null);
    await this.sendAiInvites(ws);
  }

  // Seat an AI that joined with a DM invite, demoting any current holder.
  private async seatAiDm(ws: WebSocket): Promise<void> {
    const holder = this.dmSocket(ws);
    if (holder) {
      const ha = holder.deserializeAttachment() as Attachment | null;
      if (ha) {
        const demoted = { ...ha };
        delete demoted.dm;
        holder.serializeAttachment(demoted);
      }
      this.send(holder, { t: "dmRevoked", reason: "ai" });
    }
    await this.grantDm(ws, null);
  }

  // --- DM seat ----------------------------------------------------------

  private async onSocketGone(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att?.dm) {
      // Hold the seat for the DM to come back (page reload, flaky wifi).
      const rec = await this.ctx.storage.get<DmRecord>(DM_KEY);
      if (rec && rec.peerId === att.id && rec.releasedAt == null) {
        await this.ctx.storage.put(DM_KEY, { ...rec, releasedAt: Date.now() });
      }
    }
    this.broadcastPresence(ws);
  }

  // The seat holder's open socket, if any (half-open sockets after a drop
  // still count until their close event, which is why a seat token can
  // take the seat over from one).
  private dmSocket(exclude: WebSocket | null): WebSocket | null {
    for (const other of this.ctx.getWebSockets()) {
      if (other === exclude || other.readyState !== 1) continue;
      const a = other.deserializeAttachment() as Attachment | null;
      if (a?.dm) return other;
    }
    return null;
  }

  private async claimDm(ws: WebSocket, msg: { token?: unknown; code?: unknown; link?: unknown }): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment;
    if (att.color === "spectator") return this.opDenied(ws, "claimDm", "spectator");
    const token = typeof msg.token === "string" ? msg.token : null;
    const wantLink = msg.link === true;
    const rec = await this.ctx.storage.get<DmRecord>(DM_KEY);
    let linked = await this.ctx.storage.get<LinkedCampaign>(CAMPAIGN_KEY);
    const tokenOk = !!token && !!rec && rec.token === token;

    if (att.dm) {
      // Already seated (e.g. a repeat claim): just re-issue the token.
      if (rec) this.send(ws, { t: "dmGranted", token: rec.token });
      return;
    }

    const holder = this.dmSocket(ws);
    if (holder) {
      if (!tokenOk) return this.opDenied(ws, "claimDm", "seat-taken");
      // My token, someone else's socket: my own earlier connection (or
      // another tab). Move the seat here.
      const ha = holder.deserializeAttachment() as Attachment | null;
      if (ha) {
        const demoted = { ...ha };
        delete demoted.dm;
        holder.serializeAttachment(demoted);
      }
      this.send(holder, { t: "dmRevoked", reason: "moved" });
      await this.grantDm(ws, null);
      return;
    }

    const now = Date.now();
    let releasedAt = rec?.releasedAt;
    if (rec && releasedAt == null) {
      // Seat record with no socket: left over from a deploy or eviction
      // (no close event fired). Start the grace period now.
      releasedAt = now;
      await this.ctx.storage.put(DM_KEY, { ...rec, releasedAt });
    }
    const reserved = releasedAt != null && now - releasedAt < DM_GRACE_MS;

    let verified: { id: string; name: string; role: string } | null = null;
    if (!tokenOk) {
      if (linked || wantLink) {
        verified = await this.verifyCode(msg.code);
        if (linked && !verified && !(await this.campaignExists(linked.id))) {
          await this.ctx.storage.delete(CAMPAIGN_KEY);
          this.broadcast({ t: "campaign", campaign: null }, null);
          linked = undefined;
        }
      }
      const codeOk = !!verified && verified.role !== "player" && (!linked || verified.id === linked.id);
      if ((linked || wantLink) && !codeOk) {
        return this.opDenied(ws, "claimDm", typeof msg.code === "string" && msg.code ? "bad-code" : "code-required");
      }
      if (!codeOk && reserved) {
        return this.opDenied(ws, "claimDm", "seat-reserved", { retryAfterMs: DM_GRACE_MS - (now - releasedAt!) });
      }
    }

    // Awaits above let other messages run; re-check before granting.
    if (this.dmSocket(ws) || ws.readyState !== 1) return this.opDenied(ws, "claimDm", "seat-taken");
    const link = wantLink && verified && verified.role !== "player" && (!linked || linked.id !== verified.id)
      ? { id: verified.id, name: verified.name }
      : null;
    await this.grantDm(ws, link);
  }

  private async grantDm(ws: WebSocket, link: LinkedCampaign | null): Promise<void> {
    const cur = ws.deserializeAttachment() as Attachment;
    if (cur.color === "spectator") return this.opDenied(ws, "claimDm", "spectator");
    // A fresh token every time, so a copied session (duplicated tab)
    // can't keep bouncing the seat back.
    const token = randomToken();
    ws.serializeAttachment({ ...cur, dm: true });
    await this.ctx.storage.put(DM_KEY, { token, peerId: cur.id, name: cur.name } satisfies DmRecord);
    if (link) {
      await this.ctx.storage.put(CAMPAIGN_KEY, link);
      this.broadcast({ t: "campaign", campaign: link }, null);
    }
    this.send(ws, { t: "dmGranted", token });
    this.broadcastPresence(null);
  }

  private async verifyCode(code: unknown): Promise<{ id: string; name: string; role: string } | null> {
    if (typeof code !== "string") return null;
    const parsed = parseCode(code);
    if (!parsed) return null;
    try {
      const stub = this.env.CAMPAIGN.get(this.env.CAMPAIGN.idFromName(parsed.id));
      return await stub.verify(`${parsed.id}.${parsed.secret}`);
    } catch {
      return null;
    }
  }

  private async campaignExists(id: string): Promise<boolean> {
    try {
      return await this.env.CAMPAIGN.get(this.env.CAMPAIGN.idFromName(id)).exists();
    } catch {
      return true; // can't tell — don't unlink on a transient error
    }
  }

  private opDenied(ws: WebSocket, op: string, reason: string, extra: Record<string, unknown> = {}): void {
    this.send(ws, { t: "opDenied", op, reason, ...extra });
  }

  // --- helpers ----------------------------------------------------------

  private pickColor(app: string, preferred?: string | null): string {
    // Spectator is always honored (any number of watchers).
    if (preferred === "spectator") return "spectator";
    // D&D: identity colors aren't exclusive — take the picked color, or a
    // sensible default if none was supplied.
    if (app === "dnd") {
      return (preferred && /^#[0-9a-fA-F]{6}$/.test(preferred)) ? preferred : "#4a86c8";
    }
    // Legion: blue then red, else spectator.
    const taken = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att) taken.add(att.color);
    }
    if ((preferred === "blue" || preferred === "red") && !taken.has(preferred)) {
      return preferred;
    }
    if (!taken.has("blue")) return "blue";
    if (!taken.has("red")) return "red";
    return "spectator";
  }

  private peers(): Peer[] {
    const out: Peer[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att) out.push(peerOf(att));
    }
    return out;
  }

  private send(ws: WebSocket, obj: unknown): void {
    try {
      ws.send(JSON.stringify(obj));
    } catch {
      // socket gone; presence will catch up on the next close event
    }
  }

  private broadcast(obj: unknown, except: WebSocket | null): void {
    const data = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(data);
      } catch {
        // ignore
      }
    }
  }

  // Send only to the sockets whose connection id is in `ids`.
  private sendTo(ids: Set<string>, obj: unknown): void {
    const data = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att || !ids.has(att.id)) continue;
      try {
        ws.send(data);
      } catch {
        // ignore
      }
    }
  }

  // Broadcast the current peer list to everyone except `exclude` (used
  // when a socket is mid-close and shouldn't be counted).
  private broadcastPresence(exclude: WebSocket | null): void {
    const peers: Peer[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att) peers.push(peerOf(att));
    }
    const data = JSON.stringify({ t: "presence", peers });
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      try {
        ws.send(data);
      } catch {
        // ignore
      }
    }
    // The roster changed — refresh this room's entry in the lobby (an
    // empty roster removes it).
    this.reportToLobby(peers);
  }

  // Push this room's roster to the lobby directory. Fire-and-forget: the
  // lobby is a convenience index, so a failed report must never disturb
  // play. Reports are unconditional on roster changes; callers passing
  // `throttled` (ordinary gameplay traffic) only refresh periodically so
  // a long game doesn't age out of the list.
  private reportToLobby(peers: Peer[], throttled = false): void {
    const now = Date.now();
    if (throttled && now - this.lastLobbyReport < LOBBY_REFRESH_MS) return;
    this.lastLobbyReport = now;

    void (async () => {
      try {
        const isPrivate = (await this.ctx.storage.get<boolean>(PRIVATE_KEY)) ?? false;
        if (isPrivate) return; // never listed — still fully joinable by code
        const code = await this.ctx.storage.get<string>(CODE_KEY);
        if (!code) return;
        const app = (await this.ctx.storage.get<string>(APP_KEY)) ?? "legion";
        const stub = this.env.LOBBY.get(this.env.LOBBY.idFromName("global"));
        await stub.fetch("https://lobby/report", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code,
            app,
            players: peers.map((p) => ({ name: p.name, color: p.color })),
          }),
        });
      } catch {
        // Directory is best-effort; ignore.
      }
    })();
  }

  /** Timestamp of the last lobby report (in-memory; resets on eviction). */
  private lastLobbyReport = 0;
}

function defaultName(color: string): string {
  if (color === "blue") return "Blue player";
  if (color === "red") return "Red player";
  if (color === "spectator") return "Spectator";
  return "Player"; // D&D hex-colored editor
}
