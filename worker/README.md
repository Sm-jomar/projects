# Legion flag handler

`src/index.ts` is the Cloudflare Worker that backs the army builder. It
serves the built SPA (via the `ASSETS` binding) for every route except
`POST /api/flags`, which receives flag-report JSON and commits it into this
repo at `flags/incoming/flags-<time>.json`, authenticating as a GitHub App
installation. Because the app and the endpoint share an origin, the browser
needs no CORS.

It is **not** a separate deployment: the root `wrangler.jsonc` points
`main` at this file, so the app's existing Cloudflare Workers Build bundles
and deploys it together with the SPA.

## One-time setup

### 1. Create a GitHub App

1. GitHub → Settings → Developer settings → **GitHub Apps** → **New GitHub App**.
2. Name: anything (e.g. `legion-flag-committer`). Homepage URL: your site.
3. Uncheck **Webhook → Active** (not needed).
4. **Repository permissions** → **Contents: Read and write**. Nothing else.
5. Create the app. Note the **App ID**.
6. **Generate a private key** → downloads a `.pem`. Keep it safe.
7. **Install App** → install on `sm-jomar/projects` only.
8. After install, the URL is `.../installations/<INSTALLATION_ID>` — note that number.

### 2. Add the secrets to the Worker

In the Cloudflare dashboard → your Worker → **Settings → Variables and
Secrets**, add these as **secrets** (encrypted):

```
GH_APP_ID            # the App ID
GH_INSTALLATION_ID   # the installation id
GH_APP_PRIVATE_KEY   # the FULL .pem contents
FLAG_SHARED_SECRET   # optional: any random string
```

`REPO_OWNER`, `REPO_NAME`, and `ALLOWED_ORIGIN` are plain vars and live in
the root `wrangler.jsonc` under `"vars"`.

### 3. Client wiring

The app POSTs to the same-origin path `/api/flags` by default, so no build
env var is required. To override (e.g. point at a different host during
dev) set `VITE_FLAG_ENDPOINT`; `VITE_FLAG_SECRET` is sent as `X-Flag-Secret`
if `FLAG_SHARED_SECRET` is configured. The browser download always runs as a
fallback, so the app still works if the backend is unavailable.

## Verify

```
curl -i https://<your-site>/api/flags          # GET -> 405 (POST only)
curl -X POST https://<your-site>/api/flags \
  -H 'Content-Type: application/json' \
  -d '{"format":"legion-builder-flags","version":1,"flags":[{"id":"x","kind":"unit","name":"Test","flaggedAt":0}]}'
```

A successful POST returns `{ "ok": true, "path": "flags/incoming/...", "count": 1 }`
and creates that file in the repo.

## Notes / tradeoffs

- `FLAG_SHARED_SECRET` is optional and, since any `VITE_FLAG_SECRET` ships in
  the static bundle, it's obfuscation, not strong auth. Flags are low-value;
  worst case is junk commits under `flags/incoming/`, easy to delete. For
  stronger protection add Cloudflare Turnstile or rate limiting.
- The App token is generated per request and lives ~9 minutes; nothing is
  persisted in the Worker.
