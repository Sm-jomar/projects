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
  ALLOWED_ORIGIN: string;
}

// Per-connection metadata, kept on the socket via (de)serializeAttachment
// so it survives hibernation.
type PlayerColor = "blue" | "red" | "spectator";
type Attachment = { id: string; color: PlayerColor; name: string };

type Peer = { id: string; color: PlayerColor; name: string };

// Messages are small JSON objects tagged with `t`.
type ClientMsg =
  | { t: "state"; state: unknown }
  | { t: "cursor"; x: number; y: number }
  | { t: "name"; name: string }
  | { t: "setColor"; color: string }
  | { t: "dice"; entry: unknown }
  | { t: "ping" };

const STATE_KEY = "board-state";

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

    // Honor the player's requested color when it's free; otherwise fall
    // back to the first open slot (blue, then red), then spectator.
    const url = new URL(request.url);
    const color = this.pickColor(url.searchParams.get("color"));
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
        // Persist + relay. Cap stored size so a bad client can't blow up
        // the object's storage.
        const json = JSON.stringify(msg.state);
        if (json.length > 512_000) return;
        await this.ctx.storage.put(STATE_KEY, msg.state);
        this.broadcast({ t: "state", state: msg.state, from: att.id }, ws);
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
        const want = msg.color;
        if (want !== "blue" && want !== "red" && want !== "spectator") break;
        // A blue/red slot can only be held by one socket at a time. If
        // someone else has it, deny the change so the requester keeps
        // their current color.
        if (want === "blue" || want === "red") {
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

  private pickColor(preferred?: string | null): PlayerColor {
    const taken = new Set<PlayerColor>();
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
  }
}

function defaultName(color: PlayerColor): string {
  if (color === "blue") return "Blue player";
  if (color === "red") return "Red player";
  return "Spectator";
}
