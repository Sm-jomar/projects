/**
 * /api/stl/<sha256> — shared storage for uploaded STL models.
 *
 * A detailed model (up to 500k triangles) is a few MB, far past the 2 MB
 * board a room syncs. So the uploader PUTs the encoded model here once and
 * the board carries only "stlref:<sha256>"; every player's browser GETs it
 * (and keeps it cached) by that hash.
 *
 * Storage is content-addressed: the hash must match the body, so a model can
 * never be overwritten or swapped for another, and stored models are
 * immutable (cacheable forever). One StlStoreDO per model, addressed by its
 * hash, holds the bytes in 128 KiB chunks. Uploads are rate-limited per IP.
 */
import { DurableObject } from "cloudflare:workers";
import { rateCheck, type CampaignEnv } from "./campaign";

export interface StlEnv extends CampaignEnv {
  STL_STORE: DurableObjectNamespace<StlStoreDO>;
}

const HASH_RE = /^[0-9a-f]{64}$/;
// Encoded models are ~6 bytes a triangle; 500k triangles is about 3 MB.
const MAX_BYTES = 16 * 1024 * 1024;
const CHUNK = 128 * 1024;

export class StlStoreDO extends DurableObject<StlEnv> {
  async has(): Promise<boolean> {
    return (await this.ctx.storage.get<number>("size")) !== undefined;
  }

  async put(bytes: Uint8Array): Promise<void> {
    if (await this.has()) return;
    const entries: Record<string, Uint8Array | number> = {};
    for (let i = 0, n = 0; i < bytes.length; i += CHUNK, n++) entries[`c${n}`] = bytes.slice(i, i + CHUNK);
    // "size" goes in the same atomic put, so a half-written model never reads as stored.
    entries.size = bytes.length;
    await this.ctx.storage.put(entries);
  }

  async get(): Promise<Uint8Array | null> {
    const size = await this.ctx.storage.get<number>("size");
    if (size === undefined) return null;
    const keys = Array.from({ length: Math.ceil(size / CHUNK) }, (_, n) => `c${n}`);
    const chunks = await this.ctx.storage.get<Uint8Array>(keys);
    const out = new Uint8Array(size);
    keys.forEach((k, n) => { const c = chunks.get(k); if (c) out.set(c, n * CHUNK); });
    return out;
  }
}

export async function handleStl(request: Request, env: StlEnv, url: URL): Promise<Response> {
  const hash = url.pathname.slice("/api/stl/".length);
  if (!HASH_RE.test(hash)) return new Response("bad model id", { status: 400 });
  const stub = env.STL_STORE.get(env.STL_STORE.idFromName(hash));

  if (request.method === "GET") {
    const cache = (caches as unknown as { default: Cache }).default;
    const hit = await cache.match(request);
    if (hit) return hit;
    const bytes = await stub.get();
    if (!bytes) return new Response("not found", { status: 404, headers: { "cache-control": "no-store" } });
    const res = new Response(bytes, {
      headers: {
        "content-type": "application/octet-stream",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
    await cache.put(request, res.clone());
    return res;
  }

  if (request.method === "PUT") {
    const len = Number(request.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) return new Response("model too large", { status: 413 });
    if (await stub.has()) return Response.json({ ok: true });
    const ip = request.headers.get("CF-Connecting-IP") ?? "anon";
    const allowed = await rateCheck(env, `ratelimit:stl:${ip}`, 600_000, 60)
      && await rateCheck(env, "ratelimit:stl:all", 600_000, 600);
    if (!allowed) return new Response("too many uploads, try again in a few minutes", { status: 429 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return new Response("model too large", { status: 413 });
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
    if (hex !== hash) return new Response("hash does not match the model", { status: 400 });
    await stub.put(bytes);
    return Response.json({ ok: true }, { status: 201 });
  }

  return new Response("method not allowed", { status: 405 });
}
