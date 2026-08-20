/**
 * The Cloudflare bridge the Tripo Forge Custom GPT talks to, implementing
 * BRIDGE_API_CONTRACT.md exactly (see the tripo-forge-chatgpt-handoff
 * package for the full spec this was built against).
 *
 * Two very different consumers, two very different auth models, both
 * living under /api/ for consistency with the rest of this Worker:
 *
 *   /api/balance, /api/upload-session[/…], /api/generate/…, /api/task/…,
 *   /api/convert
 *     -> called by the GPT's Custom Action. Requires
 *        `Authorization: Bearer <BRIDGE_API_KEY>`. Never reachable from
 *        browser JS (the key is never shipped to a client).
 *
 *   /api/upload-page/{session_id}[/submit]
 *     -> called by the plain browser upload page a human opens from a
 *        link the GPT hands them (see src/upload/UploadPage.tsx). Gated
 *        by the session's own random, single-purpose, short-lived
 *        `token` query param instead — exactly what the contract asks
 *        for ("use an unguessable short-lived session token in its URL
 *        instead of exposing BRIDGE_API_KEY to browser JavaScript").
 *
 *   /health
 *     -> unauthenticated, reveals nothing but {ok:true}.
 */
import {
  tripoUpload, fetchImageBytes, tripoCreateImageToModel, tripoCreateMultiviewToModel,
  tripoConvertModel, tripoTaskStatus, tripoBalance, TripoError, type TripoEnv, type GenerationOptions,
} from "./tripo";
import type { UploadSessionEnv, UploadSessionRecord, UploadMode } from "./uploadSession";

export interface BridgeEnv extends TripoEnv, UploadSessionEnv {
  BRIDGE_API_KEY?: string;
}

const SESSION_TTL_MS = 20 * 60 * 1000; // 20 minutes to open the link and upload
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 30; // generous for one conversational GPT session
const CONVERT_FORMATS = new Set(["STL", "3MF", "OBJ", "FBX", "GLTF", "USDZ"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp"]);

function err(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: code, message }), { status, headers: { "content-type": "application/json" } });
}
function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function requireBearer(request: Request, env: BridgeEnv): Response | null {
  if (!env.BRIDGE_API_KEY) return err("not_configured", "BRIDGE_API_KEY is not set on the Worker", 503);
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== env.BRIDGE_API_KEY) return err("unauthorized", "missing or invalid bridge auth", 401);
  return null;
}

async function rateLimit(env: BridgeEnv): Promise<Response | null> {
  const stub = env.UPLOAD_SESSION.get(env.UPLOAD_SESSION.idFromName("ratelimit"));
  const res = await stub.fetch("https://session/rate/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ windowMs: RATE_WINDOW_MS, max: RATE_MAX_PER_WINDOW }),
  });
  const body = (await res.json()) as { allowed: boolean };
  return body.allowed ? null : err("rate_limited", "too many requests, slow down", 429);
}

function sessionStub(env: BridgeEnv, sessionId: string) {
  return env.UPLOAD_SESSION.get(env.UPLOAD_SESSION.idFromName(sessionId));
}
async function readSession(env: BridgeEnv, sessionId: string): Promise<UploadSessionRecord | null> {
  const res = await sessionStub(env, sessionId).fetch("https://session/state");
  if (res.status === 404) return null;
  return (await res.json()) as UploadSessionRecord;
}

function randomId(prefix: string, len = 16): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  const s = Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, len);
  return `${prefix}_${s}`;
}

function pickOptions(body: Record<string, unknown>): GenerationOptions {
  const opts: GenerationOptions = {};
  if (typeof body.model_version === "string") opts.model_version = body.model_version;
  if (body.geometry_quality === "standard" || body.geometry_quality === "detailed") opts.geometry_quality = body.geometry_quality;
  if (typeof body.face_limit === "number") opts.face_limit = body.face_limit;
  if (typeof body.texture === "boolean") opts.texture = body.texture;
  if (typeof body.pbr === "boolean") opts.pbr = body.pbr;
  if (typeof body.export_uv === "boolean") opts.export_uv = body.export_uv;
  return opts;
}

export async function handleBridge(request: Request, env: BridgeEnv, url: URL): Promise<Response> {
  if (url.pathname === "/health") return ok({ ok: true });

  // --- GPT-facing, Bearer-gated -------------------------------------------
  if (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/upload-page/")) {
    const authErr = requireBearer(request, env);
    if (authErr) return authErr;
    const limited = await rateLimit(env);
    if (limited) return limited;

    if (url.pathname === "/api/balance" && request.method === "GET") {
      try {
        const b = await tripoBalance(env);
        return ok(b);
      } catch (e) {
        return err("tripo_error", (e as Error).message, e instanceof TripoError ? 502 : 500);
      }
    }

    if (url.pathname === "/api/upload-session" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as { mode?: string } & Record<string, unknown> | null;
      if (body?.mode !== "single" && body?.mode !== "multiview") return err("bad_request", "mode must be single or multiview", 400);
      const mode = body.mode as UploadMode;
      const sessionId = randomId("us");
      const token = randomId("tok", 24);
      const now = Date.now();
      const rec: UploadSessionRecord = {
        sessionId, mode, options: pickOptions(body), status: "awaiting_upload",
        token, createdAt: now, expiresAt: now + SESSION_TTL_MS,
      };
      await sessionStub(env, sessionId).fetch("https://session/init", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rec),
      });
      return ok({
        session_id: sessionId,
        upload_url: `${url.origin}/upload/${sessionId}?token=${token}`,
        status: "awaiting_upload",
        expires_at: new Date(rec.expiresAt).toISOString(),
        required_slots: mode === "single" ? ["single"] : ["front", "left", "back", "right"],
      });
    }

    const sessionGet = /^\/api\/upload-session\/([^/]+)$/.exec(url.pathname);
    if (sessionGet && request.method === "GET") {
      const rec = await readSession(env, sessionGet[1]!);
      if (!rec) return err("not_found", "unknown session", 404);
      return ok({
        session_id: rec.sessionId, status: rec.status,
        ...(rec.taskId ? { task_id: rec.taskId } : {}),
        ...(rec.message ? { message: rec.message } : {}),
      });
    }

    if (url.pathname === "/api/generate/single-url" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as { image_url?: string } & Record<string, unknown> | null;
      if (!body?.image_url) return err("bad_request", "image_url is required", 400);
      try {
        const { bytes, ext } = await fetchImageBytes(body.image_url);
        const fileToken = await tripoUpload(env, bytes, ext);
        const taskId = await tripoCreateImageToModel(env, fileToken, ext, pickOptions(body));
        return ok({ task_id: taskId, status: "queued" });
      } catch (e) {
        return err("tripo_error", (e as Error).message, e instanceof TripoError ? 502 : 500);
      }
    }

    if (url.pathname === "/api/generate/multiview-url" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as { image_urls?: string[] } & Record<string, unknown> | null;
      const urls = body?.image_urls;
      if (!Array.isArray(urls) || urls.length !== 4) return err("bad_request", "image_urls must have exactly 4 entries: [front, left, back, right]", 400);
      try {
        const fetched = await Promise.all(urls.map((u) => fetchImageBytes(u)));
        const tokens = await Promise.all(fetched.map((f) => tripoUpload(env, f.bytes, f.ext)));
        const taskId = await tripoCreateMultiviewToModel(
          env, tokens as [string, string, string, string], fetched[0]!.ext, pickOptions(body),
        );
        return ok({ task_id: taskId, status: "queued" });
      } catch (e) {
        return err("tripo_error", (e as Error).message, e instanceof TripoError ? 502 : 500);
      }
    }

    const taskGet = /^\/api\/task\/([^/]+)$/.exec(url.pathname);
    if (taskGet && request.method === "GET") {
      try {
        const s = await tripoTaskStatus(env, taskGet[1]!);
        return ok({
          task_id: s.taskId, status: s.status, progress: s.progress,
          ...(s.status === "failed" ? { message: "Tripo reported this task as failed" } : {}),
          outputs: s.outputs,
        });
      } catch (e) {
        return err("tripo_error", (e as Error).message, e instanceof TripoError ? 502 : 500);
      }
    }

    if (url.pathname === "/api/convert" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as { task_id?: string; format?: string } | null;
      if (!body?.task_id || !body?.format) return err("bad_request", "task_id and format are required", 400);
      if (!CONVERT_FORMATS.has(body.format)) return err("bad_request", `format must be one of ${[...CONVERT_FORMATS].join(", ")}`, 422);
      try {
        const taskId = await tripoConvertModel(env, body.task_id, body.format);
        return ok({ task_id: taskId, status: "queued" });
      } catch (e) {
        return err("tripo_error", (e as Error).message, e instanceof TripoError ? 502 : 500);
      }
    }

    return err("not_found", "no such bridge endpoint", 404);
  }

  // --- Browser-facing, token-gated (the human upload page) ---------------
  const pageInfo = /^\/api\/upload-page\/([^/]+)$/.exec(url.pathname);
  if (pageInfo && request.method === "GET") {
    const rec = await readSession(env, pageInfo[1]!);
    const token = url.searchParams.get("token");
    if (!rec || rec.token !== token) return err("not_found", "unknown or expired upload link", 404);
    if (rec.status === "expired" || Date.now() > rec.expiresAt) return err("expired", "this upload link has expired", 410);
    return ok({
      session_id: rec.sessionId, mode: rec.mode, status: rec.status,
      requiredSlots: rec.mode === "single" ? ["single"] : ["front", "left", "back", "right"],
    });
  }

  const pageSubmit = /^\/api\/upload-page\/([^/]+)\/submit$/.exec(url.pathname);
  if (pageSubmit && request.method === "POST") {
    const sessionId = pageSubmit[1]!;
    const rec = await readSession(env, sessionId);
    const token = url.searchParams.get("token");
    if (!rec || rec.token !== token) return err("not_found", "unknown or expired upload link", 404);
    if (rec.status !== "awaiting_upload") return err("conflict", `session is already ${rec.status}`, 409);
    if (Date.now() > rec.expiresAt) return err("expired", "this upload link has expired", 410);

    await sessionStub(env, sessionId).fetch("https://session/update", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "uploading" }),
    });

    try {
      const form = await request.formData();
      let taskId: string;
      if (rec.mode === "single") {
        const file = form.get("image");
        if (!(file instanceof File)) throw new Error("expected a file field named \"image\"");
        const { bytes, ext } = await bytesFromFile(file);
        const fileToken = await tripoUpload(env, bytes, ext);
        taskId = await tripoCreateImageToModel(env, fileToken, ext, rec.options as GenerationOptions);
      } else {
        const slots = ["front", "left", "back", "right"] as const;
        const files: File[] = [];
        for (const slot of slots) {
          const f = form.get(slot);
          if (!(f instanceof File)) throw new Error(`missing file for the "${slot}" slot`);
          files.push(f);
        }
        const parsed = await Promise.all(files.map(bytesFromFile));
        const tokens = await Promise.all(parsed.map((p) => tripoUpload(env, p.bytes, p.ext)));
        taskId = await tripoCreateMultiviewToModel(env, tokens as [string, string, string, string], parsed[0]!.ext, rec.options as GenerationOptions);
      }
      await sessionStub(env, sessionId).fetch("https://session/update", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "submitted", taskId }),
      });
      return ok({ ok: true, task_id: taskId });
    } catch (e) {
      const message = (e as Error).message;
      await sessionStub(env, sessionId).fetch("https://session/update", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "failed", message }),
      });
      return err("upload_failed", message, 502);
    }
  }

  return err("not_found", "no such bridge endpoint", 404);
}

async function bytesFromFile(file: File): Promise<{ bytes: Uint8Array; ext: "png" | "jpg" | "jpeg" | "webp" }> {
  const type = file.type.toLowerCase();
  const ext = type.includes("webp") ? "webp" : type.includes("png") ? "png" : "jpg";
  if (!IMAGE_EXTS.has(ext)) throw new Error(`unsupported file type: ${file.type}`);
  return { bytes: new Uint8Array(await file.arrayBuffer()), ext };
}
