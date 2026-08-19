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

// `color` is the player's identity/role. Legion uses "blue"|"red"|
// "spectator"; D&D uses a hex color (an editor) or "spectator". The room
// is generic over its board-state type S so both apps can share it.
export type PlayerColor = string;
export type Peer = { id: string; color: PlayerColor; name: string };
export type ConnStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed" | "error";
export type RoomApp = "legion" | "dnd";

export type RoomHandlers<S> = {
  onStatus?: (status: ConnStatus, detail?: string) => void;
  onWelcome?: (you: Peer, state: S | null, peers: Peer[]) => void;
  onState?: (state: S, fromId: string) => void;
  onCursor?: (id: string, color: PlayerColor, x: number, y: number) => void;
  onPresence?: (peers: Peer[]) => void;
  onDice?: (id: string, color: PlayerColor, entry: unknown) => void;
  /** The server refused a color change because another player holds it. */
  onColorDenied?: (color: PlayerColor) => void;
  /** The room belongs to a different app (Legion vs D&D). */
  onDenied?: (reason: string) => void;
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

function roomWsUrl(code: string, name: string, color: string, app: RoomApp, isPrivate: boolean): string {
  const override = import.meta.env.VITE_ROOM_ORIGIN as string | undefined;
  let base: string;
  if (override) {
    base = override.replace(/^http/, "ws").replace(/\/$/, "");
  } else {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    base = `${proto}//${location.host}`;
  }
  const params = new URLSearchParams();
  if (name) params.set("name", name);
  if (color) params.set("color", color);
  params.set("app", app);
  // Only meaningful on the connection that creates the room (the host's
  // first join) — the server stamps it once and ignores it after that.
  if (isPrivate) params.set("private", "1");
  const q = params.toString();
  return `${base}/api/room/${encodeURIComponent(code)}/ws${q ? `?${q}` : ""}`;
}

export class RoomClient<S> {
  readonly code: string;
  private name: string;
  private preferredColor: string;
  private app: RoomApp;
  private wantPrivate: boolean;
  private handlers: RoomHandlers<S>;
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Outbound throttling state.
  private pendingState: S | null = null;
  private stateTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCursorAt = 0;

  you: Peer | null = null;
  /** Whether this room is hidden from the public Live games list. Set from
   * the server's welcome message, so it reflects reality even for a
   * joiner who didn't request privacy themselves. */
  isPrivate = false;

  constructor(
    code: string, name: string, preferredColor: string, handlers: RoomHandlers<S>,
    app: RoomApp = "legion", wantPrivate = false,
  ) {
    this.code = code.toUpperCase();
    this.name = name;
    this.preferredColor = preferredColor;
    this.handlers = handlers;
    this.app = app;
    this.wantPrivate = wantPrivate;
  }

  connect(): void {
    this.closedByUser = false;
    this.openSocket();
  }

  private openSocket(): void {
    this.handlers.onStatus?.(this.reconnectAttempts > 0 ? "reconnecting" : "connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(roomWsUrl(this.code, this.name, this.preferredColor, this.app, this.wantPrivate));
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
        this.isPrivate = msg.private === true;
        this.handlers.onWelcome?.(
          msg.you as Peer,
          (msg.state ?? null) as S | null,
          (msg.peers ?? []) as Peer[],
        );
        break;
      }
      case "denied":
        // The room belongs to another app — don't fight it with reconnects.
        this.closedByUser = true;
        this.handlers.onDenied?.(String(msg.reason ?? "denied"));
        break;
      case "state":
        this.handlers.onState?.(msg.state as S, String(msg.from ?? ""));
        break;
      case "cursor":
        this.handlers.onCursor?.(
          String(msg.id), msg.color as PlayerColor,
          Number(msg.x), Number(msg.y),
        );
        break;
      case "presence": {
        const peers = (msg.peers ?? []) as Peer[];
        // Keep our own cached identity in sync — color/name can change
        // after the initial welcome.
        if (this.you) {
          const mine = peers.find((p) => p.id === this.you!.id);
          if (mine) this.you = mine;
        }
        this.handlers.onPresence?.(peers);
        break;
      }
      case "dice":
        this.handlers.onDice?.(String(msg.id), msg.color as PlayerColor, msg.entry);
        break;
      case "colorDenied":
        this.handlers.onColorDenied?.(msg.color as PlayerColor);
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
  sendState(state: S): void {
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

  // Broadcast a dice roll (or similar event) to the other players. The
  // server relays it without storing; the entry should carry its own actor.
  sendDice(entry: unknown): void {
    this.raw({ t: "dice", entry });
  }

  setName(name: string): void {
    this.name = name;
    this.raw({ t: "name", name });
  }

  setColor(color: PlayerColor): void {
    // Remembered so a reconnect re-requests the same slot.
    this.preferredColor = color;
    this.raw({ t: "setColor", color });
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
