// Brains for an AI seat. The Claude brain asks the room server, which holds
// the API key and checks the AI invite (worker/src/aiBrain.ts); when that
// isn't available (no key on the server, a network error) it falls back to
// the adapter's built-in tactics, which pick the option with the best score.

import type { RoomApp } from "../roomClient";
import type { AiChoice, AiDecision, Brain } from "./types";

/** The adapter's own pick: the option with the highest score. */
export function tacticsPick(decision: AiDecision): AiChoice {
  let best = decision.options[0]!;
  for (const o of decision.options) if ((o.score ?? 0) > (best.score ?? 0)) best = o;
  return { id: best.id, by: "tactics" };
}

export const tacticsBrain: Brain = {
  choose: async (_obs, decision) => tacticsPick(decision),
};

export type ClaudeBrainOptions = {
  app: RoomApp;
  room: string;
  aiCode: string;
  /** What this AI wrote down after earlier games (its notebook). */
  notes: () => string[];
  /** Told when Claude stops (or starts) answering, with the reason. */
  onFallback?: (reason: string | null) => void;
};

// How long one decision may take before the tactics step in.
const TIMEOUT_MS = 45_000;

export function claudeBrain(opts: ClaudeBrainOptions): Brain {
  // Once the server says it has no API key, stop asking for this seat.
  let disabled: string | null = null;
  return {
    async choose(observation, decision) {
      if (disabled || decision.options.length < 2) return tacticsPick(decision);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`/api/room/${encodeURIComponent(opts.room)}/ai`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: ctl.signal,
          body: JSON.stringify({
            app: opts.app,
            code: opts.aiCode,
            observation,
            notes: opts.notes(),
            decision: { kind: decision.kind, question: decision.question, options: decision.options.map(({ id, label }) => ({ id, label })) },
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { id?: unknown; say?: unknown; error?: unknown };
        if (!res.ok) {
          const reason = typeof body.error === "string" ? body.error : `server ${res.status}`;
          // A missing key or a revoked code won't fix itself mid-game.
          if (res.status === 503 || res.status === 403) disabled = reason;
          opts.onFallback?.(reason);
          return tacticsPick(decision);
        }
        const id = typeof body.id === "string" && decision.options.some((o) => o.id === body.id) ? body.id : null;
        if (!id) { opts.onFallback?.("Claude picked something that wasn't an option"); return tacticsPick(decision); }
        opts.onFallback?.(null);
        return { id, by: "claude", ...(typeof body.say === "string" && body.say.trim() ? { say: body.say.trim().slice(0, 200) } : {}) };
      } catch {
        opts.onFallback?.("Claude didn't answer in time");
        return tacticsPick(decision);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// --- Notebook ---------------------------------------------------------------
// What an AI learns, kept on this device by the AI's name so it can play
// better next time (the briefing asks it to save what it learns).

const NOTEBOOK_KEY = "legion-ai.notebook.v1";
const NOTEBOOK_MAX = 12;

type Notebook = Record<string, string[]>;

function readNotebook(): Notebook {
  try { return JSON.parse(localStorage.getItem(NOTEBOOK_KEY) ?? "{}") as Notebook; } catch { return {}; }
}

export function notesFor(app: RoomApp, name: string): string[] {
  return readNotebook()[`${app}:${name}`] ?? [];
}

export function addNote(app: RoomApp, name: string, note: string): void {
  const book = readNotebook();
  const key = `${app}:${name}`;
  const list = [...(book[key] ?? []).filter((n) => n !== note), note.slice(0, 300)];
  book[key] = list.slice(-NOTEBOOK_MAX);
  try { localStorage.setItem(NOTEBOOK_KEY, JSON.stringify(book)); } catch { /* storage full or blocked */ }
}
