#!/usr/bin/env bash
# start.sh — 本地启动 AI Pricing Dashboard（零依赖，无需 npm install）。
#   ./start.sh                前台启动（Ctrl-C 退出） → http://localhost:4178
#   ./start.sh -d             后台启动（nohup，日志 ./aipd.local.log，停止见末尾提示）
#   PORT=8080 ./start.sh      自定义端口
#   HOST=0.0.0.0 ./start.sh   暴露到 LAN / Tailscale（默认仅本机 127.0.0.1）
# 远端 / 断连存活的分离式启动请用 scripts/start.sh（tmux）；整机部署用 ./deploy.sh。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

PORT="${PORT:-4178}"
HOST="${HOST:-127.0.0.1}"

# 前置检查：Node ≥ 20
if ! command -v node >/dev/null 2>&1; then
  echo "✗ 未找到 node，请先安装 Node ≥ 20" >&2; exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "✗ Node 版本过低（$(node -v)），需 ≥ 20" >&2; exit 1
fi

DISPLAY_HOST="$([ "$HOST" = "0.0.0.0" ] && echo localhost || echo "$HOST")"
URL="http://$DISPLAY_HOST:$PORT"

if [ "${1:-}" = "-d" ] || [ "${1:-}" = "--bg" ]; then
  pkill -f 'server/index.mjs' 2>/dev/null || true
  nohup env PORT="$PORT" HOST="$HOST" node server/index.mjs > "$HERE/aipd.local.log" 2>&1 &
  sleep 1.2
  node -e "fetch('http://localhost:$PORT/api/health').then(r=>r.text()).then(t=>console.log('[start] health:',t)).catch(e=>console.log('[start] health ERR',e.message))"
  echo "[start] 后台启动 → $URL"
  echo "[start] 日志: $HERE/aipd.local.log   停止: pkill -f 'server/index.mjs'"
else
  echo "[start] 前台启动 → $URL   (Ctrl-C 退出)"
  exec env PORT="$PORT" HOST="$HOST" node server/index.mjs
fi
