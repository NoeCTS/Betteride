#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3000}"

cd "$ROOT_DIR"

if command -v lsof >/dev/null 2>&1; then
  EXISTING_PIDS="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN || true)"
  if [[ -n "$EXISTING_PIDS" ]]; then
    echo "Stopping existing listener(s) on port $PORT: $EXISTING_PIDS"
    kill $EXISTING_PIDS || true
    sleep 1
  fi
fi

if [[ -d ".next" ]]; then
  echo "Clearing .next cache"
  rm -rf .next
fi

echo "Starting Betteride Ground Signal on http://$HOST:$PORT"
exec ./node_modules/.bin/next dev --hostname "$HOST" --port "$PORT"
