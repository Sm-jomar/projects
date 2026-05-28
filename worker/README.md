# Legion flag worker

A tiny Cloudflare Worker that receives flag-report JSON from the army
builder and commits it into this repo at `flags/incoming/flags-<time>.json`,
authenticating as a GitHub App installation. The static site can't hold a
GitHub token, so this Worker holds the App credentials instead.

## One-time setup

### 1. Create a GitHub App

1. GitHub → Settings → Developer settings → **GitHub Apps** → **New GitHub App**.
2. Name: anything (e.g. `legion-flag-committer`). Homepage URL: your Pages site.
3. Uncheck **Webhook → Active** (not needed).
4. **Repository permissions** → **Contents: Read and write**. Nothing else.
5. Create the app. Note the **App ID**.
6. **Generate a private key** → downloads a `.pem`. Keep it safe.
7. **Install App** → install on `sm-jomar/projects` only.
8. After install, the URL is `.../installations/<INSTALLATION_ID>` — note that number.

### 2. Deploy the Worker

```bash
cd worker
npm install
npx wrangler login            # authorize wrangler with your Cloudflare account
# edit wrangler.toml ALLOWED_ORIGIN if your site origin differs

npx wrangler secret put GH_APP_ID            # paste the App ID
npx wrangler secret put GH_INSTALLATION_ID   # paste the installation id
npx wrangler secret put GH_APP_PRIVATE_KEY   # paste the FULL .pem contents
npx wrangler secret put FLAG_SHARED_SECRET   # optional: any random string

npx wrangler deploy
```

`wrangler deploy` prints the Worker URL, e.g.
`https://legion-flag-worker.<your-subdomain>.workers.dev`.

### 3. Point the app at the Worker

Set these as repo/Pages build env vars (or in a local `.env` for dev):

```
VITE_FLAG_ENDPOINT=https://legion-flag-worker.<your-subdomain>.workers.dev
VITE_FLAG_SECRET=<the same FLAG_SHARED_SECRET, if you set one>
```

When `VITE_FLAG_ENDPOINT` is set, the app POSTs flag exports to the Worker
(in addition to the browser download). When it's empty, it falls back to
download-only — so the app works with or without the backend.

## Local test

```bash
cd worker
npx wrangler dev
# in another shell:
curl -X POST http://localhost:8787 \
  -H 'Content-Type: application/json' \
  -H 'X-Flag-Secret: <secret>' \
  -d '{"format":"legion-builder-flags","version":1,"flags":[{"id":"x","kind":"unit","name":"Test","flaggedAt":0}]}'
```

A successful call returns `{ "ok": true, "path": "flags/incoming/...", "count": 1 }`
and creates that file in the repo.

## Notes / tradeoffs

- CORS is locked to `ALLOWED_ORIGIN`. `FLAG_SHARED_SECRET` adds a second
  gate, but since the secret ships in the static bundle it's obfuscation,
  not strong auth. Flags are low-value; worst case is junk commits under
  `flags/incoming/`, which are easy to delete. For stronger protection add
  Cloudflare Turnstile or rate limiting.
- The App token is generated per request and lives ~9 minutes; nothing is
  persisted in the Worker.
