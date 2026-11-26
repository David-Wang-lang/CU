#!/usr/bin/env bash
# Start CU local stack: API + Dashboard + Daemon
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOG_DIR="$ROOT/.dev-logs"
PID_DIR="$ROOT/.dev-pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

export PATH="${HOME}/.local/bin:${HOME}/.cargo/bin:${PATH}"

# Load repo .env (for CU_MOCK_SCREENSHOTS, etc.)
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

already_running() {
  local name="$1"
  local pid_file="$PID_DIR/$name.pid"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    rm -f "$pid_file"
  fi
  return 1
}

start_bg() {
  local name="$1"
  shift
  if already_running "$name"; then
    echo "• $name already running (pid $(cat "$PID_DIR/$name.pid"))"
    return 0
  fi
  echo "• starting $name..."
  nohup "$@" >"$LOG_DIR/$name.log" 2>&1 &
  echo $! >"$PID_DIR/$name.pid"
  echo "  pid $(cat "$PID_DIR/$name.pid")  log $LOG_DIR/$name.log"
}

# --- API ---
if [[ ! -f apps/api/.env ]]; then
  cp .env.example apps/api/.env 2>/dev/null || true
fi
(
  cd apps/api
  if [[ ! -d .venv ]]; then
    uv sync --extra dev
  fi
)
start_bg api bash -lc "cd '$ROOT/apps/api' && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

# --- Dashboard ---
if [[ ! -d node_modules ]]; then
  pnpm install
fi
start_bg dashboard bash -lc "cd '$ROOT' && pnpm --filter @cu/dashboard dev"

# --- Daemon (only if enrolled) ---
CONFIG="${HOME}/Library/Application Support/CU/agent.toml"
if [[ -f "$CONFIG" ]] && grep -q 'client_id' "$CONFIG" 2>/dev/null; then
  # Prefer real capture when CU_MOCK_SCREENSHOTS=false (needs Screen Recording for the daemon binary)
  start_bg daemon bash -lc "unset CARGO_TARGET_DIR; cd '$ROOT/apps/agent' && export CU_MOCK_SCREENSHOTS=\${CU_MOCK_SCREENSHOTS:-false} && cargo run -p cu-agent-daemon"
else
  echo "• daemon skipped (not enrolled yet)"
  echo "  Run setup first:  pnpm --filter @cu/agent setup:dev"
  echo "  Then:             ./scripts/dev-all.sh"
fi

echo ""
echo "CU stack starting:"
echo "  API:       http://localhost:8000/api/v1/health"
echo "  Docs:      http://localhost:8000/docs"
echo "  Dashboard: http://localhost:3000"
echo "  Admin:     admin@example.com / admin123!"
echo ""
echo "Logs:  $LOG_DIR/"
echo "Stop:  ./scripts/dev-stop.sh"
echo "Setup: pnpm --filter @cu/agent setup:dev   # IT enroll (once)"
