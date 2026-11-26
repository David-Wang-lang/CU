# Development

Primary environment: **macOS**. Windows agent binaries are built/checked in GitHub Actions only for now.

## Toolchain

| Tool | Version |
|------|---------|
| Node | 20+ (see `.nvmrc`) |
| pnpm | 9.15.0 (`packageManager` field) |
| Python | 3.12 (`uv`) |
| Rust | stable (`rust-toolchain.toml`) |
| Docker | Desktop with Compose |

```bash
./scripts/bootstrap.sh
```

## Environment

```bash
cp .env.example .env
```

Never commit `.env`. Defaults are for local development only.

## Data services

```bash
docker compose -f docker-compose.dev.yml up -d
./scripts/migrate.sh
```

Services: Postgres `5432`, Redis `6379`, MinIO `9000` / console `9001`.

## API

Default DB is SQLite at `apps/api/data/cu.db` (no Docker required). Use Postgres `DATABASE_URL` with Compose when available.

```bash
cd apps/api
uv sync --extra dev
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
# Startup seeds admin@example.com / admin123! and a default enrollment token
uv run pytest
uv run ruff check app tests
```

OpenAPI: `http://localhost:8000/docs`

## Dashboard

```bash
pnpm --filter @cu/dashboard dev
pnpm --filter @cu/dashboard build
```

`NEXT_PUBLIC_API_URL` defaults to `http://localhost:8000/api/v1`.

## Agent

Tauri is **setup only**. Continuous monitoring is the headless daemon.

```bash
# One-time setup wizard
pnpm --filter @cu/agent setup:dev

# Headless daemon (after enrollment)
cd apps/agent && cargo run -p cu-agent-daemon

# Checks
cd apps/agent && cargo test -p cu-agent-core && cargo check -p cu-agent-daemon && cargo check -p cu-agent
```

Local config: `~/Library/Application Support/CU/agent.toml` (macOS). Mock capture is default (`mock_screenshots = true`).

## Full Compose

Requires Docker Desktop running:

```bash
./scripts/dev-up.sh
./scripts/dev-down.sh
```

## CI

`.github/workflows/ci.yml` runs API tests, dashboard build, Rust core tests, daemon `cargo check`, and Tauri setup package check on Windows x64, macOS Intel, and macOS ARM.
