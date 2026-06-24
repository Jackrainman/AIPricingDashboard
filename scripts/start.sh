#!/usr/bin/env bash
# start.sh — (re)start the dashboard server in a detached tmux session (fallback: setsid nohup).
# Survives SSH disconnect. Usage: PORT=4179 HOST=0.0.0.0 bash scripts/start.sh
set -e
PORT="${PORT:-4178}"
HOST="${HOST:-127.0.0.1}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

if command -v tmux >/dev/null 2>&1; then
  tmux kill-session -t aipd 2>/dev/null || true
  tmux new-session -d -s aipd "cd '$HERE' && PORT=$PORT HOST=$HOST node server/index.mjs > ~/aipd.log 2>&1"
else
  pkill -f 'server/index.mjs' 2>/dev/null || true
  setsid bash -c "cd '$HERE' && PORT=$PORT HOST=$HOST node server/index.mjs > ~/aipd.log 2>&1" </dev/null &
fi

sleep 1.8
node -e "fetch('http://localhost:$PORT/api/health').then(r=>r.text()).then(t=>console.log('[start] health:',t)).catch(e=>console.log('[start] health ERR',e.message))"
echo "[start] AI Pricing Dashboard on :$PORT (HOST=$HOST)"
