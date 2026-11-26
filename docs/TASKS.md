# TASKS

## Phase 1 — Project foundation

- [x] Monorepo, Docker/SQLite, API health, dashboard shell
- [x] Tauri setup-only wizard + headless `cu-agent-daemon`
- [x] Docs + CI matrix

## Phase 2 — Authentication and device management

- [x] Admin JWT login / refresh / me
- [x] Roles seed (admin) + RBAC dependency
- [x] Employees CRUD (list/create/update)
- [x] Enrollment tokens + device enroll
- [x] Device heartbeat + online/offline overview
- [x] Dashboard login, employees, devices pages
- [x] Agent enroll via API + daemon heartbeat/upload

## Phase 3 — Monitoring dashboard

- [x] Overview metrics from API
- [x] Screenshot list + authenticated image fetch
- [x] Timeline playback (play/pause/speed/scrub)
- [x] Activity stats panel
- [x] Per-device monitoring authorize/withdraw

## Phase 4 — Platform integration

- [x] macOS capture via `screencapture` when `CU_MOCK_SCREENSHOTS=false`
- [x] Activity sampling (idle/active estimates; no keystroke content)
- [x] LaunchAgent autostart registration from Setup
- [x] Windows autostart stub + CI-compatible platform crate

## Phase 5 — Storage and retention

- [x] Local private screenshot storage + optional MinIO in Compose
- [x] Configurable retention policy API + Storage UI
- [x] Idempotent cleanup (in-process hourly + Celery task)
- [x] Storage analytics (used bytes, by device, daily growth)

## Phase 6 — Performance and security

- [x] Agent CPU/memory/disk reporting in heartbeat
- [x] API rate limiting (SlowAPI)
- [x] Security headers middleware
- [x] Audit log on screenshot image access
- [x] Admin TOTP MFA setup/enable/disable + login MFA step

## Phase 7 — Production deployment

- [x] VPS port map 4000/4001 + host Postgres + Caddy snippet
- [x] PM2 deploy scripts (`infrastructure/deploy/`)
- [x] GitHub Actions Deploy VPS + Release agent (macOS/Windows)
- [ ] One-time root bootstrap on VPS (Postgres role + Caddy + DNS)
- [ ] Signed MSI/PKG/DMG (Apple/Authenticode)
- [ ] Automated Postgres backups

### Operator verification

See [dev.md](../dev.md). After Phase 5/6, also check **Storage** (retention/cleanup) and **Settings** (MFA).
