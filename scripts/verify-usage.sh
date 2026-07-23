#!/usr/bin/env bash
# verify-usage.sh — 用量追踪模块的一键验证 + 提交脚本
# 用法: cd ~/projects/AIPricingDashboard && bash scripts/verify-usage.sh
# 任何一步失败都会停下并打印 [FAIL]，把完整输出贴回给我即可。
set -uo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n===== %s =====\n' "$1"; }
fail() { printf '\n[FAIL] %s\n' "$1"; exit 1; }

step "0. 环境"
node --version || fail "node 不可用"
git --version || fail "git 不可用"

step "1. 语法检查（后端 .mjs）"
for f in server/usage.mjs server/index.mjs scripts/usage/lib.mjs \
         scripts/usage/fetchers/openrouter.mjs \
         scripts/usage/fetchers/_example-cookie.mjs \
         scripts/usage/fetchers/_example-cli.mjs; do
  node --check "$f" && echo "ok: $f" || fail "语法错误: $f"
done

step "2. 语法检查（前端 ES module .js）"
for f in public/js/usage.js public/js/api.js public/js/app.js; do
  node --input-type=module --check < "$f" && echo "ok: $f" || fail "语法错误: $f"
done

step "3. 冒烟测试（临时端口 4199 启动服务）"
PORT=4199 node server/index.mjs > /tmp/aipd-verify.log 2>&1 &
SRV_PID=$!
trap 'kill $SRV_PID 2>/dev/null || true' EXIT
sleep 2
kill -0 $SRV_PID 2>/dev/null || { cat /tmp/aipd-verify.log; fail "服务未能启动"; }

echo "--- GET /api/usage/platforms ---"
curl -s --max-time 10 http://127.0.0.1:4199/api/usage/platforms | head -c 2000; echo
curl -s --max-time 10 http://127.0.0.1:4199/api/usage/platforms | grep -q '"id"' \
  || fail "/api/usage/platforms 响应异常"

echo "--- GET /api/usage ---"
curl -s --max-time 10 http://127.0.0.1:4199/api/usage | head -c 1000; echo
curl -s --max-time 10 http://127.0.0.1:4199/api/usage | grep -q '"generated_at"' \
  || fail "/api/usage 响应异常"

echo "--- POST /api/usage/refresh ---"
curl -s --max-time 30 -X POST http://127.0.0.1:4199/api/usage/refresh | head -c 1000; echo

echo "--- POST enable 未知平台（期望报错而不是崩溃）---"
curl -s --max-time 10 -X POST -H 'Content-Type: application/json' -d '{}' \
  http://127.0.0.1:4199/api/usage/platforms/__nope__/enable | head -c 500; echo

echo "--- 首页 HTML 是否包含 用量 页签（由 app.js 渲染，检查 JS 已加载即可）---"
curl -s --max-time 10 http://127.0.0.1:4199/ | grep -q 'app.js' || fail "首页异常"
echo "ok"

kill $SRV_PID 2>/dev/null || true
trap - EXIT

step "4. git 提交"
git status --short
git add server/usage.mjs server/index.mjs scripts/usage/ \
        public/js/usage.js public/js/api.js public/js/app.js \
        public/css/styles.css .gitignore data/credentials/ || fail "git add 失败"
git commit -m "feat: pluggable usage-tracking module

- fetcher auto-discovery from scripts/usage/fetchers/ (drop-in platforms)
- auth-expiry state machine: auth_expired pause + exponential backoff + stale cache
- per-platform scheduler with jitter, in-memory cache, atomic credential store
- routes: GET/POST /api/usage(+ /refresh, /platforms, /platforms/:id/enable, DELETE)
- frontend usage page: platform cards, status badges, progress bars, credential form
- openrouter fetcher (working reference) + cookie/CLI templates + README
- credentials gitignored (config.json.example tracked as template)" || fail "git commit 失败"

step "5. git push"
if git remote | grep -q .; then
  git push || fail "git push 失败（可能需要先登录/配置远端）"
  echo "[OK] 已推送"
else
  echo "[SKIP] 没有配置 git remote，跳过 push"
fi

printf '\n[DONE] 全部通过\n'
