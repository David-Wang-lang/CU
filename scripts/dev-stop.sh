#!/usr/bin/env bash
# Stop CU local stack started by scripts/dev-all.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_DIR="$ROOT/.dev-pids"

stop_one() {
  local name="$1"
  local pid_file="$PID_DIR/$name.pid"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" 2>/dev/null; then
      echo "• stopping $name (pid $pid)"
      # Kill process group children (uvicorn reload / cargo / next)
      kill "$pid" 2>/dev/null || true
      sleep 0.5
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
  else
    echo "• $name not tracked"
  fi
}

stop_one api
stop_one dashboard
stop_one daemon

# Fallback cleanup for common leftover processes
pkill -f "uvicorn app.main:app" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
pkill -f "cu-agent-daemon" 2>/dev/null || true

echo "CU stack stopped."
