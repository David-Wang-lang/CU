# CU — Dev Commands

Run these from the repo root unless a `cd` is shown.

**Defaults**
- Admin: `admin@example.com` / `admin123!`
- API: `http://localhost:8000`
- Dashboard: `http://localhost:3000`
- Agent config: `~/Library/Application Support/CU/agent.toml`

**Phase 5/6 extras**
- Dashboard **Storage** — retention days, cleanup, usage by device
- Dashboard **Settings** — enable TOTP MFA
- Dashboard **Activity** — Screenshot mode (grid + display stride) and Video mode (ffmpeg MP4 time-lapse, 15/30/60‑min clips)
- Agent captures ~1/s real frames (`CU_MOCK_SCREENSHOTS=false`); no mock fallback when real capture is on
- Mouse: cursor baked into PNG (`screencapture -C`) + normalized x/y + action (`move`/`click`/`drag`/…) overlaid on Activity images
- Video encode uses bundled `imageio-ffmpeg` → smooth H.264 MP4 at selectable FPS (default **3**)
- macOS LaunchAgent is **off by default** (avoids Login Items / “App Background Activity” alerts). Start via `./scripts/dev-all.sh` or MDM. Opt-in: `CU_INSTALL_LAUNCH_AGENT=true`
- Apple Screen Recording TCC / orange menu-bar indicator cannot be suppressed by the app — grant via MDM for company devices
- Daemon reports CPU/RAM/disk in heartbeats

---


## Start / stop everything

```bash
# Start API + Dashboard + Daemon (if already enrolled)
./scripts/dev-all.sh

# Stop them
./scripts/dev-stop.sh
```

Logs: `.dev-logs/` (api.log, dashboard.log, daemon.log)

**First-time enroll** (interactive — not started by `dev-all.sh`):

```bash
pnpm --filter @cu/agent setup:dev
# then run ./scripts/dev-all.sh again so the daemon starts
```

### Manual (separate terminals)

```bash
# A — API
cd apps/api && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# B — Dashboard
pnpm --filter @cu/dashboard dev

# C — Setup (paste token from Devices page)
pnpm --filter @cu/agent setup:dev

# D — Daemon
cd apps/agent && cargo run -p cu-agent-daemon
```

---


## 1. Backend API

```bash
cd apps/api
uv sync --extra dev
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

On startup the API seeds the admin user and prints an enrollment token in the logs.

- Health: http://localhost:8000/api/v1/health  
- Docs: http://localhost:8000/docs  

Stop: `Ctrl+C` in that terminal.

---

## 2. Admin dashboard

```bash
pnpm install
pnpm --filter @cu/dashboard dev
```

Open http://localhost:3000 → sign in with `admin@example.com` / `admin123!`.

Useful pages:
- **Devices** — create/copy enrollment token, see online/offline
- **Activity** — Screenshot mode (image grid; set “show every N screenshots”) or Video mode (clips by 15/30/60 min)
- **Employees** — register employees

Stop: `Ctrl+C`.

---

## 3. Agent setup (IT install / enroll)

API must be running. Copy a token from **Devices → Enrollment tokens**.

```bash
pnpm --filter @cu/agent setup:dev
```

In the wizard:
1. API base URL: `http://localhost:8000/api/v1`
2. Paste enrollment token
3. Install background agent → Finish and close

Stop setup window: close the app or `Ctrl+C` in the setup terminal.

---

## 4. Monitoring daemon (headless)

```bash
cd apps/agent
cargo run -p cu-agent-daemon
```

Mock screenshots (default):

```bash
cd apps/agent
cargo run -p cu-agent-daemon
```

**Why Activity looked red / black:** mock mode used a 1×1 red PNG. That’s fixed (visible mock + real capture default). Restart the daemon after changing mock settings.

Real macOS capture (needs Screen Recording permission for Terminal / `cu-agent-daemon`):

```bash
cd apps/agent
CU_MOCK_SCREENSHOTS=false cargo run -p cu-agent-daemon
```

Stop daemon:

```bash
# in the daemon terminal
Ctrl+C

# or from another terminal
pkill -f cu-agent-daemon
```

---

## 5. Full stack (typical order)

```bash
# Terminal A — API
cd apps/api && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Terminal B — Dashboard
pnpm --filter @cu/dashboard dev

# Terminal C — Setup (once per machine / after clearing config)
pnpm --filter @cu/agent setup:dev

# Terminal D — Daemon
cd apps/agent && cargo run -p cu-agent-daemon
```

---

## 6. Re-enter enrollment token (fix auth errors)

If you see `Invalid device credentials`, the local config is stale.

```bash
# 1) Stop daemon
pkill -f cu-agent-daemon

# 2) Remove old enrollment
rm -f "$HOME/Library/Application Support/CU/agent.toml"

# 3) Run Setup again with a token from the Devices page
pnpm --filter @cu/agent setup:dev

# 4) Start daemon
cd apps/agent && cargo run -p cu-agent-daemon
```

---

## 7. Quick checks

```bash
# API up?
curl -s http://localhost:8000/api/v1/health

# Login + list devices
curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin123!"}'

# Is daemon running?
pgrep -lf cu-agent-daemon

# Local agent config
cat "$HOME/Library/Application Support/CU/agent.toml"
```

---

## 8. Tests / build (optional)

```bash
# API
cd apps/api && uv run pytest -q && uv run ruff check app tests

# Dashboard
pnpm --filter @cu/dashboard build

# Agent
cd apps/agent && cargo test -p cu-agent-core && cargo check -p cu-agent-daemon
```

---

## 9. Docker data services (optional)

Only if you want Postgres/Redis/MinIO instead of SQLite:

```bash
# Start Docker Desktop first
docker compose -f docker-compose.dev.yml up -d
```

Then set `DATABASE_URL` in `apps/api/.env` to Postgres (see `.env.example`) and restart the API.
