#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

echo "Starting CU data services (postgres, redis, minio)..."
docker compose up -d postgres redis minio minio-init

echo "Waiting for Postgres..."
until docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-cu}" >/dev/null 2>&1; do
  sleep 1
done

echo "Starting API, Celery, dashboard, nginx..."
docker compose up -d api celery-worker celery-beat dashboard nginx

echo ""
echo "CU stack is starting:"
echo "  API:       http://localhost:8000/api/v1/health"
echo "  Docs:      http://localhost:8000/docs"
echo "  Dashboard: http://localhost:3000"
echo "  Nginx:     http://localhost:8080"
echo "  MinIO:     http://localhost:9001"
echo ""
echo "For local (non-Docker) API: cd apps/api && uv sync && uv run uvicorn app.main:app --reload"
echo "For local dashboard: pnpm --filter @cu/dashboard dev"
echo "For agent: pnpm --filter @cu/agent tauri:dev"
