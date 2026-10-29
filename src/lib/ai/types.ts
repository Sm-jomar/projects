// The game-agnostic half of an AI seat. An AiSeat (seat.ts) holds a room
// connection for one AI invite; a game adapter (legion.ts today, D&D
// later) says what that seat should do next; a brain (brain.ts) makes the
// choices: Claude through the room server, or the adapter's own tactics.

import type { Peer } from "../roomClient";

/** One choice the AI can make, e.g. "Move toward Checkpoint 2". */
export type AiOption = {
  id: string;
  label: string;
  /** The built-in tactics' rating: the best one is picked when Claude
   * isn't available. Higher is better. */
  score?: number;
};

/** A question put to the brain: pick one of `options`. */
export type AiDecision = {
  /** Short machine name, e.g. "command-card", "activation-action". */
  kind: string;
  question: string;
  options: AiOption[];
};

export type AiChoice = {
  id: string;
  /** A short line for the table chat, if the brain had something to say. */
  say?: string;
  /** Who picked: Claude, or the adapter's built-in tactics. */
  by: "claude" | "tactics";
};

/** What a seat knows about the table when it asks its adapter. */
export type SeatContext = {
  you: Peer;
  peers: Peer[];
};

/** A step the seat should take now. With a decision, the brain picks an
 * option first and `apply` gets its id; without one, `apply` gets null. */
export type AiStep<S> = {
  /** Shown in the seat's status line while it runs. */
  label: string;
  decision?: AiDecision;
  /** The board as the AI sees it, as text for the brain. */
  observe?: () => string;
  apply: (state: S, choice: string | null) => AiApplied<S>;
};

export type AiApplied<S> = {
  state: S;
  /** Lines to post in the session chat. */
  chat?: string[];
  /** Something the AI learned, kept in its notebook for next time. */
  lesson?: string;
};

export interface GameAdapter<S> {
  /** What this seat should do with the board as it is, or null to wait
   * (not its turn, or the game is over). */
  next(state: S, ctx: SeatContext): AiStep<S> | null;
  /** Audit-log the change the seat just made, if the game keeps a log. */
  log?(prev: S, next: S, actorName: string): S;
  /** While waiting (next gave null): ms until the seat should look again
   * even if nothing changes, e.g. to stop waiting on a player. */
  wakeIn?(state: S): number | null;
  /** True once the game is over. */
  over?(state: S): boolean;
}

export interface Brain {
  choose(observation: string, decision: AiDecision): Promise<AiChoice>;
}
