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
 */
import { DurableObject } from "cloudflare:workers";

export interface RoomEnv {
  ROOM: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
  ALLOWED_ORIGIN: string;
}

// Per-connection metadata, kept on the socket via (de)serializeAttachment
// so it survives hibernation. `color` doubles as identity/role:
//   Legion: "blue" | "red" | "spectator"
//   D&D:    a hex like "#4a86c8" (an editor), or "spectator" (watch-only)
// The literal "spectator" always means watch-only in either app.
type Attachment = { id: string; color: string; name: string };

type Peer = { id: string; color: string; name: string };

// Messages are small JSON objects tagged with `t`.
type ClientMsg =
  | { t: "state"; state: unknown }
  | { t: "cursor"; x: number; y: number }
  | { t: "name"; name: string }
  | { t: "setColor"; color: string }
  | { t: "dice"; entry: unknown }
  | { t: "ping" };

const STATE_KEY = "board-state";
const APP_KEY = "room-app";
// The room's share code, remembered so lobby reports still work after the
// object hibernates and rehydrates (a DO isn't told its own name).
const CODE_KEY = "room-code";
// Re-report an in-progress game to the lobby at most this often, so a long
// game that isn't gaining/losing players doesn't age out of the list.
const LOBBY_REFRESH_MS = 60_000;
// Room state can carry a downscaled dungeon-map image (D&D), so allow more
// than a bare board's worth.
const MAX_STATE_BYTES = 2_000_000;

// Legion's two exclusive sides; D&D has no exclusive colors.
const LEGION_EXCLUSIVE = new Set(["blue", "red"]);

function randomId(): string {
  // Short opaque id for a connection/player.
  return Math.random().toString(36).slice(2, 10);
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
    if (!stampedApp) await this.ctx.storage.put(APP_KEY, app);

    // Honor the requested color/identity (see pickColor). Legion keeps its
    // blue/red-then-spectator fallback; D&D takes the picked color as-is.
    const color = this.pickColor(app, url.searchParams.get("color"));
    const name = (url.searchParams.get("name") || "").slice(0, 24) || defaultName(color);
    const att: Attachment = { id: randomId(), color, name };

    // Accept with hibernation support and stash the attachment.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(att);

    // Send the welcome (current board + peer list) once the socket opens.
    const state = await this.ctx.storage.get<unknown>(STATE_KEY);
    this.send(server, {
      t: "welcome",
      you: { id: att.id, color: att.color, name: att.name },
      state: state ?? null,
      peers: this.peers(),
    });
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
        // Persist + relay. Cap stored size so a bad client can't blow up
        // the object's storage.
        const json = JSON.stringify(msg.state);
        if (json.length > MAX_STATE_BYTES) return;
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
      case "dice":
        this.broadcast({ t: "dice", id: att.id, color: att.color, entry: msg.entry }, ws);
        break;
      case "name": {
        const name = String(msg.name || "").slice(0, 24) || att.name;
        ws.serializeAttachment({ ...att, name });
        this.broadcastPresence(null);
        break;
      }
      case "setColor": {
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
        ws.serializeAttachment({ ...att, color: want });
        // The requester learns its new color from the presence roster
        // (it can match itself by id), and everyone sees the swap.
        this.broadcastPresence(null);
        break;
      }
      case "ping":
        this.send(ws, { t: "pong" });
        break;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close();
    } catch {
      // already closing
    }
    this.broadcastPresence(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.broadcastPresence(ws);
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
      if (att) out.push({ id: att.id, color: att.color, name: att.name });
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

  // Broadcast the current peer list to everyone except `exclude` (used
  // when a socket is mid-close and shouldn't be counted).
  private broadcastPresence(exclude: WebSocket | null): void {
    const peers: Peer[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att) peers.push({ id: att.id, color: att.color, name: att.name });
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
