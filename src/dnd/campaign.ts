// Client side of shareable campaigns (see worker/src/campaign.ts). The
// server decides what a code can see; nothing here is trusted for access.

import type { DndCharacter } from "./dndTypes";
import type { DndMap, DndToken } from "./dndTabletop";

export type CampaignRole = "owner" | "codm" | "player";
export const ROLE_RANK: Record<CampaignRole, number> = { player: 1, codm: 2, owner: 3 };
export const ROLE_LABEL: Record<CampaignRole, string> = { owner: "Owner", codm: "Co-DM", player: "Player" };
export function canEdit(role: CampaignRole): boolean { return ROLE_RANK[role] >= ROLE_RANK.codm; }

export type NoteVisibility = "dm" | "players";
export type CampaignNote = { id: string; title: string; body: string; visibility: NoteVisibility; updatedAt: number };
export type CampaignNpc = { id: string; character: DndCharacter; dmNotes: string; updatedAt: number };
export type CampaignMapSummary = {
  id: string; name: string; cols: number; rows: number;
  tokenCount: number; hasImage: boolean; bytes: number; updatedAt: number;
};
export type CampaignMapData = { map: DndMap; tokens: DndToken[] };
export type CampaignView = {
  role: CampaignRole;
  campaign: { id: string; name: string; description: string; updatedAt: number };
  notes: CampaignNote[];
  npcs?: CampaignNpc[];
  maps?: CampaignMapSummary[];
  codes?: Partial<Record<CampaignRole, string>>;
};

export class CampaignError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const CODE_RE = /^([a-z2-7]{16})\.([a-z2-7]{26})$/;

/** Accepts a bare code or a share link (`…#campaign=<code>`). */
export function parseCampaignCode(input: string): { code: string; campaignId: string } | null {
  let s = input.trim();
  const hash = /#campaign=([^&\s]+)/.exec(s);
  if (hash) s = decodeURIComponent(hash[1]!);
  s = s.toLowerCase().replace(/\s+/g, "");
  const m = CODE_RE.exec(s);
  return m ? { code: s, campaignId: m[1]! } : null;
}

/** Share link — the code rides in the hash, which browsers never send to a server. */
export function campaignShareUrl(code: string): string {
  return `${window.location.origin}/dnd#campaign=${code}`;
}

async function api<T>(method: string, path: string, code: string | null, body?: unknown, keepalive = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (code) headers["X-Campaign-Code"] = code;
  if (body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`/api/campaign${path}`, {
      method, headers, keepalive,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new CampaignError(0, "Couldn't reach the server.");
  }
  if (res.status === 204) return null as T;
  const data = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!res.ok) throw new CampaignError(res.status, data?.message ?? `Request failed (${res.status}).`);
  return data as T;
}

export const createCampaign = (name: string, description: string) =>
  api<{ code: string; view: CampaignView }>("POST", "", null, { name, description });
export const fetchCampaign = (code: string) => api<CampaignView>("GET", "", code);
export const patchCampaign = (code: string, patch: { name?: string; description?: string }) =>
  api<CampaignView>("PATCH", "", code, patch);
export const deleteCampaign = (code: string) => api<null>("DELETE", "", code);
export const rotateCode = (code: string, role: CampaignRole) =>
  api<{ code: string }>("POST", "/rotate", code, { role });

// keepalive lets a save started while the page/drawer is closing finish
// (bodies over 64KB can't use it, so it's opt-in for small writes).
export const putNote = (code: string, n: Omit<CampaignNote, "updatedAt">, keepalive = false) =>
  api<CampaignNote>("PUT", `/notes/${n.id}`, code, n, keepalive && n.body.length < 60_000);
export const deleteNote = (code: string, id: string) => api<null>("DELETE", `/notes/${id}`, code);

export const putNpc = (code: string, npc: { id: string; character: DndCharacter; dmNotes: string }) =>
  api<CampaignNpc>("PUT", `/npcs/${npc.id}`, code, npc);
export const deleteNpc = (code: string, id: string) => api<null>("DELETE", `/npcs/${id}`, code);

export const putMap = (code: string, id: string, name: string, data: CampaignMapData) =>
  api<CampaignMapSummary>("PUT", `/maps/${id}`, code, { name, data });
export const getMap = (code: string, id: string) =>
  api<{ summary: CampaignMapSummary; data: CampaignMapData }>("GET", `/maps/${id}`, code);
export const renameMap = (code: string, id: string, name: string) =>
  api<CampaignMapSummary>("PATCH", `/maps/${id}`, code, { name });
export const deleteMap = (code: string, id: string) => api<null>("DELETE", `/maps/${id}`, code);
