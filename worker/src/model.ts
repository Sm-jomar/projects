/**
 * /api/model/* — the hidden, password-gated manual studio at
 * eslegion.com/model. A direct, human-driven alternative to the
 * Tripo Forge Custom GPT flow (see bridge.ts) for testing the pipeline
 * or generating a model by hand without going through ChatGPT at all.
 *
 * Gated by a single shared password (MODEL_PAGE_SECRET), checked on every
 * request via the X-Model-Secret header — same pattern as the existing
 * X-Flag-Secret check on /api/flags. This is a personal tool behind an
 * unlisted route, not a multi-user product, so one shared secret (rather
 * than session/token infra) is the right amount of machinery.
 */
import { tripoUpload, tripoCreateImageToModel, tripoTaskStatus, TripoError, type TripoEnv } from "./tripo";

export interface ModelEnv extends TripoEnv {
  MODEL_PAGE_SECRET?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function authed(request: Request, env: ModelEnv): boolean {
  if (!env.MODEL_PAGE_SECRET) return false; // unconfigured = closed, not open
  return request.headers.get("X-Model-Secret") === env.MODEL_PAGE_SECRET;
}

// data:image/jpeg;base64,<...> -> { bytes, ext }
function parseDataUrl(dataUrl: string): { bytes: Uint8Array; ext: "png" | "jpg" | "jpeg" | "webp" } | null {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  const mime = m[1]!.toLowerCase() as "png" | "jpg" | "jpeg" | "webp";
  try {
    const bin = atob(m[2]!);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, ext: mime };
  } catch {
    return null;
  }
}

// A downscaled photo comfortably fits in a few hundred KB; this is a
// generous ceiling against accidental (or malicious, if the secret ever
// leaks) oversized uploads burning API quota.
const MAX_IMAGE_B64_CHARS = 12_000_000; // ~9MB decoded

export async function handleModel(request: Request, env: ModelEnv, url: URL): Promise<Response> {
  const sub = url.pathname.replace(/^\/api\/model/, "") || "/";

  if (sub === "/auth" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as { password?: string } | null;
    const ok = !!env.MODEL_PAGE_SECRET && body?.password === env.MODEL_PAGE_SECRET;
    return json({ ok });
  }

  // Everything past this point requires the shared secret.
  if (!authed(request, env)) return json({ error: "unauthorized" }, 401);
  if (!env.TRIPO_API_KEY) return json({ error: "TRIPO_API_KEY is not configured on the Worker" }, 503);

  if (sub === "/generate" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as { imageDataUrl?: string; prompt?: string } | null;
    const imageDataUrl = body?.imageDataUrl;
    if (!imageDataUrl || typeof imageDataUrl !== "string") return json({ error: "imageDataUrl is required" }, 400);
    if (imageDataUrl.length > MAX_IMAGE_B64_CHARS) return json({ error: "image too large" }, 413);
    const parsed = parseDataUrl(imageDataUrl);
    if (!parsed) return json({ error: "expected a data:image/(png|jpeg|webp);base64,... URL" }, 400);
    try {
      const fileToken = await tripoUpload(env, parsed.bytes, parsed.ext);
      const taskId = await tripoCreateImageToModel(env, fileToken, parsed.ext, body?.prompt ? { prompt: body.prompt } : undefined);
      return json({ taskId });
    } catch (err) {
      return json({ error: (err as Error).message }, err instanceof TripoError ? 502 : 500);
    }
  }

  const statusMatch = /^\/status\/([^/]+)$/.exec(sub);
  if (statusMatch && request.method === "GET") {
    try {
      const s = await tripoTaskStatus(env, decodeURIComponent(statusMatch[1]!));
      return json({ status: s.status, progress: s.progress, modelUrl: s.outputs.model ?? null, renderedImageUrl: s.outputs.rendered_image ?? null, raw: s.raw });
    } catch (err) {
      return json({ error: (err as Error).message }, err instanceof TripoError ? 502 : 500);
    }
  }

  return json({ error: "not found" }, 404);
}
