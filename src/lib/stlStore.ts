// Shared storage for detailed STL models (see worker/src/stlStore.ts).
//
// A model too big for the synced board is uploaded once, by its SHA-256,
// and the board carries only the hash. Every browser that meets the hash
// fetches the model and keeps it in IndexedDB, so it downloads once per
// device and the uploader's own copy works offline.

const DB_NAME = "stl-models";
const STORE = "models";

let dbPromise: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null); // private mode / no IndexedDB: just skip the cache
    }
  });
  return dbPromise;
}

async function cacheGet(hash: string): Promise<Uint8Array | null> {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE).objectStore(STORE).get(hash);
      req.onsuccess = () => resolve(req.result instanceof Uint8Array ? req.result : null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function cachePut(hash: string, bytes: Uint8Array): Promise<void> {
  const d = await db();
  if (!d) return;
  try {
    d.transaction(STORE, "readwrite").objectStore(STORE).put(bytes, hash);
  } catch {
    // Quota full: the model still loads from the server next time.
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Upload a model so other players can load it. Throws if the server can't take it. */
export async function uploadModel(hash: string, bytes: Uint8Array): Promise<void> {
  await cachePut(hash, bytes);
  const res = await fetch(`/api/stl/${hash}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: bytes as BodyInit,
  });
  if (!res.ok) throw new Error(`model upload failed (${res.status})`);
}

const loading = new Map<string, Promise<Uint8Array | null>>();

/** A shared model's bytes: from this device's cache, else the server. */
export function loadModel(hash: string): Promise<Uint8Array | null> {
  let p = loading.get(hash);
  if (!p) {
    p = (async () => {
      const cached = await cacheGet(hash);
      if (cached) return cached;
      try {
        const res = await fetch(`/api/stl/${hash}`);
        if (!res.ok) return null;
        const bytes = new Uint8Array(await res.arrayBuffer());
        if ((await sha256Hex(bytes)) !== hash) return null;
        await cachePut(hash, bytes);
        return bytes;
      } catch {
        return null;
      }
    })();
    // Let a failed load try again next time instead of sticking.
    void p.then((b) => { if (!b) loading.delete(hash); });
    loading.set(hash, p);
  }
  return p;
}
