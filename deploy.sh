#!/usr/bin/env bash
# deploy.sh — sync this project to a remote host and (re)start the server.
# Default target = rainman WSL. Usage: ./deploy.sh   (override via env: DEPLOY_HOST DEST PORT)
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-rainman@100.78.202.84}"   # ssh 目标；原名 HOST，与 server 绑定地址 HOST 同名不同义，故改名
DEST="${DEST:-AIPricingDashboard}"          # relative to remote $HOME
PORT="${PORT:-4178}"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "[deploy] syncing $HERE -> $DEPLOY_HOST:~/$DEST (port $PORT)"

if command -v rsync >/dev/null 2>&1; then
  rsync -az --delete \
    --exclude '.git' --exclude 'data/.cache' --exclude '*.tmp' \
    --exclude 'node_modules' --exclude 'test/shots-*.png' \
    --exclude 'data/credentials' --exclude 'data/subscriptions.json' \
    "$HERE/" "$DEPLOY_HOST:$DEST/"
else
  echo "[deploy] rsync not found locally; falling back to tar-over-ssh"
  tar -C "$HERE" --exclude='.git' --exclude='data/.cache' --exclude='*.tmp' --exclude='node_modules' --exclude='data/credentials' --exclude='data/subscriptions.json' -czf - . \
    | ssh "$DEPLOY_HOST" "mkdir -p $DEST && tar -C $DEST -xzf -"
fi

echo "[deploy] restarting server on $DEPLOY_HOST:$PORT (tmux session 'aipd')"
ssh "$DEPLOY_HOST" "cd $DEST && PORT=$PORT HOST=0.0.0.0 bash start.sh --tmux"

echo "[deploy] done → http://$(echo "$DEPLOY_HOST" | sed 's/.*@//'):$PORT"
