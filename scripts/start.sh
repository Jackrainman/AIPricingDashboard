#!/usr/bin/env bash
# start.sh — MOVED: 启动脚本已三合一为仓库根目录 start.sh（前台 / -d 后台 / --tmux）。
# 本 shim 仅为兼容旧调用路径保留（shell 可用后可 git rm 删除）。
# 原语义 = 断连存活启动：有 tmux 走 --tmux，否则走 -d（setsid+nohup）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if command -v tmux >/dev/null 2>&1; then
  exec "$ROOT/start.sh" --tmux
else
  exec "$ROOT/start.sh" -d
fi
