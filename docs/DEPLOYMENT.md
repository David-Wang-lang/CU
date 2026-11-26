# Deployment

## This VPS (current)

Host: `179.197.86.236` (`srv2105818`)

| Already in use | Service |
|----------------|---------|
| 22 | SSH |
| 80 / 443 | Caddy |
| 5432 (localhost) | PostgreSQL 18 |
| 8000 / 3100 (localhost) | BidBot (PM2) |
| 3210 | Upwork bot |
| 8443 / 8787 | tg-job-bot |

**CU ports (free):**

| Port | Service |
|------|---------|
| **4000** | CU API (`127.0.0.1`) |
| **4001** | CU Dashboard (`127.0.0.1`) |

Public HTTPS via Caddy host `cu.jobapplicationtracking.tech` → 4000/4001.

Deploy user: `deploy` (PM2, no Docker socket, no passwordless sudo).  
App root: `~/cu` (`/home/deploy/cu`).

## One-time bootstrap (needs root/sudo)

```bash
# On the VPS as someone with sudo:
sudo CU_DOMAIN=cu.jobapplicationtracking.tech \
  bash /home/deploy/cu/repo/infrastructure/deploy/bootstrap-root.sh
```

Creates Postgres role/DB `cu`, writes `~/cu/shared/.env`, appends Caddy site, reloads Caddy.

Point DNS: `cu.jobapplicationtracking.tech` → `179.197.86.236`.

## Deploy (as `deploy`)

```bash
export PATH="$HOME/.local/bin:$PATH"
export CU_APP_ROOT="$HOME/cu"
# after repo is at ~/cu/repo
bash ~/cu/repo/infrastructure/deploy/deploy.sh
pm2 status
curl -s http://127.0.0.1:4000/api/v1/health
```

## GitHub Actions CI/CD

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `CI` | PR / push | API tests, dashboard build, agent checks |
| `Deploy VPS` | push `main` / manual | rsync → build → PM2 reload |
| `Release agent` | tag `v*` / manual | Windows + macOS daemon + Tauri setup artifacts |

### Required GitHub secrets

| Secret | Example |
|--------|---------|
| `VPS_HOST` | `179.197.86.236` |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | private key contents for `~/.ssh/bidbot_vps` |

## Agent packages (macOS / Windows)

```bash
# Local
cd apps/agent
cargo build -p cu-agent-daemon --release
pnpm tauri build   # Setup wizard (MSI / DMG)
```

Or run workflow **Release agent** and download artifacts / GitHub Release assets.

Unsigned builds are fine for internal IT; production signing (Apple Developer / Authenticode) is a follow-up.

## Compose (optional)

If the deploy user later gets Docker access:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Maps API/dashboard to host **4000/4001** and keeps Postgres/Redis/MinIO on 4002–4005.

## Production notes

- Bind API to `127.0.0.1:4000`; expose only through Caddy.
- Screenshots live under `~/cu/shared/data/screenshots` (persistent across releases).
- Do not conflict with BidBot ports 8000/3100 or host Postgres 5432.
