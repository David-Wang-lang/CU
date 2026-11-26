#!/usr/bin/env bash
# Deploy CU to the VPS app root (default: ~/cu).
# Usage (on VPS):  CU_APP_ROOT=~/cu ./infrastructure/deploy/deploy.sh
# Or from CI after rsync: bash infrastructure/deploy/deploy.sh
set -euo pipefail

export PATH="${HOME}/.local/bin:${PATH}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP_ROOT="${CU_APP_ROOT:-${HOME}/cu}"
SHARED="${APP_ROOT}/shared"
RELEASES="${APP_ROOT}/releases"
REV="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
DEST="${RELEASES}/${REV}"

echo "==> Release ${REV} → ${DEST}"
mkdir -p \
  "$DEST/apps/api" \
  "$DEST/apps/dashboard" \
  "$DEST/packages/shared" \
  "$SHARED/data/screenshots" \
  "$SHARED/data/videos" \
  "$SHARED/logs"

# Copy application sources needed at runtime
rsync -a --delete \
  --exclude '.venv' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'data' \
  --exclude '__pycache__' \
  --exclude '.pytest_cache' \
  --exclude 'target' \
  "${ROOT}/apps/api/" "${DEST}/apps/api/"

rsync -a --delete \
  --exclude 'node_modules' \
  --exclude '.next' \
  "${ROOT}/apps/dashboard/" "${DEST}/apps/dashboard/"
rsync -a --delete \
  --exclude 'node_modules' \
  "${ROOT}/packages/shared/" "${DEST}/packages/shared/"

cp "${ROOT}/package.json" "${ROOT}/pnpm-workspace.yaml" "${ROOT}/pnpm-lock.yaml" "$DEST/" 2>/dev/null || \
  cp "${ROOT}/package.json" "${ROOT}/pnpm-workspace.yaml" "$DEST/"
cp "${ROOT}/infrastructure/deploy/ecosystem.config.cjs" "$DEST/"
echo "$REV" >"${DEST}/REVISION"

# Load production env
if [[ ! -f "${SHARED}/.env" ]]; then
  echo "Missing ${SHARED}/.env — run bootstrap-root.sh first" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source "${SHARED}/.env"
set +a

echo "==> API deps + migrations"
cd "${DEST}/apps/api"
ln -sfn "${SHARED}/.env" "${DEST}/apps/api/.env"
uv sync --no-dev
# Point storage at shared volume
export LOCAL_STORAGE_PATH="${SHARED}/data/screenshots"
export DATABASE_URL
uv run alembic upgrade head || true
# create_all / seed happens on API startup

echo "==> Dashboard build"
cd "$DEST"
pnpm install --frozen-lockfile=false
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://127.0.0.1:4000/api/v1}"
pnpm --filter @cu/dashboard build

# Flatten Next standalone into apps/dashboard for PM2 cwd
STANDALONE="${DEST}/apps/dashboard/.next/standalone"
if [[ -d "$STANDALONE" ]]; then
  # standalone nests workspace paths; find server.js
  SERVER_JS="$(find "$STANDALONE" -name server.js | head -1)"
  STATIC_SRC="${DEST}/apps/dashboard/.next/static"
  PUBLIC_SRC="${DEST}/apps/dashboard/public"
  RUN_DIR="${DEST}/apps/dashboard-run"
  rm -rf "$RUN_DIR"
  mkdir -p "$RUN_DIR"
  # Copy standalone tree preserving relative paths Next expects
  rsync -a "${STANDALONE}/" "$RUN_DIR/"
  # Ensure static + public next to the app path inside standalone
  APP_REL="apps/dashboard"
  mkdir -p "${RUN_DIR}/${APP_REL}/.next" "${RUN_DIR}/${APP_REL}/public"
  rsync -a "${STATIC_SRC}/" "${RUN_DIR}/${APP_REL}/.next/static/"
  if [[ -d "$PUBLIC_SRC" ]]; then
    rsync -a "${PUBLIC_SRC}/" "${RUN_DIR}/${APP_REL}/public/"
  fi
  # Point ecosystem at flattened run dir
  # Update symlink used by PM2
  ln -sfn "$RUN_DIR" "${DEST}/dashboard-runtime"
fi

# Symlink current release
ln -sfn "$DEST" "${APP_ROOT}/app"
export CU_APP_DIR="${APP_ROOT}/app"

# Patch ecosystem dashboard cwd/script for standalone
cat >"${DEST}/ecosystem.config.cjs" <<EOF
const path = require("node:path");
const root = process.env.CU_APP_DIR || __dirname;
module.exports = {
  apps: [
    {
      name: "cu-api",
      cwd: path.join(root, "apps/api"),
      script: "uv",
      args: "run uvicorn app.main:app --host 127.0.0.1 --port 4000 --workers 2",
      interpreter: "none",
      max_memory_restart: "800M",
      kill_timeout: 10000,
      env: {
        NODE_ENV: "production",
        API_HOST: "127.0.0.1",
        API_PORT: "4000",
        LOCAL_STORAGE_PATH: "${SHARED}/data/screenshots",
      },
    },
    {
      name: "cu-dashboard",
      cwd: path.join(root, "dashboard-runtime"),
      script: "apps/dashboard/server.js",
      interpreter: "node",
      max_memory_restart: "700M",
      env: {
        NODE_ENV: "production",
        PORT: "4001",
        HOSTNAME: "127.0.0.1",
        NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "${NEXT_PUBLIC_API_URL}",
      },
    },
  ],
};
EOF

echo "==> PM2 reload"
cd "$DEST"
# Export env into PM2
set -a
source "${SHARED}/.env"
set +a
export LOCAL_STORAGE_PATH="${SHARED}/data/screenshots"
export CU_APP_DIR="${APP_ROOT}/app"

if pm2 describe cu-api >/dev/null 2>&1; then
  pm2 reload "${DEST}/ecosystem.config.cjs" --update-env
else
  pm2 start "${DEST}/ecosystem.config.cjs"
fi
pm2 save

# Keep last 5 releases
cd "$RELEASES"
ls -1dt */ 2>/dev/null | tail -n +6 | xargs -r rm -rf

echo "==> Health"
sleep 2
curl -fsS "http://127.0.0.1:4000/api/v1/health" || echo "API not healthy yet"
curl -fsS -o /dev/null -w "dashboard:%{http_code}\n" "http://127.0.0.1:4001/" || echo "dashboard not up yet"
echo "Deployed ${REV}"
