// "My campaigns": the codes this browser holds. There are no accounts, so
// this list *is* your access — losing an owner code loses owner rights,
// which is why the UI pushes you to save it and offers a backup export.

import { ROLE_RANK, type CampaignRole } from "./campaign";

export type KeyringEntry = {
  campaignId: string;
  code: string;
  role: CampaignRole;
  name: string;
  addedAt: number;
  /** Set when the server stopped recognising the code (deleted/rotated). */
  stale?: boolean;
};

const KEY = "dnd.campaigns.v1";
const EVENT = "dnd:campaigns";
let cache: KeyringEntry[] | null = null;

function read(): KeyringEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as KeyringEntry[]) : [];
  } catch {
    return [];
  }
}
function write(list: KeyringEntry[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
  cache = null;
  window.dispatchEvent(new Event(EVENT));
}

export function getKeyringSnapshot(): KeyringEntry[] {
  if (!cache) cache = read().sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.name.localeCompare(b.name));
  return cache;
}

export function subscribeKeyring(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { cache = null; cb(); } };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** Add or update an entry. One entry per campaign: a higher-role code
 * replaces a lower one, never the other way round — unless `force`
 * (the server just told us what this exact code is). */
export function upsertEntry(e: Omit<KeyringEntry, "addedAt"> & { addedAt?: number }, force = false): void {
  const list = read();
  const i = list.findIndex((x) => x.campaignId === e.campaignId);
  const next: KeyringEntry = { ...e, addedAt: e.addedAt ?? Date.now(), stale: false };
  if (i < 0) list.push(next);
  else {
    const prev = list[i]!;
    if (prev.code === e.code || force || ROLE_RANK[e.role] > ROLE_RANK[prev.role]) {
      list[i] = { ...next, addedAt: prev.addedAt };
    } else {
      list[i] = { ...prev, name: e.name || prev.name };
    }
  }
  write(list);
}

export function markStale(campaignId: string, stale = true): void {
  const list = read();
  const i = list.findIndex((x) => x.campaignId === campaignId);
  if (i < 0 || !!list[i]!.stale === stale) return;
  list[i] = { ...list[i]!, stale };
  write(list);
}

export function removeEntry(campaignId: string): void {
  write(read().filter((x) => x.campaignId !== campaignId));
}

export function bestCodeFor(campaignId: string, minRole: CampaignRole): string | null {
  const e = read().find((x) => x.campaignId === campaignId);
  return e && !e.stale && ROLE_RANK[e.role] >= ROLE_RANK[minRole] ? e.code : null;
}

export function exportKeyring(): string {
  return JSON.stringify(read().map(({ campaignId, code, role, name }) => ({ campaignId, code, role, name })), null, 2);
}

/** Merge a backup; returns how many entries were added or upgraded. */
export function importKeyring(json: string): number {
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Expected a list of campaigns.");
  let n = 0;
  for (const raw of parsed) {
    const e = raw as Partial<KeyringEntry>;
    if (typeof e.campaignId !== "string" || typeof e.code !== "string" || !e.role || !(e.role in ROLE_RANK)) continue;
    upsertEntry({ campaignId: e.campaignId, code: e.code, role: e.role, name: typeof e.name === "string" ? e.name : "Campaign" });
    n++;
  }
  return n;
}
