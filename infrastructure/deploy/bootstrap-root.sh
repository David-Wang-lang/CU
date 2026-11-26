#!/usr/bin/env bash
# One-time VPS bootstrap — run as root (or: sudo bash bootstrap-root.sh)
# Creates Postgres role/DB, /srv/cu (optional), Caddy site, docker group (optional).
set -euo pipefail

CU_DB_USER="${CU_DB_USER:-cu}"
CU_DB_NAME="${CU_DB_NAME:-cu}"
CU_DB_PASS="${CU_DB_PASS:-$(openssl rand -hex 24)}"
CU_DOMAIN="${CU_DOMAIN:-cu.jobapplicationtracking.tech}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_ROOT="${APP_ROOT:-/home/${DEPLOY_USER}/cu}"

echo "==> Postgres role + database"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${CU_DB_USER}') THEN
    CREATE ROLE ${CU_DB_USER} LOGIN PASSWORD '${CU_DB_PASS}';
  ELSE
    ALTER ROLE ${CU_DB_USER} WITH LOGIN PASSWORD '${CU_DB_PASS}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE ${CU_DB_NAME} OWNER ${CU_DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${CU_DB_NAME}')\gexec
GRANT ALL PRIVILEGES ON DATABASE ${CU_DB_NAME} TO ${CU_DB_USER};
\\c ${CU_DB_NAME}
GRANT ALL ON SCHEMA public TO ${CU_DB_USER};
ALTER SCHEMA public OWNER TO ${CU_DB_USER};
SQL

echo "==> App directories for ${DEPLOY_USER}"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" \
  "$APP_ROOT" \
  "$APP_ROOT/releases" \
  "$APP_ROOT/shared" \
  "$APP_ROOT/shared/data/screenshots" \
  "$APP_ROOT/shared/data/videos" \
  "$APP_ROOT/shared/logs"

ENV_FILE="$APP_ROOT/shared/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  SECRET="$(openssl rand -hex 32)"
  cat >"$ENV_FILE" <<EOF
CU_ENV=production
CU_LOG_LEVEL=INFO
DATABASE_URL=postgresql+asyncpg://${CU_DB_USER}:${CU_DB_PASS}@127.0.0.1:5432/${CU_DB_NAME}
SECRET_KEY=${SECRET}
SEED_ON_STARTUP=true
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=$(openssl rand -base64 12)
CORS_ORIGINS=https://${CU_DOMAIN}
NEXT_PUBLIC_API_URL=https://${CU_DOMAIN}/api/v1
API_HOST=127.0.0.1
API_PORT=4000
LOCAL_STORAGE_PATH=${APP_ROOT}/shared/data/screenshots
DEFAULT_RETENTION_DAYS=15
EOF
  chown "$DEPLOY_USER:$DEPLOY_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Wrote $ENV_FILE"
else
  echo "Keeping existing $ENV_FILE"
fi

CADDY_SNIPPET="/etc/caddy/Caddyfile"
if ! grep -q "$CU_DOMAIN" "$CADDY_SNIPPET" 2>/dev/null; then
  echo "==> Appending Caddy site for ${CU_DOMAIN}"
  cat >>"$CADDY_SNIPPET" <<EOF

# CU monitoring platform
${CU_DOMAIN} {
    encode gzip
    request_body {
        max_size 64MB
    }
    handle /api/* {
        reverse_proxy 127.0.0.1:4000
    }
    handle /docs* {
        reverse_proxy 127.0.0.1:4000
    }
    handle /openapi.json {
        reverse_proxy 127.0.0.1:4000
    }
    handle {
        reverse_proxy 127.0.0.1:4001
    }
}
EOF
  systemctl reload caddy
else
  echo "Caddy already mentions ${CU_DOMAIN}"
fi

# Optional: docker access for future compose deploys
if getent group docker >/dev/null; then
  usermod -aG docker "$DEPLOY_USER" || true
fi

echo ""
echo "Bootstrap complete."
echo "  Domain:   https://${CU_DOMAIN}  (point DNS A record to this VPS)"
echo "  API:      127.0.0.1:4000"
echo "  Dashboard:127.0.0.1:4001"
echo "  Env:      ${ENV_FILE}"
echo "  DB pass stored in DATABASE_URL inside that env file."
echo ""
echo "Next: as ${DEPLOY_USER}, run infrastructure/deploy/deploy.sh from a release,"
echo "or push to main with GitHub Actions deploy workflow."
