# AI Pricing Dashboard

> 个人 AI 工具定价看板 —— 一个页面看完官方 API 价格、Coding Plan、性价比之选、成本计算。
> 全栈（零依赖 Node 后端 + 原生 JS 单页前端），本地优先，隐私数据不出本机。

## 三大栏目（左右切换） + 性价比侧边栏

| 栏目 | 内容 |
|------|------|
| **个人仪表盘**（默认） | 中转站健康灯 · 订阅续费倒计时 · 月费总计 · 我在用的 Coding 工具 · 规则命中的关注模型 |
| **对比表** | **官方 API**：1400+ 模型价目（输入/输出/缓存读写/上下文/最大输出），多维筛选排序；**Coding Plan**：按计量方式分四桶——按 Token / 按额度($) / 按次数 / 其他 |
| **计算器** | 输入用量场景 → 各模型月成本排名；Coding Plan 等效换算（估算） |
| **性价比之选**（侧边栏） | 直接计算：综合性价比之王 / 编程最划算 / 跑量最划算 / 推理最划算 / 订阅最划算 + 性价比榜 Top10 |

## 数据来源（开源，自动同步）

- **官方 API 价格**：[`pydantic/genai-prices`](https://github.com/pydantic/genai-prices)（主，MIT，cache_write 一等字段）+ [`BerriAI/litellm`](https://github.com/BerriAI/litellm)（补 max_output / vision / tool-calling，作 fallback）。
- **模型标注**：`data/model-annotations.json`（release_date + 编程/旗舰/推理标签的人工叠加层，脚本永不覆盖）。
- **Coding Plan**：`data/coding-plans.json`（人工 seed，季度 review）。
- **中转站**：`data/relays.json`（AnyRouter 两端点，免 key 探活：401 new-api JSON = 在线）。

## 快速开始

```bash
# 启动（零依赖，无需 npm install）
./start.sh                     # 前台 → http://localhost:4178（Ctrl-C 退出）
./start.sh -d                  # 后台（日志 aipd.local.log，停止 pkill -f server/index.mjs）
# 自定义端口 / 暴露到 LAN（Tailscale）
PORT=8080 ./start.sh
HOST=0.0.0.0 ./start.sh
# 等价底层命令：node server/index.mjs（或 npm start）

# 同步官方 API 数据（拉取上游 → 归一化 → 写 data/official-api.json）
node scripts/sync-official-api.mjs

# 探测中转站存活
node scripts/check-relays.mjs
```

> Node ≥ 20。后端用内置 `http`，**没有任何运行时依赖**，复制到任意装了 Node 的机器即可跑。

## API（后端）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/dashboard` | 仪表盘聚合（中转站 + 订阅告警 + 我的工具 + 关注模型 + top picks） |
| GET | `/api/compare` | 官方 API 模型（含规则状态 + 筛选维度） |
| GET | `/api/official-api` | 原始归一化模型表 |
| GET | `/api/coding-plans` | Coding 工具 + 计量分类 |
| GET | `/api/recommendations` | 性价比之选（卡片 + 榜单） |
| POST | `/api/calculate` | 用量 → 各模型月成本 + Coding Plan 等效 |
| GET/PUT | `/api/rules` | 规则引擎（可读写） |
| GET/PUT | `/api/subscriptions` | 个人订阅（**仅本地**，写端点服务端落盘） |
| GET | `/api/relays` | 中转站状态（含 STALE 守卫） |
| POST | `/api/sync` · `/api/check-relays` | 触发同步 / 探测脚本 |

## 隐私边界（架构级）

- `data/subscriptions.json` 含账单信息 → **第一天 `.gitignore`**，永不进 git；`data/subscriptions.example.json` 作占位。
- 写端点无鉴权 = 仅本地单用户使用；静态服务做了路径穿越防护，写操作只落 `data/` 内固定文件。
- 前端只读后端 JSON，**永不直连厂商/中转站** → 根除 CORS + token 泄露。

## 规则引擎

`data/rules.json` = 展示决策的唯一真相。状态：🟢 达标/关注 · 🔴 不达标 · ⚪ 未设规则。
优先级 = 显式条目 > 全局默认（show_gray）；未知 action 退回 ⚪ 不崩。支持 `always_show` / `ignore`(+`unless`) / `show_if_below` / `price_threshold`。

## 部署 / 测试

- **端口**：本地与部署统一默认 **4178**（`server/index.mjs` 内置默认；任意脚本均可用 `PORT` 覆盖）。
- `./start.sh`：本地启动（前台，`-d` 后台）。`scripts/start.sh`：分离式 tmux 启动（远端 / 断连存活）。
- `deploy.sh`：rsync 到远端 + 以 `HOST=0.0.0.0 PORT=4178` 重启服务（默认 rainman WSL，tmux 会话 `aipd`）。
- `test/shots.mjs`：Playwright 截图三个 tab + 计算器，校验零控制台错误。

## 文档

- [需求文档 (PRD)](docs/PRD.md)
- [需求 + 可行性分析（6 项锁定决策）](docs/requirements-feasibility-analysis.md)

## 目录结构

```
AIPricingDashboard/
├── server/            ← 零依赖 Node 后端（http + 路由 + 规则/推荐/计算器）
│   ├── index.mjs  store.mjs  rules.mjs  recommend.mjs  calculator.mjs
├── public/            ← 原生 JS 单页前端
│   ├── index.html  css/styles.css  js/{app,util,api,sidebar,dashboard,compare,calculator}.js
├── scripts/           ← sync-official-api.mjs  check-relays.mjs
├── data/              ← official-api.json  coding-plans.json  model-annotations.json
│                         relays.json  rules.json  subscriptions.json(gitignored)
├── docs/  deploy.sh  test/shots.mjs  package.json
```
