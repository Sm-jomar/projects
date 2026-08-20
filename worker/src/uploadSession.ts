/**
 * UploadSessionDO — one instance per upload session (addressed by
 * session_id, same per-id-DO pattern as RoomDO), plus one more instance
 * addressed by the fixed name "ratelimit" that this same class is reused
 * for as a simple sliding-window request counter — avoids standing up a
 * fourth DO class just for a rate limiter.
 *
 * A session holds exactly what BRIDGE_API_CONTRACT.md's upload-session
 * endpoints need: the requested mode/options, its status, and — once the
 * browser upload page has submitted images — the resulting Tripo task id.
 * Storage is wiped via a DO alarm once the session expires, per the
 * contract's "delete temporary session data after a reasonable TTL".
 */
import { DurableObject } from "cloudflare:workers";

export interface UploadSessionEnv {
  UPLOAD_SESSION: DurableObjectNamespace;
}

export type UploadMode = "single" | "multiview";
export type UploadSessionStatus = "awaiting_upload" | "uploading" | "submitted" | "failed" | "expired";

export type UploadSessionRecord = {
  sessionId: string;
  mode: UploadMode;
  // Generation options captured at creation time, applied when the
  // browser page finally uploads the image(s) and creates the Tripo task.
  options: Record<string, unknown>;
  status: UploadSessionStatus;
  taskId?: string;
  message?: string;
  token: string; // the unguessable value the upload URL must present
  createdAt: number;
  expiresAt: number;
};

// Extra time past expiry before the DO wipes its own storage — just
// enough slack that a request arriving right at the boundary still sees
// a clean "expired" response rather than a race against deletion.
const WIPE_GRACE_MS = 5 * 60 * 1000;
const RATE_KEY_PREFIX = "rl:";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export class UploadSessionDO extends DurableObject<UploadSessionEnv> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/init" && request.method === "POST") {
      const rec = (await request.json()) as UploadSessionRecord;
      await this.ctx.storage.put("record", rec);
      await this.ctx.storage.setAlarm(rec.expiresAt + WIPE_GRACE_MS);
      return json({ ok: true });
    }

    if (url.pathname === "/state" && request.method === "GET") {
      const rec = await this.ctx.storage.get<UploadSessionRecord>("record");
      if (!rec) return json(null, 404);
      if (Date.now() > rec.expiresAt && rec.status === "awaiting_upload") {
        rec.status = "expired";
        await this.ctx.storage.put("record", rec);
      }
      return json(rec);
    }

    if (url.pathname === "/update" && request.method === "POST") {
      const patch = (await request.json()) as Partial<UploadSessionRecord>;
      const rec = await this.ctx.storage.get<UploadSessionRecord>("record");
      if (!rec) return json({ error: "no such session" }, 404);
      const next = { ...rec, ...patch };
      await this.ctx.storage.put("record", next);
      return json(next);
    }

    // Rate limiting: a fixed-window counter. One bucket key per window,
    // auto-expiring via the same wipe mechanism (a fresh window is just a
    // fresh key, so nothing to clean up — the DO as a whole still gets
    // reaped by inactivity like any other, and this instance is reused
    // indefinitely under the fixed "ratelimit" name).
    if (url.pathname === "/rate/check" && request.method === "POST") {
      const { windowMs, max } = (await request.json()) as { windowMs: number; max: number };
      const bucket = Math.floor(Date.now() / windowMs);
      const key = `${RATE_KEY_PREFIX}${bucket}`;
      const count = ((await this.ctx.storage.get<number>(key)) ?? 0) + 1;
      await this.ctx.storage.put(key, count);
      // Opportunistically drop old buckets so this doesn't grow forever.
      const all = await this.ctx.storage.list<number>({ prefix: RATE_KEY_PREFIX });
      const stale = [...all.keys()].filter((k) => k !== key).slice(0, -1);
      if (stale.length > 20) await this.ctx.storage.delete(stale);
      return json({ allowed: count <= max, remaining: Math.max(0, max - count) });
    }

    return json({ error: "not found" }, 404);
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
