// AiSeat: one AI player at the table. It joins the room with an AI invite
// code (so the server holds it to that invite's permissions, exactly like
// an outside AI), keeps its own copy of the board, and whenever the board
// changes asks its game adapter what to do. Choices go to its brain; the
// result is pushed back to the room like any player's move.
//
// The seat runs in whichever browser tab started it. Nothing here knows the
// game: Legion's rules live in legion.ts, and a D&D adapter can plug in the
// same way.

import { RoomClient, type Peer, type RoomApp, type ConnStatus } from "../roomClient";
import type { AiStep, Brain, GameAdapter, SeatContext } from "./types";
import { addNote } from "./brain";

export type SeatStatus = {
  conn: ConnStatus;
  /** What the seat is doing, e.g. "Waiting for Red", "Thinking: move". */
  activity: string;
  you: Peer | null;
  /** Who made the last choice. */
  lastBy?: "claude" | "tactics";
  /** Why Claude isn't being used, when it isn't. */
  fallback?: string | null;
  error?: string;
  over?: boolean;
};

export type SeatOptions<S> = {
  app: RoomApp;
  room: string;
  aiCode: string;
  adapter: GameAdapter<S>;
  brain: Brain;
  onStatus: (s: SeatStatus) => void;
  /** Pause between steps so people can follow the game. */
  paceMs?: number;
};

// Chat lines are rate limited by the room (8 per 10s), so space them out.
const CHAT_GAP_MS = 1400;

export class AiSeat<S> {
  private client: RoomClient<S>;
  private state: S | null = null;
  private you: Peer | null = null;
  private peers: Peer[] = [];
  private busy = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private status: SeatStatus = { conn: "idle", activity: "Joining…", you: null };
  private chatQueue: string[] = [];
  private chatTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly opts: SeatOptions<S>;

  constructor(opts: SeatOptions<S>) {
    this.opts = opts;
    this.client = new RoomClient<S>(opts.room, "", "", {
      onStatus: (conn, detail) => this.setStatus({ conn, ...(detail ? { error: detail } : {}) }),
      onDenied: (reason) => this.setStatus({ error: reason, activity: "Not allowed in" }),
      onWelcome: (you, state, peers) => {
        this.you = you;
        this.peers = peers;
        this.state = state;
        this.setStatus({ you, activity: you.color === "spectator" ? "No free side, watching" : "Looking at the board" });
        this.schedule(400);
      },
      onState: (state) => { this.state = state; this.schedule(); },
      onPresence: (peers) => {
        this.peers = peers;
        if (this.you) this.you = peers.find((p) => p.id === this.you!.id) ?? this.you;
        this.schedule();
      },
    }, opts.app, false, opts.aiCode);
  }

  start(): void { this.client.connect(); }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.chatTimer) clearTimeout(this.chatTimer);
    this.client.close();
    this.setStatus({ conn: "closed", activity: "Stopped" });
  }

  private setStatus(patch: Partial<SeatStatus>): void {
    this.status = { ...this.status, ...patch };
    this.opts.onStatus(this.status);
  }

  private schedule(delay = this.opts.paceMs ?? 900): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.tick(); }, delay);
  }

  private say(lines: string[] | undefined): void {
    if (!lines?.length) return;
    this.chatQueue.push(...lines);
    if (!this.chatTimer) this.flushChat();
  }

  private flushChat(): void {
    const line = this.chatQueue.shift();
    if (!line) { this.chatTimer = null; return; }
    this.client.sendChat(line, `ai_${Date.now().toString(36)}`);
    this.chatTimer = setTimeout(() => this.flushChat(), CHAT_GAP_MS);
  }

  private async tick(): Promise<void> {
    if (this.busy || this.stopped || !this.state || !this.you || this.status.conn !== "open") return;
    if (this.you.color === "spectator") return;
    const ctx: SeatContext = { you: this.you, peers: this.peers };
    let step: AiStep<S> | null;
    try {
      step = this.opts.adapter.next(this.state, ctx);
    } catch (e) {
      this.setStatus({ activity: "Stuck", error: String(e) });
      return;
    }
    if (!step) {
      const over = !!this.opts.adapter.over?.(this.state);
      this.setStatus({ activity: over ? "Game over" : "Waiting for the other side", over });
      const wake = over ? null : this.opts.adapter.wakeIn?.(this.state);
      if (wake != null) this.schedule(wake);
      return;
    }
    this.busy = true;
    try {
      let choice: string | null = null;
      if (step.decision) {
        this.setStatus({ activity: `Thinking: ${step.label}` });
        const picked = await this.opts.brain.choose(step.observe?.() ?? "", step.decision);
        choice = picked.id;
        this.setStatus({ lastBy: picked.by });
        if (picked.say && step.decision.kind !== "lesson") this.say([`💬 ${picked.say}`]);
        if (picked.say && step.decision.kind === "lesson") addNote(this.opts.app, this.you.name, picked.say);
      } else {
        this.setStatus({ activity: step.label });
      }
      if (this.stopped || !this.state) return;
      // Apply to the board as it is now (nobody else acts on our turn).
      const prev = this.state;
      const out = step.apply(prev, choice);
      if (out.lesson) addNote(this.opts.app, this.you.name, out.lesson);
      if (out.state !== prev) {
        const next = this.opts.adapter.log ? this.opts.adapter.log(prev, out.state, this.you.name) : out.state;
        this.state = next;
        this.client.sendState(next);
      }
      this.say(out.chat);
    } catch (e) {
      this.setStatus({ activity: "Stuck", error: String(e) });
    } finally {
      this.busy = false;
    }
    this.schedule();
  }
}
