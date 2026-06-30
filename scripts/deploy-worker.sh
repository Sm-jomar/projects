#!/usr/bin/env bash
#
# deploy-worker.sh — one-shot deploy of the Legion Cloudflare Worker
# (SPA + /api/flags + the remote-play room Durable Object).
#
# Run this on YOUR machine — the one signed in to your Cloudflare account.
# It is NOT for the cloud dev sandbox (that has no Cloudflare credentials).
#
#   bash scripts/deploy-worker.sh
#
# What it does, in order:
#   1. Sanity-check tools (git, node, npm, npx).
#   2. Pull the latest main (only if your tree is clean and on main).
#   3. npm install.
#   4. Make sure wrangler is logged in (prompts a browser login if not).
#   5. npm run deploy  (build + wrangler deploy; applies the DO migration
#      automatically on first run).
#   6. Print the Worker URL and curl-check that the room route is live.
#
# Safe to re-run anytime. On Windows, run it from Git Bash or WSL.

set -euo pipefail

# --- pretty output ---------------------------------------------------------
bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  \033[36m›\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# --- locate the repo root (the script lives in <repo>/scripts) -------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

bold "Legion Worker deploy"
info "repo: $REPO_ROOT"

# --- 1. tool check ---------------------------------------------------------
for tool in git node npm npx; do
  command -v "$tool" >/dev/null 2>&1 || die "'$tool' is not installed or not on PATH."
done
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  warn "Node $(node -v) detected; this project targets Node 20+. Continuing anyway."
fi
ok "git, node $(node -v), npm $(npm -v) present"

# --- 2. update to latest main (only when safe) -----------------------------
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  warn "Working tree has uncommitted changes — skipping 'git pull'."
  warn "Deploying whatever is currently checked out ($CURRENT_BRANCH)."
elif [ "$CURRENT_BRANCH" != "main" ]; then
  warn "Not on 'main' (on '$CURRENT_BRANCH') — skipping 'git pull'."
  warn "Deploying whatever is currently checked out."
else
  info "Pulling latest main…"
  if git pull --ff-only origin main; then
    ok "Up to date with origin/main"
  else
    warn "Could not fast-forward; deploying your current checkout."
  fi
fi

# --- 3. install deps -------------------------------------------------------
info "Installing dependencies (npm install)…"
npm install --no-audit --no-fund
ok "Dependencies installed"

# --- 4. wrangler auth ------------------------------------------------------
# 'wrangler whoami' exits non-zero / prints "not authenticated" when logged
# out. Skip the check if a CLOUDFLARE_API_TOKEN is set (CI-style auth).
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  ok "Using CLOUDFLARE_API_TOKEN from the environment"
else
  info "Checking Cloudflare login…"
  if npx wrangler whoami 2>/dev/null | grep -qiE "You are logged in|associated with the email"; then
    ok "Already logged in to Cloudflare"
  else
    warn "Not logged in — opening a browser to authorize wrangler."
    warn "(If no browser opens, copy the URL it prints.)"
    npx wrangler login || die "wrangler login failed. Run 'npx wrangler login' manually, then re-run this script."
    ok "Logged in"
  fi
fi

# --- 5. build + deploy -----------------------------------------------------
bold "Deploying…"
info "Running: npm run deploy  (build + wrangler deploy)"
# Capture the output so we can pull the Worker URL out of it, while still
# streaming it to the terminal.
DEPLOY_LOG="$(mktemp)"
trap 'rm -f "$DEPLOY_LOG"' EXIT
if ! npm run deploy 2>&1 | tee "$DEPLOY_LOG"; then
  die "Deploy failed. Scroll up for the error. Common fixes:
     - 'npx wrangler login' if it's an auth error
     - check the migration/durable-object section of wrangler.jsonc
     - paste the error to Claude if it mentions the RoomDO migration"
fi
ok "wrangler deploy completed"

# --- 6. verify the room route ----------------------------------------------
# Grab the first workers.dev / custom URL wrangler reported.
WORKER_URL="$(grep -oE 'https://[a-zA-Z0-9._-]+\.workers\.dev' "$DEPLOY_LOG" | head -n1 || true)"
if [ -z "$WORKER_URL" ]; then
  WORKER_URL="$(grep -oE 'https://[a-zA-Z0-9./_-]+' "$DEPLOY_LOG" | grep -iE 'workers\.dev|http' | head -n1 || true)"
fi

echo
bold "Done."
if [ -n "$WORKER_URL" ]; then
  ok "Worker URL: $WORKER_URL"
  info "Verifying the remote-play route is live…"
  # The room route returns 426 (Expected websocket) for a plain GET — that
  # means the Durable Object route is wired up correctly.
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "$WORKER_URL/api/room/TEST12/ws" || echo "000")"
  if [ "$CODE" = "426" ]; then
    ok "Room route responds 426 (Expected websocket) — multiplayer is live."
  elif [ "$CODE" = "000" ]; then
    warn "Couldn't reach $WORKER_URL to verify (network?). Try it in a browser."
  else
    warn "Room route returned HTTP $CODE (expected 426). Deploy succeeded, but"
    warn "double-check the durable_objects binding in wrangler.jsonc."
  fi
  echo
  bold "Next:"
  echo "   1. Open the Tabletop at:  $WORKER_URL"
  echo "      (NOT legion.eslegion.com — the static site can't run multiplayer.)"
  echo "   2. Play online → Host a new game → share the 6-char code."
  echo "   3. Opponent opens the same URL → Play online → Join with the code."
else
  warn "Deploy succeeded but I couldn't parse the Worker URL from the output."
  echo "   Open your Cloudflare dashboard → Workers → 'wrangler' to find the URL,"
  echo "   then open the Tabletop there and use Play online."
fi
