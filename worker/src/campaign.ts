/**
 * Campaigns: persistent, shareable D&D campaign data (DM notes, NPC sheets,
 * saved maps), one CampaignDO per campaign, addressed by campaign id.
 *
 * There are no accounts. Access is by share code, `<campaignId>.<secret>`,
 * where the secret decides the role: owner > codm (Co-DM) > player. The
 * role is always resolved here, server-side — players never receive DM-only
 * notes, NPCs, maps or codes. Codes travel in the X-Campaign-Code header
 * (never the URL) and are never logged.
 *
 * Unknown campaign and wrong secret both answer 404, so a guess reveals
 * nothing; 403 only follows a valid code whose role is too low. Nothing is
 * written to storage until a code has been accepted (or on create).
 */
import { DurableObject } from "cloudflare:workers";

export interface CampaignEnv {
  CAMPAIGN: DurableObjectNamespace<CampaignDO>;
  UPLOAD_SESSION: DurableObjectNamespace;
}

export type CampaignRole = "owner" | "codm" | "player";
const RANK: Record<CampaignRole, number> = { player: 1, codm: 2, owner: 3 };

type Secrets = Record<CampaignRole, string>;
type Meta = {
  v: 1;
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  secrets: Secrets;
};
export type CampaignNote = {
  id: string;
  title: string;
  body: string;
  visibility: "dm" | "players";
  updatedAt: number;
};
export type CampaignNpc = { id: string; character: unknown; dmNotes: string; updatedAt: number };
export type CampaignMapSummary = {
  id: string;
  name: string;
  cols: number;
  rows: number;
  tokenCount: number;
  hasImage: boolean;
  bytes: number;
  updatedAt: number;
};
type MapData = { map: Record<string, unknown>; tokens: unknown[]; terrain?: unknown[] };

export type CampaignView = {
  role: CampaignRole;
  campaign: { id: string; name: string; description: string; updatedAt: number };
  notes: CampaignNote[];
  npcs?: CampaignNpc[];
  maps?: CampaignMapSummary[];
  codes?: Partial<Record<CampaignRole, string>>;
};

type Fail = { ok: false; status: number; error: string; message: string };
type Ok<T> = { ok: true; value: T };
type Result<T> = Ok<T> | Fail;

const fail = (status: number, error: string, message: string): Fail => ({ ok: false, status, error, message });
const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
const NOT_FOUND = fail(404, "not_found", "No campaign matches that code.");

const ID_RE = /^[a-z2-7]{16}$/;
const SECRET_RE = /^[a-z2-7]{26}$/;
const ITEM_ID_RE = /^[a-z0-9_]{1,40}$/;
const LIMITS = {
  name: 80,
  description: 2000,
  noteTitle: 200,
  noteBody: 64_000,
  notes: 300,
  npcBytes: 256_000,
  npcNotes: 16_000,
  npcs: 200,
  mapName: 80,
  mapBytes: 1_500_000,
  mapTokens: 500,
  mapTerrain: 300,
  maps: 100,
};

// --- codes -------------------------------------------------------------

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
function b32(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += B32[b & 31];
  return out;
}
export function newCampaignId(): string { return b32(16); }
function newSecret(): string { return b32(26); }

export function parseCode(raw: string | null): { id: string; secret: string } | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  const dot = s.indexOf(".");
  if (dot < 0) return null;
  const id = s.slice(0, dot), secret = s.slice(dot + 1);
  return ID_RE.test(id) && SECRET_RE.test(secret) ? { id, secret } : null;
}

function safeEq(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  if (ea.byteLength !== eb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ea, eb);
}

// --- validation ----------------------------------------------------------

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function summarize(id: string, name: string, data: MapData, bytes: number, updatedAt: number): CampaignMapSummary {
  const m = data.map;
  return {
    id, name,
    cols: typeof m.cols === "number" ? m.cols : 0,
    rows: typeof m.rows === "number" ? m.rows : 0,
    tokenCount: data.tokens.length,
    hasImage: typeof m.imageUrl === "string" && m.imageUrl.length > 0,
    bytes,
    updatedAt,
  };
}

// --- Durable Object -------------------------------------------------------

export class CampaignDO extends DurableObject<CampaignEnv> {
  private async meta(): Promise<Meta | undefined> {
    return this.ctx.storage.get<Meta>("meta");
  }

  private async auth(code: string): Promise<{ role: CampaignRole; meta: Meta } | null> {
    const parsed = parseCode(code);
    if (!parsed) return null;
    const meta = await this.meta();
    if (!meta || meta.id !== parsed.id) return null;
    for (const role of ["owner", "codm", "player"] as const) {
      if (safeEq(parsed.secret, meta.secrets[role])) return { role, meta };
    }
    return null;
  }

  private async authAtLeast(code: string, min: CampaignRole): Promise<Result<{ role: CampaignRole; meta: Meta }>> {
    const a = await this.auth(code);
    if (!a) return NOT_FOUND;
    if (RANK[a.role] < RANK[min]) {
      return fail(403, "forbidden", min === "owner"
        ? "Only the campaign owner can do this."
        : "That code can't do this — it needs a Co-DM or owner code.");
    }
    return ok(a);
  }

  private async touch(meta: Meta): Promise<void> {
    await this.ctx.storage.put("meta", { ...meta, updatedAt: Date.now() });
  }

  private async buildView(role: CampaignRole, meta: Meta): Promise<CampaignView> {
    const notes = [...(await this.ctx.storage.list<CampaignNote>({ prefix: "note:" })).values()]
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const campaign = { id: meta.id, name: meta.name, description: meta.description, updatedAt: meta.updatedAt };
    if (role === "player") {
      return { role, campaign, notes: notes.filter((n) => n.visibility === "players") };
    }
    const npcs = [...(await this.ctx.storage.list<CampaignNpc>({ prefix: "npc:" })).values()]
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const maps = [...(await this.ctx.storage.list<CampaignMapSummary>({ prefix: "map:" })).values()]
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const code = (r: CampaignRole) => `${meta.id}.${meta.secrets[r]}`;
    const codes: CampaignView["codes"] = { codm: code("codm"), player: code("player") };
    if (role === "owner") codes.owner = code("owner");
    return { role, campaign, notes, npcs, maps, codes };
  }

  async init(input: { id: string; name: string; description: string }): Promise<Result<{ code: string; view: CampaignView }>> {
    if (await this.meta()) return fail(409, "exists", "Campaign already exists.");
    const now = Date.now();
    const meta: Meta = {
      v: 1,
      id: input.id,
      name: str(input.name, LIMITS.name).trim() || "Untitled campaign",
      description: str(input.description, LIMITS.description),
      createdAt: now,
      updatedAt: now,
      secrets: { owner: newSecret(), codm: newSecret(), player: newSecret() },
    };
    await this.ctx.storage.put("meta", meta);
    return ok({ code: `${meta.id}.${meta.secrets.owner}`, view: await this.buildView("owner", meta) });
  }

  async view(code: string): Promise<Result<CampaignView>> {
    const a = await this.auth(code);
    if (!a) return NOT_FOUND;
    return ok(await this.buildView(a.role, a.meta));
  }

  /** Whether this campaign still exists (room server: unlink deleted ones). */
  async exists(): Promise<boolean> {
    return !!(await this.meta());
  }

  /** Used by the room server to check a code without exposing anything else. */
  async verify(code: string): Promise<{ id: string; name: string; role: CampaignRole } | null> {
    const a = await this.auth(code);
    return a ? { id: a.meta.id, name: a.meta.name, role: a.role } : null;
  }

  async patchMeta(code: string, patch: { name?: unknown; description?: unknown }): Promise<Result<CampaignView>> {
    const r = await this.authAtLeast(code, "codm");
    if (!r.ok) return r;
    const meta = { ...r.value.meta, updatedAt: Date.now() };
    if (patch.name !== undefined) meta.name = str(patch.name, LIMITS.name).trim() || meta.name;
    if (patch.description !== undefined) meta.description = str(patch.description, LIMITS.description);
    await this.ctx.storage.put("meta", meta);
    return ok(await this.buildView(r.value.role, meta));
  }

  async putNote(code: string, input: Record<string, unknown>): Promise<Result<CampaignNote>> {
    const r = await this.authAtLeast(code, "codm");
    if (!r.ok) return r;
    const id = str(input.id, 41);
    if (!ITEM_ID_RE.test(id)) return fail(400, "bad_id", "Invalid note id.");
    const key = `note:${id}`;
    if (!(await this.ctx.storage.get(key))) {
      const count = (await this.ctx.storage.list({ prefix: "note:" })).size;
      if (count >= LIMITS.notes) return fail(422, "limit", `A campaign can hold ${LIMITS.notes} notes.`);
    }
    if (typeof input.body === "string" && input.body.length > LIMITS.noteBody) return fail(413, "too_large", "Note is too long.");
    const note: CampaignNote = {
      id,
      title: str(input.title, LIMITS.noteTitle),
      body: str(input.body, LIMITS.noteBody),
      visibility: input.visibility === "players" ? "players" : "dm",
      updatedAt: Date.now(),
    };
    await this.ctx.storage.put(key, note);
    await this.touch(r.value.meta);
    return ok(note);
  }

  async deleteNote(code: string, id: string): Promise<Result<null>> {
    const r = await this.authAtLeast(code, "codm");
    if (!r.ok) return r;
    await this.ctx.storage.delete(`note:${id}`);
    await this.touch(r.value.meta);
    return ok(null);
  }

  async putNpc(code: string, input: Record<string, unknown>): Promise<Result<CampaignNpc>> {
    const r = await this.authAtLeast(code, "codm");
    if (!r.ok) return r;
    const id = str(input.id, 41);
    if (!ITEM_ID_RE.test(id)) return fail(400, "bad_id", "Invalid NPC id.");
    if (!isObj(input.character)) return fail(400, "bad_npc", "NPC needs a character sheet.");
    if (JSON.stringify(input.character).length > LIMITS.npcBytes) return fail(413, "too_large", "NPC sheet is too large.");
    const key = `npc:${id}`;
    if (!(await this.ctx.storage.get(key))) {
      const count = (await this.ctx.storage.list({ prefix: "npc:" })).size;
      if (count >= LIMITS.npcs) return fail(422, "limit", `A campaign can hold ${LIMITS.npcs} NPCs.`);
    }
    const npc: CampaignNpc = {
      id,
      character: { ...input.character, id },
      dmNotes: str(input.dmNotes, LIMITS.npcNotes),
      updatedAt: Date.now(),
    };
    await this.ctx.storage.put(key, npc);
    await this.touch(r.value.meta);
    return ok(npc);
  }

  async deleteNpc(code: string, id: string): Promise<Result<null>> {
    const r = await this.authAtLeast(code, "codm");
    if (!r.ok) return r;
    await this.ctx.storage.delete(`npc:${id}`);
    await this.touch(r.value.meta);
    return ok(null);
  }

  // Maps are split across two keys so listing summaries never loads the
  // (potentially ~1MB) image data: map:<id> is the summary, mapdata:<id>
  // the board. Both are written in one atomic put.
  async putMap(code: string, input: { id?: unknown; name?: unknown; data?: unknown }): Promise<Result<CampaignMapSummary>> {
    const r = await this.authAtLeast(code, "codm");
    if (!r.ok) return r;
    const id = str(input.id, 41);
    if (!ITEM_ID_RE.test(id)) return fail(400, "bad_id", "Invalid map id.");
    const d = input.data;
    if (!isObj(d) || !isObj(d.map) || !Array.isArray(d.tokens)) return fail(400, "bad_map", "Map needs {map, tokens}.");
    if (d.tokens.length > LIMITS.mapTokens) return fail(422, "limit", `A saved map can hold ${LIMITS.mapTokens} tokens.`);
    if (d.terrain !== undefined && (!Array.isArray(d.terrain) || d.terrain.length > LIMITS.mapTerrain)) {
      return fail(422, "limit", `A saved map can hold ${LIMITS.mapTerrain} terrain pieces.`);
    }
    const data: MapData = { map: d.map, tokens: d.tokens, ...(Array.isArray(d.terrain) ? { terrain: d.terrain } : {}) };
    const bytes = JSON.stringify(data).length;
    if (bytes > LIMITS.mapBytes) return fail(413, "too_large", "That map is too large to save — try a smaller image.");
    const prev = await this.ctx.storage.get<CampaignMapSummary>(`map:${id}`);
    if (!prev) {
      const count = (await this.ctx.storage.list({ prefix: "map:" })).size;
      if (count >= LIMITS.maps) return fail(422, "limit", `A campaign can hold ${LIMITS.maps} maps.`);
    }
    const name = str(input.name, LIMITS.mapName).trim() || prev?.name || "Untitled map";
    const summary = summarize(id, name, data, bytes, Date.now());
    await this.ctx.storage.put({ [`map:${id}`]: summary, [`mapdata:${id}`]: data });
    await this.touch(r.value.meta);
    return ok(summary);
  }

  async getMap(code: string, id: string): Promise<Result<{ summary: CampaignMapSummary; data: MapData }>> {
    const r = await this.authAtLeast(code, "codm");
    if (!r.ok) return r;
    const [summary, data] = await Promise.all([
      this.ctx.storage.get<CampaignMapSummary>(`map:${id}`),
      this.ctx.storage.get<MapData>(`mapdata:${id}`),
    ]);
    if (!summary || !data) return fail(404, "not_found", "No such map.");
    return ok({ summary, data });
  }

  async renameMap(code: string, id: string, name: unknown): Promise<Result<CampaignMapSummary>> {
    const r = await this.authAtLeast(code, "codm");
    if (!r.ok) return r;
    const prev = await this.ctx.storage.get<CampaignMapSummary>(`map:${id}`);
    if (!prev) return fail(404, "not_found", "No such map.");
    const summary = { ...prev, name: str(name, LIMITS.mapName).trim() || prev.name, updatedAt: Date.now() };
    await this.ctx.storage.put(`map:${id}`, summary);
    return ok(summary);
  }

  async deleteMap(code: string, id: string): Promise<Result<null>> {
    const r = await this.authAtLeast(code, "codm");
    if (!r.ok) return r;
    await this.ctx.storage.delete([`map:${id}`, `mapdata:${id}`]);
    await this.touch(r.value.meta);
    return ok(null);
  }

  /** Replace one role's secret, invalidating every copy of the old code. */
  async rotate(code: string, role: unknown): Promise<Result<{ code: string }>> {
    const r = await this.authAtLeast(code, "owner");
    if (!r.ok) return r;
    if (role !== "owner" && role !== "codm" && role !== "player") return fail(400, "bad_role", "Unknown role.");
    const meta = { ...r.value.meta, secrets: { ...r.value.meta.secrets, [role]: newSecret() }, updatedAt: Date.now() };
    await this.ctx.storage.put("meta", meta);
    return ok({ code: `${meta.id}.${meta.secrets[role]}` });
  }

  async destroy(code: string): Promise<Result<null>> {
    const r = await this.authAtLeast(code, "owner");
    if (!r.ok) return r;
    await this.ctx.storage.deleteAll();
    return ok(null);
  }
}

// --- HTTP routes --------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function err(status: number, error: string, message: string): Response {
  return json({ error, message }, status);
}
function respond<T>(r: Result<T>, status = 200): Response {
  return r.ok ? json(r.value, status) : err(r.status, r.error, r.message);
}

async function rateCheck(env: CampaignEnv, name: string, windowMs: number, max: number): Promise<boolean> {
  const stub = env.UPLOAD_SESSION.get(env.UPLOAD_SESSION.idFromName(name));
  const res = await stub.fetch("https://session/rate/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ windowMs, max }),
  });
  const body = (await res.json()) as { allowed: boolean };
  return body.allowed;
}

async function readBody(request: Request, limit: number): Promise<Record<string, unknown> | Response> {
  const text = await request.text();
  if (text.length > limit) return err(413, "too_large", "Request body is too large.");
  if (!text) return {};
  try {
    const v = JSON.parse(text) as unknown;
    return isObj(v) ? v : err(400, "bad_json", "Expected a JSON object.");
  } catch {
    return err(400, "bad_json", "Malformed JSON.");
  }
}

export async function handleCampaign(request: Request, env: CampaignEnv, url: URL): Promise<Response> {
  const sub = url.pathname.replace(/^\/api\/campaign/, "");
  const method = request.method;

  // Create: anyone may make a campaign (rate-limited per IP and overall,
  // on dedicated limiter instances so this never eats the GPT bridge's).
  if (sub === "" && method === "POST") {
    const ip = request.headers.get("CF-Connecting-IP") ?? "anon";
    const allowed = await rateCheck(env, `ratelimit:campaign:${ip}`, 600_000, 10)
      && await rateCheck(env, "ratelimit:campaign:all", 600_000, 120);
    if (!allowed) return err(429, "rate_limited", "Too many new campaigns — try again in a few minutes.");
    const body = await readBody(request, 10_000);
    if (body instanceof Response) return body;
    const id = newCampaignId();
    const stub = env.CAMPAIGN.get(env.CAMPAIGN.idFromName(id));
    return respond(await stub.init({ id, name: str(body.name, LIMITS.name), description: str(body.description, LIMITS.description) }), 201);
  }

  const rawCode = request.headers.get("X-Campaign-Code");
  if (!rawCode) return err(401, "code_required", "Send a campaign code in the X-Campaign-Code header.");
  const parsed = parseCode(rawCode);
  if (!parsed) return err(404, "not_found", "No campaign matches that code.");
  const code = `${parsed.id}.${parsed.secret}`;
  const stub = env.CAMPAIGN.get(env.CAMPAIGN.idFromName(parsed.id));

  if (sub === "") {
    if (method === "GET") return respond(await stub.view(code));
    if (method === "PATCH") {
      const body = await readBody(request, 10_000);
      if (body instanceof Response) return body;
      return respond(await stub.patchMeta(code, { name: body.name, description: body.description }));
    }
    if (method === "DELETE") {
      const r = await stub.destroy(code);
      return r.ok ? new Response(null, { status: 204 }) : respond(r);
    }
  }

  if (sub === "/rotate" && method === "POST") {
    const body = await readBody(request, 1_000);
    if (body instanceof Response) return body;
    return respond(await stub.rotate(code, body.role));
  }

  const item = /^\/(notes|npcs|maps)\/([a-z0-9_]{1,40})$/.exec(sub);
  if (item) {
    const [, kind, id] = item as unknown as [string, "notes" | "npcs" | "maps", string];
    if (kind === "notes") {
      if (method === "PUT") {
        const body = await readBody(request, 300_000);
        if (body instanceof Response) return body;
        return respond(await stub.putNote(code, { ...body, id }));
      }
      if (method === "DELETE") return respond(await stub.deleteNote(code, id));
    }
    if (kind === "npcs") {
      if (method === "PUT") {
        const body = await readBody(request, 300_000);
        if (body instanceof Response) return body;
        return respond(await stub.putNpc(code, { ...body, id }));
      }
      if (method === "DELETE") return respond(await stub.deleteNpc(code, id));
    }
    if (kind === "maps") {
      if (method === "GET") return respond(await stub.getMap(code, id));
      if (method === "PUT") {
        const body = await readBody(request, 2_000_000);
        if (body instanceof Response) return body;
        return respond(await stub.putMap(code, { id, name: body.name, data: body.data }));
      }
      if (method === "PATCH") {
        const body = await readBody(request, 1_000);
        if (body instanceof Response) return body;
        return respond(await stub.renameMap(code, id, body.name));
      }
      if (method === "DELETE") return respond(await stub.deleteMap(code, id));
    }
  }

  return err(404, "not_found", "No such campaign endpoint.");
}
