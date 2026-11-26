# Deployment

## Target (initial VPS)

- Ubuntu 24.04 LTS
- 4 vCPU / 8 GB RAM / 200 GB SSD
- Docker + Docker Compose
- HTTPS domain (Let's Encrypt) — Phase 7

## Services

Defined in root `docker-compose.yml`:

| Service | Role |
|---------|------|
| nginx | Reverse proxy (port 8080 in Phase 1 stub) |
| api | FastAPI + Alembic entrypoint |
| dashboard | Next.js standalone |
| postgres | Metadata |
| redis | Celery broker/backend |
| celery-worker | Background jobs |
| celery-beat | Scheduler (retention in Phase 5) |
| minio | S3-compatible object storage |
| minio-init | Creates private bucket |

Volumes `postgres_data`, `redis_data`, and `minio_data` are persistent.

## Deploy steps (Phase 1 outline)

1. Clone repo on the VPS.
2. Copy `.env.example` → `.env` and set strong secrets.
3. `docker compose up -d --build`
4. Verify `GET /api/v1/health` through Nginx.
5. Configure TLS and domain (Phase 7).
6. Schedule backups for Postgres and MinIO volumes.

## Local full stack

```bash
cp .env.example .env
./scripts/dev-up.sh
```

Stop with `./scripts/dev-down.sh` (volumes preserved).

## Production notes

- Bind API to `0.0.0.0:$PORT` inside containers (Compose uses 8000).
- Filesystem is ephemeral outside named volumes — never store screenshots only on container FS.
- Size storage from measured retention (default 15 days) and device count.
- Healthchecks and `restart: unless-stopped` are configured for core services.
