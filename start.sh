#!/usr/bin/env bash
# start.sh — 本地/远端启动 AI Pricing Dashboard（零依赖，无需 npm install）。
#   ./start.sh                前台启动（Ctrl-C 退出） → http://localhost:4178
#   ./start.sh -d             后台启动（setsid + nohup，SSH 断连存活；日志 ./aipd.local.log）
#   ./start.sh --tmux         tmux 会话启动（断连存活；会话名 aipd，日志 ./aipd.local.log）
#   PORT=8080 ./start.sh      自定义端口
#   HOST=0.0.0.0 ./start.sh   暴露到 LAN / Tailscale（默认仅本机 127.0.0.1）
# 整机部署用 ./deploy.sh（远端即以 --tmux 模式调用本脚本）。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

PORT="${PORT:-4178}"
HOST="${HOST:-127.0.0.1}"
MODE="${1:-fg}"

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
LOG="$HERE/aipd.local.log"

health_check() {
  sleep 1.2
  node -e "fetch('http://localhost:$PORT/api/health').then(r=>r.text()).then(t=>console.log('[start] health:',t)).catch(e=>console.log('[start] health ERR',e.message))"
}

case "$MODE" in
  -d|--bg)
    pkill -f 'server/index.mjs' 2>/dev/null || true
    setsid nohup env PORT="$PORT" HOST="$HOST" node server/index.mjs > "$LOG" 2>&1 < /dev/null &
    health_check
    echo "[start] 后台启动 → $URL"
    echo "[start] 日志: $LOG   停止: pkill -f 'server/index.mjs'"
    ;;
  --tmux)
    if ! command -v tmux >/dev/null 2>&1; then
      echo "✗ 未找到 tmux，请改用 ./start.sh -d" >&2; exit 1
    fi
    tmux kill-session -t aipd 2>/dev/null || true
    tmux new-session -d -s aipd "cd '$HERE' && PORT=$PORT HOST=$HOST node server/index.mjs > '$LOG' 2>&1"
    health_check
    echo "[start] tmux 会话 'aipd' → $URL   (tmux attach -t aipd 查看；停止: tmux kill-session -t aipd)"
    ;;
  fg)
    echo "[start] 前台启动 → $URL   (Ctrl-C 退出)"
    exec env PORT="$PORT" HOST="$HOST" node server/index.mjs
    ;;
  *)
    echo "✗ 未知参数: $MODE（用法: ./start.sh [-d|--tmux]）" >&2; exit 1
    ;;
esac
