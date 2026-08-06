/**
 * LobbyDO — a single Durable Object that indexes the currently-active
 * rooms so the site can show a "live games" list.
 *
 * Durable Objects can't be enumerated by the platform (they're addressed
 * by name, not listed), so rooms push their roster here whenever it
 * changes and this object keeps the directory. It's a cache, not a
 * source of truth: entries are pruned when they go stale, so a room that
 * dies without saying goodbye disappears on its own.
 *
 * Addressed by the fixed name "global" — one lobby for the whole site.
 */
import { DurableObject } from "cloudflare:workers";

export interface LobbyEnv {
  LOBBY: DurableObjectNamespace;
}

export type LobbyPlayer = { name: string; color: string };

export type LobbySession = {
  code: string;
  app: "legion" | "dnd";
  players: LobbyPlayer[];
  /** When the room first reported in (ms epoch). */
  startedAt: number;
  /** Last time the room reported (ms epoch); drives staleness. */
  updatedAt: number;
};

const KEY_PREFIX = "room:";
// A room re-reports on every roster change and at least once a minute
// while it's being played, so anything quiet for this long is gone.
const STALE_MS = 5 * 60 * 1000;

export class LobbyDO extends DurableObject<LobbyEnv> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/report" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as
        | { code?: string; app?: string; players?: LobbyPlayer[] }
        | null;
      if (!body?.code) return new Response("bad request", { status: 400 });

      const code = String(body.code).toUpperCase().slice(0, 12);
      const key = KEY_PREFIX + code;
      const players = Array.isArray(body.players) ? body.players.slice(0, 16) : [];

      if (players.length === 0) {
        // Last player left — drop it from the directory immediately.
        await this.ctx.storage.delete(key);
        return Response.json({ ok: true, removed: true });
      }

      const now = Date.now();
      const existing = await this.ctx.storage.get<LobbySession>(key);
      const entry: LobbySession = {
        code,
        app: body.app === "dnd" ? "dnd" : "legion",
        players: players.map((p) => ({
          name: String(p?.name ?? "").slice(0, 24),
          color: String(p?.color ?? "").slice(0, 16),
        })),
        startedAt: existing?.startedAt ?? now,
        updatedAt: now,
      };
      await this.ctx.storage.put(key, entry);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/list") {
      const map = await this.ctx.storage.list<LobbySession>({ prefix: KEY_PREFIX });
      const now = Date.now();
      const sessions: LobbySession[] = [];
      const stale: string[] = [];
      for (const [key, s] of map) {
        if (now - s.updatedAt > STALE_MS) stale.push(key);
        else sessions.push(s);
      }
      // Opportunistic cleanup of anything that timed out.
      if (stale.length) await this.ctx.storage.delete(stale);
      sessions.sort((a, b) => b.updatedAt - a.updatedAt);
      return Response.json({ sessions });
    }

    return new Response("not found", { status: 404 });
  }
}
