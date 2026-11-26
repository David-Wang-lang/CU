#!/bin/sh
set -eu
echo "Running database migrations..."
alembic upgrade head || echo "Migration skipped or failed (DB may still be starting)"
exec "$@"
