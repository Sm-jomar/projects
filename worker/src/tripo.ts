/**
 * Tripo AI API client — pure request/response helpers, no auth or routing
 * concerns of our own. Shared by:
 *   - bridge.ts   (the Custom GPT Action's bridge, BRIDGE_API_KEY-gated)
 *   - model.ts    (the manual /model studio, password-gated)
 *
 * NOTE ON ACCURACY: built against Tripo's documented v2 OpenAPI task shape
 * (upload -> create task -> poll task, code/data envelope) from training
 * knowledge and public search results — this sandbox's egress policy
 * blocks tripo3d.ai's own doc domains, so it could not be verified against
 * a live fetch. The field names in parseTaskStatus() are the part most
 * likely to need a small correction after the first real run; the `raw`
 * field on every normalized result carries the full Tripo response back
 * so a mismatch is easy to spot and fix.
 */

export interface TripoEnv {
  TRIPO_API_KEY?: string;
}

const TRIPO_BASE = "https://api.tripo3d.ai/v2/openapi";

export class TripoError extends Error {}

async function tripoFetch(env: TripoEnv, path: string, init: RequestInit): Promise<Response> {
  return fetch(`${TRIPO_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.TRIPO_API_KEY}`, ...(init.headers ?? {}) },
  });
}

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!res.ok) {
    throw new TripoError(`Tripo ${res.status}: ${body?.message ?? (await res.text().catch(() => "")) || res.statusText}`);
  }
  if (body == null) throw new TripoError("Tripo returned an empty/invalid response");
  return body;
}

// --- Upload -----------------------------------------------------------

export async function tripoUpload(env: TripoEnv, bytes: Uint8Array, ext: "png" | "jpg" | "jpeg" | "webp"): Promise<string> {
  const form = new FormData();
  const mime = ext === "jpg" ? "jpeg" : ext;
  form.append("file", new Blob([bytes], { type: `image/${mime}` }), `upload.${ext}`);
  const res = await tripoFetch(env, "/upload", { method: "POST", body: form });
  const body = await readJson<{ data?: { image_token?: string } }>(res);
  const token = body.data?.image_token;
  if (!token) throw new TripoError("Tripo upload succeeded but returned no image_token");
  return token;
}

export async function fetchImageBytes(url: string): Promise<{ bytes: Uint8Array; ext: "png" | "jpg" | "jpeg" | "webp" }> {
  const res = await fetch(url);
  if (!res.ok) throw new TripoError(`could not fetch image_url (${res.status})`);
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  const ext = ct.includes("webp") ? "webp" : ct.includes("png") ? "png" : "jpg";
  const buf = new Uint8Array(await res.arrayBuffer());
  return { bytes: buf, ext };
}

// --- Task creation ------------------------------------------------------

export type GenerationOptions = {
  model_version?: string;
  geometry_quality?: "standard" | "detailed";
  face_limit?: number;
  texture?: boolean;
  pbr?: boolean;
  export_uv?: boolean;
  /** Free-text style/refinement guidance, max 1024 chars. Not part of the
   * Custom GPT's bridge contract (the GPT directs style by generating a
   * good reference image instead), but the manual /model studio exposes
   * it directly since Tripo's image_to_model task does accept it. */
  prompt?: string;
};

// Detailed-miniature defaults the GPT expects, applied only where the
// caller hasn't supplied an explicit value (never silently overridden).
const DEFAULT_OPTS: Required<Omit<GenerationOptions, "face_limit">> = {
  model_version: "v3.1-20260211",
  geometry_quality: "detailed",
  texture: true,
  pbr: true,
  export_uv: true,
};

function withDefaults(opts: GenerationOptions | undefined): GenerationOptions {
  return { ...DEFAULT_OPTS, ...(opts ?? {}) };
}

export async function tripoCreateImageToModel(
  env: TripoEnv, fileToken: string, ext: string, opts?: GenerationOptions,
): Promise<string> {
  const merged = withDefaults(opts);
  if (merged.prompt) merged.prompt = merged.prompt.slice(0, 1024);
  const res = await tripoFetch(env, "/task", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "image_to_model",
      file: { type: ext, file_token: fileToken },
      ...merged,
    }),
  });
  const body = await readJson<{ data?: { task_id?: string } }>(res);
  if (!body.data?.task_id) throw new TripoError("Tripo task creation succeeded but returned no task_id");
  return body.data.task_id;
}

export async function tripoCreateMultiviewToModel(
  env: TripoEnv,
  // Exactly [front, left, back, right] file tokens, same order the caller
  // uploaded them in.
  fileTokens: [string, string, string, string],
  ext: string,
  opts?: GenerationOptions,
): Promise<string> {
  const merged = withDefaults(opts);
  const res = await tripoFetch(env, "/task", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "multiview_to_model",
      files: fileTokens.map((t) => ({ type: ext, file_token: t })),
      ...merged,
    }),
  });
  const body = await readJson<{ data?: { task_id?: string } }>(res);
  if (!body.data?.task_id) throw new TripoError("Tripo multiview task creation succeeded but returned no task_id");
  return body.data.task_id;
}

export async function tripoConvertModel(env: TripoEnv, sourceTaskId: string, format: string): Promise<string> {
  const res = await tripoFetch(env, "/task", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "convert_model", format, original_model_task_id: sourceTaskId }),
  });
  const body = await readJson<{ data?: { task_id?: string } }>(res);
  if (!body.data?.task_id) throw new TripoError("Tripo conversion task creation succeeded but returned no task_id");
  return body.data.task_id;
}

// --- Status / balance -----------------------------------------------------

export type NormalizedStatus = "queued" | "running" | "success" | "failed" | "unknown";

export type TaskStatus = {
  taskId: string;
  status: NormalizedStatus;
  progress: number;
  message?: string;
  outputs: Record<string, string>;
  raw: unknown;
};

function normalizeStatus(tripoStatus: string | undefined): NormalizedStatus {
  switch (tripoStatus) {
    case "queued": case "queuing": return "queued";
    case "running": return "running";
    case "success": return "success";
    case "failed": case "banned": case "cancelled": case "expired": return "failed";
    default: return "unknown";
  }
}

export async function tripoTaskStatus(env: TripoEnv, taskId: string): Promise<TaskStatus> {
  const res = await tripoFetch(env, `/task/${encodeURIComponent(taskId)}`, {});
  const body = await readJson<{ data?: { status?: string; progress?: number; output?: Record<string, unknown> } }>(res);
  const out = body.data?.output ?? {};
  const outputs: Record<string, string> = {};
  for (const [k, v] of Object.entries(out)) if (typeof v === "string") outputs[k] = v;
  // Prefer a PBR/base model URL under the conventional "model" key so
  // every caller can read outputs.model without knowing Tripo's exact
  // field naming for this task type.
  if (!outputs.model) {
    const fallback = out.pbr_model ?? out.base_model;
    if (typeof fallback === "string") outputs.model = fallback;
  }
  return {
    taskId,
    status: normalizeStatus(body.data?.status),
    progress: typeof body.data?.progress === "number" ? body.data.progress : 0,
    outputs,
    raw: body,
  };
}

export async function tripoBalance(env: TripoEnv): Promise<{ balance: number; unit: string; raw: unknown }> {
  const res = await tripoFetch(env, "/user/balance", {});
  const body = await readJson<{ data?: { balance?: number; frozen?: number } }>(res);
  return { balance: body.data?.balance ?? 0, unit: "credits", raw: body };
}
