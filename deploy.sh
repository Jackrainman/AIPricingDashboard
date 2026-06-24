#!/usr/bin/env bash
# deploy.sh — sync this project to a remote host and (re)start the server.
# Default target = rainman WSL. Usage: ./deploy.sh   (override via env: HOST DEST PORT)
set -euo pipefail

HOST="${HOST:-rainman@100.78.202.84}"
DEST="${DEST:-AIPricingDashboard}"          # relative to remote $HOME
PORT="${PORT:-4178}"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "[deploy] syncing $HERE -> $HOST:~/$DEST (port $PORT)"

if command -v rsync >/dev/null 2>&1; then
  rsync -az --delete \
    --exclude '.git' --exclude 'data/.cache' --exclude '*.tmp' \
    --exclude 'node_modules' --exclude 'test/shots-*.png' \
    "$HERE/" "$HOST:$DEST/"
else
  echo "[deploy] rsync not found locally; falling back to tar-over-ssh"
  tar -C "$HERE" --exclude='.git' --exclude='data/.cache' --exclude='*.tmp' --exclude='node_modules' -czf - . \
    | ssh "$HOST" "mkdir -p $DEST && tar -C $DEST -xzf -"
fi

echo "[deploy] restarting server on $HOST:$PORT (tmux session 'aipd')"
ssh "$HOST" "cd $DEST && PORT=$PORT HOST=0.0.0.0 bash scripts/start.sh"

echo "[deploy] done → http://$(echo "$HOST" | sed 's/.*@//'):$PORT"
