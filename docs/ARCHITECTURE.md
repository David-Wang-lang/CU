# Architecture

## Product

**CU** monitors company-owned Windows and macOS endpoints for DLP and policy compliance. Administrators manage devices and review authorized monitoring records through a web dashboard.

## Components

1. **Desktop agent** (`apps/agent`)
   - **CU Agent Setup** (Tauri) — IT-only one-time install/enrollment; registers LaunchAgent; exits. No employee monitoring UI or notifications.
   - **cu-agent-daemon** (headless Rust) — heartbeat, screenshot upload, activity samples; no UI.
   - Shared logic in `cu-agent-core`; macOS capture via `screencapture` when `CU_MOCK_SCREENSHOTS=false`.
2. **Backend API** (`apps/api`) — FastAPI, SQLAlchemy, Alembic, Celery. Versioned under `/api/v1`.
3. **Data plane** — PostgreSQL (metadata), Redis (Celery/cache), MinIO (private screenshot objects).
4. **Admin dashboard** (`apps/dashboard`) — Next.js App Router, Tailwind, TanStack Query, Zustand.

## Agent flow

```text
CU Agent Setup (once) --> agent.toml + daemon install stub
cu-agent-daemon (24/7) --> HTTPS REST /api/v1 --> API
```

- Shared Rust modules for enrollment, sync, local queue, heartbeat (Phase 2+).
- OS-specific capture and startup behind platform crates.
- macOS LaunchAgent / Windows Service for autostart (Phase 4; Phase 1 marks a stub flag only).
- Never bypass TCC/Screen Recording or conceal from system management tools.
- No tray icon, permanent agent window, or employee-facing monitoring notifications.

## Communication

```text
Daemon --HTTPS REST /api/v1-->  Nginx --> FastAPI --> PostgreSQL / Redis / MinIO
Admin  --HTTPS--------------->  Nginx --> Next.js  --> FastAPI
```

## Data model (summary)

Organizations → Users/Roles, Employees, Devices → Credentials, Policies, Authorizations → Screenshot records (metadata), Activity events, Heartbeats, Retention policies, Audit logs, Alerts, Settings.

Screenshot **files** are stored in MinIO; PostgreSQL stores keys and metadata only. All timestamps are UTC.

## Security boundaries

See [SECURITY.md](SECURITY.md). Org-level isolation, device credentials, short-lived tokens, private object storage, admin audit for sensitive views.

## Deployment

Docker Compose on Ubuntu VPS: Nginx, API, dashboard, Postgres, Redis, Celery worker/beat, MinIO. See [DEPLOYMENT.md](DEPLOYMENT.md). Endpoint packages (MSI/PKG/DMG) ship Setup + daemon in Phase 7.
