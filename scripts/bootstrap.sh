#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> CU bootstrap"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env"
fi

echo "==> Node / pnpm"
pnpm install

echo "==> Python API"
(cd apps/api && uv sync --extra dev)

echo "==> Rust agent core + daemon"
(cd apps/agent && cargo test -p cu-agent-core && cargo check -p cu-agent-daemon)

echo "Bootstrap complete. Start Docker Desktop, then run: ./scripts/dev-up.sh"
echo "Agent setup wizard: pnpm --filter @cu/agent setup:dev"
echo "Agent daemon:       cd apps/agent && cargo run -p cu-agent-daemon"
