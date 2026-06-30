// Client-side manager for a remote Tabletop room. Wraps a WebSocket to
// the room Durable Object with reconnection, throttled outbound state,
// and a small typed event surface.
//
// The socket connects to the SAME origin that served the app, at
//   wss://<host>/api/room/<CODE>/ws
// That route only exists on the Cloudflare Worker deployment, so remote
// play works when the app is opened on the Worker URL — not on the
// static GitHub Pages mirror, which has no /api/room endpoint. An
// optional VITE_ROOM_ORIGIN override lets a build point the socket at a
// specific worker origin if we ever want cross-origin play.

import type { TabletopState } from "./tabletop";

export type PlayerColor = "blue" | "red" | "spectator";
export type Peer = { id: string; color: PlayerColor; name: string };
export type ConnStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed" | "error";

export type RoomHandlers = {
  onStatus?: (status: ConnStatus, detail?: string) => void;
  onWelcome?: (you: Peer, state: TabletopState | null, peers: Peer[]) => void;
  onState?: (state: TabletopState, fromId: string) => void;
  onCursor?: (id: string, color: PlayerColor, x: number, y: number) => void;
  onPresence?: (peers: Peer[]) => void;
  onDice?: (id: string, color: PlayerColor, entry: unknown) => void;
};

const STATE_THROTTLE_MS = 60;
const CURSOR_THROTTLE_MS = 50;

// Unambiguous code alphabet (no 0/O/1/I) so a shared code is easy to read
// aloud and type. Server accepts [A-Z0-9]{4,12}; this is a safe subset.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRoomCode(len = 6): string {
  let out = "";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[arr[i]! % CODE_ALPHABET.length];
  return out;
}

function roomWsUrl(code: string, name: string): string {
  const override = import.meta.env.VITE_ROOM_ORIGIN as string | undefined;
  let base: string;
  if (override) {
    base = override.replace(/^http/, "ws").replace(/\/$/, "");
  } else {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    base = `${proto}//${location.host}`;
  }
  const q = name ? `?name=${encodeURIComponent(name)}` : "";
  return `${base}/api/room/${encodeURIComponent(code)}/ws${q}`;
}

export class RoomClient {
  readonly code: string;
  private name: string;
  private handlers: RoomHandlers;
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Outbound throttling state.
  private pendingState: TabletopState | null = null;
  private stateTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCursorAt = 0;

  you: Peer | null = null;

  constructor(code: string, name: string, handlers: RoomHandlers) {
    this.code = code.toUpperCase();
    this.name = name;
    this.handlers = handlers;
  }

  connect(): void {
    this.closedByUser = false;
    this.openSocket();
  }

  private openSocket(): void {
    this.handlers.onStatus?.(this.reconnectAttempts > 0 ? "reconnecting" : "connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(roomWsUrl(this.code, this.name));
    } catch (err) {
      this.handlers.onStatus?.("error", String((err as Error).message));
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.reconnectAttempts = 0;
      this.handlers.onStatus?.("open");
    });

    ws.addEventListener("message", (ev) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      this.dispatch(msg);
    });

    ws.addEventListener("close", () => {
      this.ws = null;
      if (this.closedByUser) {
        this.handlers.onStatus?.("closed");
      } else {
        this.scheduleReconnect();
      }
    });

    ws.addEventListener("error", () => {
      // The close handler runs next and drives reconnection; surface the
      // error state for the UI in the meantime.
      this.handlers.onStatus?.("error");
    });
  }

  private dispatch(msg: Record<string, unknown>): void {
    switch (msg.t) {
      case "welcome": {
        this.you = msg.you as Peer;
        this.handlers.onWelcome?.(
          msg.you as Peer,
          (msg.state ?? null) as TabletopState | null,
          (msg.peers ?? []) as Peer[],
        );
        break;
      }
      case "state":
        this.handlers.onState?.(msg.state as TabletopState, String(msg.from ?? ""));
        break;
      case "cursor":
        this.handlers.onCursor?.(
          String(msg.id), msg.color as PlayerColor,
          Number(msg.x), Number(msg.y),
        );
        break;
      case "presence":
        this.handlers.onPresence?.((msg.peers ?? []) as Peer[]);
        break;
      case "dice":
        this.handlers.onDice?.(String(msg.id), msg.color as PlayerColor, msg.entry);
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) return;
    this.reconnectAttempts++;
    this.handlers.onStatus?.("reconnecting");
    const delay = Math.min(10_000, 1000 * 2 ** Math.min(this.reconnectAttempts - 1, 4));
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }

  // Throttled full-state push. Coalesces rapid updates (e.g. dragging) to
  // one send per STATE_THROTTLE_MS.
  sendState(state: TabletopState): void {
    this.pendingState = state;
    if (this.stateTimer) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      const s = this.pendingState;
      this.pendingState = null;
      if (s) this.raw({ t: "state", state: s });
    }, STATE_THROTTLE_MS);
  }

  sendCursor(x: number, y: number): void {
    const now = Date.now();
    if (now - this.lastCursorAt < CURSOR_THROTTLE_MS) return;
    this.lastCursorAt = now;
    this.raw({ t: "cursor", x, y });
  }

  setName(name: string): void {
    this.name = name;
    this.raw({ t: "name", name });
  }

  private raw(obj: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(obj));
      } catch {
        // dropped; reconnect/Durable-Object state will reconcile
      }
    }
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.stateTimer) clearTimeout(this.stateTimer);
    this.reconnectTimer = null;
    this.stateTimer = null;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.handlers.onStatus?.("closed");
  }
}
