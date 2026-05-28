/**
 * Cloudflare Worker: commit Legion flag exports into the repo.
 *
 * The static GitHub Pages app POSTs its flag JSON here; this Worker
 * authenticates as a GitHub App installation and writes the payload to
 *   flags/incoming/flags-<ISO>.json
 * on the default branch.
 *
 * Secrets (set with `wrangler secret put <NAME>`):
 *   GH_APP_ID            - the GitHub App's numeric App ID
 *   GH_APP_PRIVATE_KEY   - the App's private key, full PEM (PKCS#8)
 *   GH_INSTALLATION_ID   - installation id of the App on the repo
 *   FLAG_SHARED_SECRET   - optional; if set, requests must send a matching
 *                          X-Flag-Secret header
 *
 * Vars (in wrangler.toml [vars]):
 *   REPO_OWNER, REPO_NAME, ALLOWED_ORIGIN
 */

export interface Env {
  GH_APP_ID: string;
  GH_APP_PRIVATE_KEY: string;
  GH_INSTALLATION_ID: string;
  FLAG_SHARED_SECRET?: string;
  REPO_OWNER: string;
  REPO_NAME: string;
  ALLOWED_ORIGIN: string;
}

function corsHeaders(env: Env): HeadersInit {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Flag-Secret",
    "Access-Control-Max-Age": "86400",
  };
}

function json(body: unknown, status: number, env: Env): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

// --- base64url helpers ---
function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlStr(str: string): string {
  return b64url(new TextEncoder().encode(str));
}

// Parse a PEM PKCS#8 private key into a CryptoKey for RS256 signing.
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function appJwt(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: now - 60, exp: now + 540, iss: env.GH_APP_ID };
  const unsigned = `${b64urlStr(JSON.stringify(header))}.${b64urlStr(JSON.stringify(payload))}`;
  const key = await importPrivateKey(env.GH_APP_PRIVATE_KEY);
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${b64url(sig)}`;
}

const GH_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "legion-flag-worker",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function installationToken(env: Env, jwt: string): Promise<string> {
  const res = await fetch(
    `https://api.github.com/app/installations/${env.GH_INSTALLATION_ID}/access_tokens`,
    { method: "POST", headers: { ...GH_HEADERS, Authorization: `Bearer ${jwt}` } },
  );
  if (!res.ok) {
    throw new Error(`installation token failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { token: string };
  return data.token;
}

async function commitFile(
  env: Env,
  token: string,
  path: string,
  contentB64: string,
  message: string,
): Promise<void> {
  const url = `https://api.github.com/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/${path}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message, content: contentB64 }),
  });
  if (!res.ok) {
    throw new Error(`commit failed: ${res.status} ${await res.text()}`);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    if (request.method !== "POST") {
      return json({ error: "POST only" }, 405, env);
    }
    if (
      env.FLAG_SHARED_SECRET &&
      request.headers.get("X-Flag-Secret") !== env.FLAG_SHARED_SECRET
    ) {
      return json({ error: "unauthorized" }, 401, env);
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "invalid JSON" }, 400, env);
    }
    const flags = (payload as { flags?: unknown[] })?.flags;
    if (!Array.isArray(flags) || flags.length === 0) {
      return json({ error: "no flags in payload" }, 400, env);
    }

    try {
      const jwt = await appJwt(env);
      const token = await installationToken(env, jwt);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const path = `flags/incoming/flags-${stamp}.json`;
      // Encode JSON as base64 (handles UTF-8 via the byte route).
      const text = JSON.stringify(payload, null, 2);
      const contentB64 = b64Standard(new TextEncoder().encode(text));
      await commitFile(
        env,
        token,
        path,
        contentB64,
        `Flag report: ${flags.length} flag(s)`,
      );
      return json({ ok: true, path, count: flags.length }, 200, env);
    } catch (err) {
      return json({ error: String((err as Error).message) }, 502, env);
    }
  },
};

// Standard (non-url) base64 for the GitHub contents API.
function b64Standard(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
