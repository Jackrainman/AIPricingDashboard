# AI Pricing Dashboard — 需求分析 + 可行性分析

> 配套 [PRD](PRD.md) 的 M0 阶段产出：把 PRD 落成**可执行的范围、风险判断与已锁定决策**。
> 本文**取代 PRD §8 的开放问题**（下方"已锁定决策"即其答案）。
>
> **创建日期**：2026-06-23　**方法**：5 路并行研究（数据源 / 中转站 / Coding 定价 / 前端部署 / 需求拆解）+ Opus 综合 + 中转站端点实测
> **状态**：分析完成 ✅，6 项决策已锁定，待进入 M1 实现

---

## 0. 一页结论（TL;DR）

- **MVP = 官方 API 定价 + 订阅 + 规则引擎 + 手工 seed 的 Coding 工具表 + 中转站占位 widget**，一次会话本地交付。
- **三处 PRD 乐观假设被推翻**：①"双击 index.html 直接看"是假的（浏览器封 `file://` fetch，必须 `http.server`）；②`subscriptions.json` 含账单信息，进公开 repo = 财务泄露；③等效换算单一数字最多差 10×、会误导。
- **一处 feasibility 误判被实测纠正**：AnyRouter **没死**——两个端点今日均存活（new-api 栈，免 key 即可判存活）。
- **没有任何 OSS 是 4-in-1 完美匹配**：策略 = vendor 开源价格数据 + copy 几个零依赖组件 + 自建统一壳与规则引擎。

---

## 1. 需求分析（Requirements Analysis）

### 1.1 模块拆解（已明确）

| 模块 | 核心需求 |
|---|---|
| **官方 API 定价** | 从开源 JSON 每日同步 500+ 模型；统一内部 schema = `{model_id, vendor, input_per_m, output_per_m, cache_read/write_per_m(可空), context_window, max_output(可空), tags[], status, source_updated_at}`；**缺字段存 `null` 不省略**；客户端筛选/排序。 |
| **Coding Tools 对比** | 每工具一条，含 `plans[]` + 用户自填 `my_status`（**永不被脚本覆盖**）；等效换算在渲染时算（不存储）。 |
| **中转站健康** | 后端脚本探测，写 `data/relays.json`-驱动的多中转站状态；**前端只读 JSON，永不直连中转站**（避 CORS）。 |
| **订阅续费** | 纯用户维护 JSON，脚本只覆写 `alerts[]` + `total_monthly_usd`，其余字段不动。 |
| **规则引擎** | `rules.json` = 展示决策唯一真相；前端渲染时求值，优先级 = **显式条目 > tag 级 > 全局默认(show_gray)**；未知 action 退回 show_gray 不崩。 |

### 1.2 范围蔓延风险（刻意收敛）

- **等效换算（credit→token）**：厂商不公开 credit→token 映射 → 降级为"带免责声明的估算"，不追求精确。
- **浏览器内"⚙️ 编辑规则 UI"**：静态站无后端写盘，**架构上不可能** → 改为只读 + "改 `rules.json` 后刷新"。
- **Coding 定价自动爬虫**：JS 渲染 + Cloudflare 403 最脆弱 → 手工 seed，爬虫 defer。
- **多中转站 / 价格历史图表 / 参考模型下拉** → 全部 defer 出 MVP。

---

## 2. 可行性分析（Feasibility Analysis）

### 2.1 逐模块判定

| 模块 | 判定 | 决定性风险 / 结论 |
|---|---|---|
| **官方 API 定价** | 🟢 **GO** | 最高价值最低风险，**先做**。实测 `pydantic/genai-prices` 在线（cache_write 一等字段 + 正式 JSON schema + MIT）作主源；`litellm` 补 context_window + vision/tool-calling + 作 fallback；**弃 `TechyNilesh/LLMPrice`**（仅 litellm 重打包）。`release_date` + `coding-optimized/capable` tag **无任何源提供** → 必须手工 `model-annotations.json` 叠加层。`agent-bulk`(<$0.5/M & ctx≥128K)、`reasoning`(≥$5/M) 脚本自动打。 |
| **订阅续费** | 🟢 **GO** | 与官方 API 同期做（共用布局，零爬零轮询）。**唯一硬风险=隐私泄露** → 第一天 `.gitignore data/subscriptions.json` + ship `subscriptions.example.json`，此模块**永久本地**。 |
| **规则引擎** | 🟡 **GO_WITH_CAVEATS** | 读+求值路径进 MVP（核心差异点）；**浏览器内写规则 UI defer**。`conditional_show` 需 sync 脚本存 `prev_input_per_m` 做 diff（首次同步为 null 不触发）。 |
| **Coding Tools** | 🟡 **GO_WITH_CAVEATS** | 显示 + 等效换算进 MVP，但**手工 seed，爬虫 defer**。2026 计费分化：Cursor=美元额度池 / Copilot=AI credits / Claude Code=时间窗倍率(无 token 数，显示"保本 $/天") / Codex=公开 credit / **Windsurf→已更名 Devin**。Gemini Code Assist(2026-06-18 停)、Amazon Q(05-15 停新注册) 带 discontinued 徽标不隐藏（可能有遗留访问权）。 |
| **等效换算** | 🟡 **GO_WITH_CAVEATS** | 保留（纯前端、关键卖点）但**明确标为 ESTIMATE**。固定参考模型 + 固定 10K/3K session，渲染时算，带免责声明"按 Sonnet 价估算；unlimited/auto 档不可比"。参考模型/session 放 `rules.json` 可调。 |
| **中转站健康** | 🟡 **Phase 1.5 GO** | **实测纠正 feasibility 误判：AnyRouter 活着**（见 §2.2）。relay-agnostic 起步，MVP 仅占位 widget。 |

### 2.2 中转站端点实测（2026-06-23，关键纠正）

feasibility 研究曾推测 anyrouter.top 域名过期；**实测推翻**：

| 探测 | 结果 | 含义 |
|---|---|---|
| `GET https://anyrouter.top/v1/models` | **HTTP 401** `{"error":{"message":"未提供令牌",…,"type":"new_api_error"}}` | 跑在 **new-api** 栈、网关存活，仅缺 token |
| `GET https://a-ocnfniawgw.cn-shanghai.fcapp.run/v1/models` | **HTTP 401** 同 new-api JSON | 后端服务同样存活 |
| `GET https://anyrouter.top/api/status` | HTTP 200，**返回 SPA HTML**（非 JSON） | ⚠️ 不是健康信号，别用 |

**判存活规则（免 key）**：可达 + 返回 new-api JSON（401 或 200）= 🟢；超时 / 连接错 / 5xx / 空体 = 🔴。
**深度校验**（key 有效 + 模型可用）需用户 `sk-` 令牌，Phase 1.5+ 可选。

### 2.3 Top 风险登记

| # | 风险 | 级别 | 缓解 |
|---|---|---|---|
| 1 | **`file://` fetch 被封**：Chrome/Firefox 把 file:// 当 opaque origin，双击 index.html = 空白页 + CORS 报错 | 🔴 high | `python3 -m http.server 8080` → `http://localhost:8080` 作为**唯一**启动命令（零新增依赖）。不用 `--allow-file-access-from-files`。 |
| 2 | **`subscriptions.json` 财务泄露**：免费 Pages 需公开 repo，发布即被搜索引擎索引 | 🔴 high | 第一天 gitignore + example 占位；此模块永久本地；Actions commit 白名单只含 4 个非个人文件。 |
| 3 | **中转站对象不稳**：公益中转站随时蒸发（今日 AnyRouter 存活） | 🟡 medium | relay-agnostic(`relays.json`) + >2h STALE 守卫防"死 cron 冻结绿灯"，换站只改配置。 |
| 4 | **Coding 爬虫最脆**：JS 渲染 + Cloudflare | 🟡 medium | defer 自动爬，手工 seed + 季度 review；要自动则 Playwright/LLM-reader + 人工确认 PR，绝不自动发布。 |
| 5 | **GitHub Actions cron**：60 天无活动自动禁用 + 定时漂移 10–60min | 🟡 medium | 每日 sync 的 auto-commit 天然续命；显示 last_check + 标"约"；`stale_threshold_minutes` 默认 90 出黄色告警。 |
| 6 | **跨源模型 ID 匹配**：pydantic × litellm 无规范 key | 🟡 medium | pydantic 为权威基底，litellm 仅补"归一 id 不存在"的行，永不覆盖；按 mode∈[chat,completion,reasoning] 过滤。 |

### 2.4 推荐架构

零构建 vanilla-JS + CSS-Grid `index.html` 只读 `data/*.json`，显式解决两处断裂：

- **(A) `file://` 修复**：本地静态服务器打开，永不双击。`python3 -m http.server 8080` 为文档化启动命令（WSL2 同样）。JSON-inline-as-JS 仅作离线 fallback。
- **(B) 写/读分层**：**后端写层**(Python 产 JSON) ↔ **前端读层**(HTML 只读 JSON，永不连中转站/厂商 → 根除 CORS)。Phase1 用 WSL2 Hermes cron 精确定时；Phase2 同一批脚本抬进 Actions（`daily-sync.yml` 02:00 UTC auto-commit + `relay-check.yml` */30，bot git 身份 + keepalive 兜底）。**隐私边界是架构级**：subscriptions.json 永久本地、Actions 白名单 4 文件。

---

## 3. 借鉴 / 可复用 OSS（borrow-vs-build）

**结论：没有任何 OSS 是 4-in-1 完美匹配。** 策略 = vendor 数据 + copy 零依赖组件 + 自建统一壳与规则引擎。

### 3.1 最接近的整体范本
- **`simonw/llm-prices`** ⭐157（MIT 未声明需谨慎）— 单 `index.html` + JSON + serverless + 筛选排序表 + 成本计算器，**正是想要的零构建静态范式**，但只覆盖模块一。→ 作模块一"壳 + 数据分层"范本。
- **`Crashthatch/openroutermodeltable`**（MIT）— 真·零构建单页可排序/逐列筛选表（含 uptime 列）。→ 抄表格骨架 + 逐列筛选 UI。
- **`prehisle/relay-pulse`** ⭐1k（MIT，Go+React 服务端）— 模块三最佳参考（真 token 探测抓 200-但-空、uptime 热图、`/api/status` schema）。→ 只借思路不搬服务端。

### 3.2 逐模块 borrow map

| 模块 | 怎么用 | 来源 |
|---|---|---|
| **官方 API** | **vendor 数据，UI 自建**：价格/cache 以 `pydantic/genai-prices`(MIT) 为权威，`litellm` 补 context_window + vision/function_calling + fallback（都 MIT）；`simonw/llm-prices` 的 current/historical 两文件拆分用于价格变动追踪。 | litellm / genai-prices / llm-prices |
| **Coding 工具** | **纯 reference + 全手工**：无 OSS 价格对比，只从 `slkiser/opencode-quota`(⭐614)+`Dicklesworthstone/caut` 抄工具清单 + 额度字段词汇；`coding-plans.json` 手写，等效换算列自定义数学。 | opencode-quota / caut |
| **中转站** | **抄探测逻辑+UI 概念**：RelayPulse=校验非空响应+热图；`all-api-hub`(AGPL **只看方法别抄码**)=`GET {base}/v1/models`+Bearer，及种子名单(AnyRouter/Sub2API/Veloera/one-hub/done-hub)；`upptime`(MIT)=Actions-cron→commit JSON→静态页读的 serverless 历史。 | relay-pulse / all-api-hub / upptime |
| **订阅** | **抄 localStorage UX + schema**：`ajnart/subs`(MIT，有 localStorage 无服务端模式)=续费倒计时公式 + billing-cycle + 月费汇总(React→vanilla)；`Wallos`(GPL **只参考**)=字段集 + 日历 UX。 | ajnart/subs / Wallos |
| **规则引擎** | **自建 ~50 行求值器**：`json-rules-engine` 抄规则形状 `{conditions:[{field,operator,value}],event}` 但不引依赖，手搓 lt/gt/eq/contains；`sanand0/llmpricing`(MIT)=阈值→红绿高亮先例；`LARIkoz/ai-model-benchmarks` 的 `routing.json`=用途 tag 分类法。 | json-rules-engine / llmpricing / LARIkoz |
| **UI 基建** | **drop-in 零构建**：`tofsjonas/sortable`(公有领域，899 bytes，CDN `class="sortable"`)+ 配套 searchable 给四张表免费排序/筛选；4 模块用 CSS/radio-hack tab 拼。 | tofsjonas/sortable |

### 3.3 必须自建的 gap（无 OSS 覆盖）
模块二 Coding 价格对比（最大空白）｜ 4-in-1 统一壳｜ 个人可配规则引擎(阈值→🟢🔴⚪)｜ 单文件静态中转站存活 UI｜ 单文件 localStorage 订阅追踪器｜ 跨模块价↔token 归一化心智模型。

---

## 4. 已锁定决策（用户 2026-06-23 确认）

1. **MVP 范围** = 官方 API 定价 + 订阅 + 规则引擎 + 手工 seed 的 coding-tools + 中转站占位 widget，一次会话交付。
2. **中转站** = 两个 AnyRouter 端点（`https://anyrouter.top`、`https://a-ocnfniawgw.cn-shanghai.fcapp.run`）**实测均存活** → **不搁置**，作 Phase 1.5，relay-agnostic 起步。
3. **等效换算** = 固定参考模型(Sonnet 4.6 ≈$3in/$15out) + 固定 10K/3K session，标注估算 + 免责声明；参考模型/session 放 `rules.json` 可调；下拉 defer。
4. **部署** = 暂时**本地 only**（`python3 -m http.server 8080`）；Phase 2 GitHub Pages 以后再定。
5. **主题** = 暗色（默认假设，构建时可改）。
6. **订阅数据** = 先建空 scaffold（`data/subscriptions.json` 第一天 gitignore + `subscriptions.example.json` 占位），用户后填真实续费。

---

## 5. 推荐 MVP 范围与分期

**MVP（本地单页 + 两条可靠数据面 + 规则引擎，一次交付）：**
1. **官方 API 定价** — sync 脚本(pydantic 主 + litellm fallback + annotations 叠加 + 自动 tag) + 前端表(多选 tag/厂商筛选、active/deprecated 开关、价格/上下文排序；默认 active-only 价升序)。
2. **订阅续费** — 用户编辑 JSON(第一天 gitignore) + alerts 脚本 + 最近续费倒计时徽标。
3. **规则引擎** — 读+求值，🟢/🔴/⚪ 覆盖官方 API + 订阅，只读 + "改 rules.json" 提示。
4. **Coding 工具** — 手工 seed 8 工具(Gemini/AmazonQ discontinued 徽标、Windsurf→Devin) + 等效换算(标注估算)。
5. **中转站 widget** — 优雅显示"未配置/STALE"(暂无 cron)。

**DEFER 出 MVP**：AnyRouter cron/check 脚本（已实测存活，仅排序靠后，非阻塞）、`scrape-coding-plans.py`、浏览器内规则编辑 UI、session/参考模型下拉、整个 GitHub Pages + Actions。

**分期**：
- **Phase 1（M1，建 MVP）** = 上述 1–5 本地，daily API sync 可选挂 Hermes cron。
- **Phase 1.5（MVP 稳后）** = 激活 relay-agnostic 后端 check 脚本(WSL2 Hermes cron，探 `/v1/models` 取 401-JSON 判存活，免 key)；若用户提供 `sk-` 令牌再加深度校验。
- **Phase 2（Phase 1 稳 + 隐私决策锁定后）** = GitHub Pages(公开 repo，排除 subscriptions.json) + Actions。

---

## 6. 验证方式（实现阶段）

- `python3 scripts/sync-official-api.py` → 断言 `official-api.json` 非空、含 cache 字段、null 安全；前端 `http://localhost:8080` 看表渲染/筛选/排序无报错。
- `gen-subscription-alerts.py` 幂等：跑两次 user 字段不变、仅 alerts/total 更新；确认 `subscriptions.json` 在 `.gitignore`。
- 规则引擎：构造 ignore/threshold/always_show/未知 action 各一条，验证 🟢/🔴/⚪ + 未知不崩。
- 中转站 widget：无 JSON / 过期 JSON → 显示"未配置/STALE"不假绿。
- `file://` 回归：双击应失败、`http.server` 应成功（验证文档正确）。
