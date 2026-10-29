/**
 * The Claude brain behind "Let Claude play": an AI seat in a browser asks
 * POST /api/room/<ROOM>/ai which option to pick, and this asks Claude.
 *
 * The API key never leaves the Worker. A request must carry a live AI
 * invite code for that room (RoomDO checks it before calling here), the
 * system prompt is this game's briefing from public/ai/, and Claude only
 * ever picks one of the options the seat listed, so the endpoint can't be
 * used as a general chat proxy.
 *
 * Secret (set on the Worker in the Cloudflare dashboard):
 *   ANTHROPIC_API_KEY  - without it the endpoint answers 503 and the seats
 *                        play with their built-in tactics instead.
 * Optional vars:
 *   AI_MODEL           - defaults to claude-opus-5-5.
 *   ANTHROPIC_BASE_URL - send the calls elsewhere (e.g. an AI Gateway).
 */
import Anthropic from "@anthropic-ai/sdk";
import legionBriefing from "../../public/ai/legion-briefing.md?raw";

export interface AiBrainEnv {
  ANTHROPIC_API_KEY?: string;
  AI_MODEL?: string;
  ANTHROPIC_BASE_URL?: string;
}

export type AiOptionIn = { id: string; label: string };
export type AiDecideRequest = {
  app: "legion" | "dnd";
  observation: string;
  notes: string[];
  decision: { kind: string; question: string; options: AiOptionIn[] };
};

const DEFAULT_MODEL = "claude-opus-5-5";
const MAX_OPTIONS = 40;
const MAX_OBSERVATION = 12_000;

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

/** The request body, trimmed to sane sizes; null if it isn't one. */
export function parseDecide(raw: unknown): AiDecideRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const d = r.decision as Record<string, unknown> | undefined;
  if (!d || !Array.isArray(d.options)) return null;
  const options = d.options.slice(0, MAX_OPTIONS).flatMap((o): AiOptionIn[] => {
    const x = o as Record<string, unknown>;
    const id = str(x?.id, 60);
    return id ? [{ id, label: str(x.label, 240) }] : [];
  });
  if (options.length < 2) return null;
  return {
    app: r.app === "dnd" ? "dnd" : "legion",
    observation: str(r.observation, MAX_OBSERVATION),
    notes: Array.isArray(r.notes) ? r.notes.slice(-12).map((n) => str(n, 300)).filter(Boolean) : [],
    decision: { kind: str(d.kind, 40), question: str(d.question, 600), options },
  };
}

const BRIEFINGS: Record<AiDecideRequest["app"], string> = {
  legion: legionBriefing,
  // D&D seats aren't built yet; they'll get their own briefing.
  dnd: "You are an AI player at a D&D table. Pick the option that best fits your character and the scene.",
};

function systemPrompt(app: AiDecideRequest["app"]): string {
  return `${BRIEFINGS[app]}

## Answering

You are the built-in Claude player. Each message gives you the board as
text, your notes from earlier games and one decision with numbered options.
Answer by calling the \`choose\` tool once with the id of the option you
pick. Options are always legal; you can't do anything else. Put a short,
friendly line for the table chat in \`say\` only when it adds something
(a plan, a taunt, a reaction to dice), at most one sentence; leave it empty
otherwise. For a "lesson" decision, \`say\` is the lesson you want to keep.`;
}

const CHOOSE_TOOL: Anthropic.Tool = {
  name: "choose",
  description: "Pick one of the listed options.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      option_id: { type: "string", description: "The id of the option you pick, exactly as listed." },
      say: { type: "string", description: "Optional one-sentence line for the table chat, or an empty string." },
    },
    required: ["option_id", "say"],
    additionalProperties: false,
  },
};

export class AiBrainError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** Ask Claude to pick an option. Throws AiBrainError on a bad request, a
 * missing key or an API failure. */
export async function decide(env: AiBrainEnv, req: AiDecideRequest, seat: { name: string; side: string }): Promise<{ id: string; say?: string }> {
  if (!env.ANTHROPIC_API_KEY) throw new AiBrainError(503, "no-key");
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 40_000,
    ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}),
  });
  const ids = new Set(req.decision.options.map((o) => o.id));
  const user = [
    `You are ${seat.name}, playing ${seat.side}.`,
    req.notes.length ? `Your notes from earlier games:\n${req.notes.map((n) => `- ${n}`).join("\n")}` : "You have no notes from earlier games yet.",
    `The board now:\n${req.observation}`,
    `Decision (${req.decision.kind}): ${req.decision.question}`,
    `Options:\n${req.decision.options.map((o) => `- id "${o.id}": ${o.label}`).join("\n")}`,
  ].join("\n\n");

  let msg: Anthropic.Beta.BetaMessage;
  try {
    msg = await client.beta.messages.create({
      model: env.AI_MODEL || DEFAULT_MODEL,
      max_tokens: 4000,
      // A move a few seconds at a time: low effort keeps the game moving.
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: systemPrompt(req.app), cache_control: { type: "ephemeral" } }],
      tools: [CHOOSE_TOOL],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: user }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new AiBrainError(503, "bad-key");
    if (e instanceof Anthropic.RateLimitError) throw new AiBrainError(429, "rate-limited");
    if (e instanceof Anthropic.APIError) throw new AiBrainError(502, `claude-${e.status ?? "error"}`);
    throw new AiBrainError(502, "claude-unreachable");
  }
  if (msg.stop_reason === "refusal") throw new AiBrainError(502, "refused");
  for (const block of msg.content) {
    if (block.type !== "tool_use" || block.name !== "choose") continue;
    const input = block.input as { option_id?: unknown; say?: unknown };
    const id = typeof input.option_id === "string" ? input.option_id : "";
    if (!ids.has(id)) break;
    const say = typeof input.say === "string" ? input.say.trim().slice(0, 200) : "";
    return say ? { id, say } : { id };
  }
  throw new AiBrainError(502, "no-choice");
}
