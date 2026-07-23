#!/usr/bin/env bash
# verify-cleanup.sh — 屎山清理的验证 + 分批次提交推送
# 用法: cd ~/projects/AIPricingDashboard && bash scripts/verify-cleanup.sh
# 失败会停在 [FAIL]，把完整输出贴回即可。
set -uo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n===== %s =====\n' "$1"; }
fail() { printf '\n[FAIL] %s\n' "$1"; exit 1; }

step "1. 语法检查"
for f in server/index.mjs server/store.mjs server/rules.mjs server/calculator.mjs \
         scripts/sync-official-api.mjs lab/sync-benchmarks.mjs; do
  node --check "$f" && echo "ok: $f" || fail "语法错误: $f"
done
for f in public/js/util.js public/js/api.js public/js/dashboard.js \
         public/js/sidebar.js public/js/compare.js public/js/calculator.js \
         public/js/app.js public/js/usage.js; do
  node --input-type=module --check < "$f" && echo "ok: $f" || fail "语法错误: $f"
done
for f in start.sh deploy.sh; do
  bash -n "$f" && echo "ok: $f" || fail "shell 语法错误: $f"
done
python3 -c "import json; json.load(open('data/rules.json'))" && echo "ok: data/rules.json" \
  || fail "data/rules.json 不是合法 JSON"

step "2. 冒烟测试（临时端口 4199）"
PORT=4199 node server/index.mjs > /tmp/aipd-cleanup.log 2>&1 &
SRV_PID=$!
trap 'kill $SRV_PID 2>/dev/null || true' EXIT
sleep 2
kill -0 $SRV_PID 2>/dev/null || { cat /tmp/aipd-cleanup.log; fail "服务未能启动"; }

code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@"; }

[ "$(code http://127.0.0.1:4199/)" = 200 ] || fail "GET / 非 200"
echo "ok: GET / → 200"
[ "$(code http://127.0.0.1:4199/api/dashboard)" = 200 ] || fail "GET /api/dashboard 非 200"
echo "ok: GET /api/dashboard → 200"
[ "$(code http://127.0.0.1:4199/api/compare)" = 200 ] || fail "GET /api/compare 非 200"
echo "ok: GET /api/compare → 200"
[ "$(code http://127.0.0.1:4199/api/usage)" = 200 ] || fail "GET /api/usage 非 200"
echo "ok: GET /api/usage → 200"
# SPA fallback 已删：缺失资源应 404 而不是 200+HTML
[ "$(code http://127.0.0.1:4199/js/__missing__.js)" = 404 ] || fail "缺失资源未返回 404（SPA fallback 仍在？）"
echo "ok: 缺失资源 → 404"
# /api/calculate 坏 JSON 应 400
[ "$(code -X POST -H 'Content-Type: application/json' -d '{bad json' http://127.0.0.1:4199/api/calculate)" = 400 ] \
  || fail "POST /api/calculate 坏 JSON 未返回 400"
echo "ok: POST /api/calculate 坏 JSON → 400"

kill $SRV_PID 2>/dev/null || true
trap - EXIT

step "3. 待提交变更一览"
git status --short

push_retry() {
  local i
  for i in 1 2 3 4; do
    git push && { echo "[OK] pushed"; return 0; }
    echo "[retry] push 失败（网络/TLS 抖动），$((i*5)) 秒后重试 ($i/4)..."
    sleep $((i*5))
  done
  fail "git push 多次重试仍失败。本地 commit 已就绪，网络恢复后手动 git push 即可"
}

commit_push() { # $1=message  其余=paths（幂等：无变更则跳过 commit 只 push）
  local msg="$1"; shift
  git add "$@" || fail "git add 失败: $*"
  if git diff --cached --quiet; then
    echo "[SKIP] 该批次无变更（可能已提交过）: $(echo "$msg" | head -1)"
  else
    git commit -m "$msg" || fail "git commit 失败: $(echo "$msg" | head -1)"
  fi
  push_retry
}

safe_rm() { # 幂等 git rm
  if git ls-files --error-unmatch "$1" >/dev/null 2>&1; then
    git rm -qf "$1" || fail "git rm $1 失败"
  else
    echo "[SKIP] $1 已不在版本库中"
  fi
}

step "4. 批次提交（每批 commit 后立即 push）"

echo "--- 当前未推送的 commit ---"
git log origin/master..HEAD --oneline 2>/dev/null || git log --oneline -5
echo "--- 最近一个 commit 的文件清单（核对批次1是否完整）---"
git show --stat --format='%h %s' HEAD | head -20

commit_push "chore: remove dead code and fix misleading copy

- util.js: drop unused el(), \$, fmtDateTime
- api.js: drop unused officialApi()/rules()/saveRules(); extract post() helper
- dashboard.js: point always_show hint to data/rules.json; unify querySelector usage
- sidebar.js: drop dead CARD_ICON.frontier
- compare.js: remove dead ternary (? 1 : 1)
- sync-official-api.mjs: drop dead thinking condition/double uniq/huggingface branch;
  merge VENDOR_LITELLM + PROVIDER_TYPE into single VENDORS table (fixes voyageai drift)" \
  public/js/util.js public/js/api.js public/js/dashboard.js \
  public/js/sidebar.js public/js/compare.js scripts/sync-official-api.mjs

commit_push "refactor: rules engine and config schema cleanup

- rules.mjs: drop price_threshold alias, triple key fallback, conditional_show dead branches
- matchRule: longest-key-first substring match (gpt-5 no longer shadows gpt-5-pro)
- evalRelay: drop unused rules param (call site updated)
- store.mjs: drop legacy coerce() (all data files are wrapper format)
- remove dead config fields: defaults.new_tool_action, calculator.session_*_tokens
- calculator: unify fallback model to claude-sonnet-4-6, cross-reference default constants" \
  server/rules.mjs server/store.mjs data/rules.json \
  server/calculator.mjs public/js/calculator.js

commit_push "fix(server): input validation, script guard, proper 404

- /api/calculate: 400 on malformed JSON (was 500, now consistent with other routes)
- runScript: 120s timeout + in-flight guard (duplicate trigger -> 409)
- remove dead SPA fallback; missing assets now 404 instead of 200+HTML" \
  server/index.mjs

safe_rm scripts/sync-benchmarks.mjs
commit_push "chore: retire sync-benchmarks prototype to lab/

- 160-line PROTOTYPE with no consumer (recommend.mjs does not read benchmarks.json)
- moved to lab/ as-is; package.json sync:bench path updated" \
  lab/sync-benchmarks.mjs package.json

safe_rm scripts/start.sh
commit_push "chore: consolidate start scripts, harden deploy

- start.sh: single entry (fg default, -d background, --tmux), set -euo pipefail everywhere
- deploy.sh: HOST -> DEPLOY_HOST (was overloaded with server bind address)
- deploy.sh: exclude data/credentials and data/subscriptions.json from rsync/tar
  (credentials and personal billing never leave this machine)" \
  start.sh deploy.sh

step "5. 收尾"
git status --short
git log --oneline -6
printf '\n[DONE] 全部批次已提交并推送\n'
