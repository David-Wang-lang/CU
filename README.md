# CU — Enterprise Endpoint Monitoring & DLP

CU is a cross-platform platform for authorized monitoring of company-owned Windows and macOS endpoints. It consists of a headless desktop agent (plus a one-time setup wizard), a FastAPI backend, PostgreSQL + MinIO storage, and a Next.js admin dashboard.

**Status:** Phases 1–4 implemented — auth, employees/devices, dashboard overview + timeline playback, headless daemon with API sync, macOS capture path + LaunchAgent.

## Repository layout

```text
apps/agent       # Tauri setup wizard + headless cu-agent-daemon
apps/api         # FastAPI backend
apps/dashboard   # Next.js admin dashboard
packages/shared  # Shared TypeScript types
infrastructure/  # Dockerfiles + Nginx
scripts/         # Bootstrap and compose helpers
docs/            # Architecture and ops docs
```

## Quick start (macOS)

### Prerequisites

- Node 20+, pnpm 9.15+
- Python 3.12+ and [uv](https://github.com/astral-sh/uv)
- Rust stable (for the agent)
- Docker Desktop (for Postgres, Redis, MinIO)

### Bootstrap

```bash
cp .env.example .env
./scripts/bootstrap.sh
```

### Data services only (recommended while developing apps on the host)

```bash
# Start Docker Desktop first
docker compose -f docker-compose.dev.yml up -d
./scripts/migrate.sh   # after Postgres is healthy
```

### Run apps locally

```bash
# API (SQLite by default; seeds admin + enrollment token on startup)
cd apps/api && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
# Admin: admin@example.com / admin123!
# Enrollment token: printed in API logs and listed on Devices page

# Dashboard
pnpm --filter @cu/dashboard dev

# Agent setup (IT only) — paste enrollment token from dashboard
pnpm --filter @cu/agent setup:dev

# Headless daemon
cd apps/agent && cargo run -p cu-agent-daemon
# Real macOS capture (requires Screen Recording permission):
# CU_MOCK_SCREENSHOTS=false cargo run -p cu-agent-daemon
```

### Full Compose stack

```bash
./scripts/dev-up.sh
# API http://localhost:8000/api/v1/health
# Dashboard http://localhost:3000
# Nginx http://localhost:8080
```

## Documentation

| Doc | Purpose |
|-----|---------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local development |
| [docs/API.md](docs/API.md) | API contracts |
| [docs/SECURITY.md](docs/SECURITY.md) | Security & privacy boundaries |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | VPS / Compose deployment |
| [docs/TASKS.md](docs/TASKS.md) | Phase checklist |

## Privacy notice

CU is intended for **authorized monitoring of company-owned devices**. Workforce awareness is via company policy, not agent UI. The daemon runs with no employee-facing window or notifications and remains visible to IT/system management. Phase 1 does not perform real screen or keyboard capture.
