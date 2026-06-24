# AI Pricing Dashboard — 需求文档 (PRD)

> 个人 AI 工具定价看板：一个页面看完 API 价格、Coding Plan、中转站状态、订阅续费，不用来回切换。

**项目状态**：需求确认中  
**创建日期**：2026-06-23  
**作者**：rainman + Hermes Agent  

---

## 1. 背景与动机

### 1.1 痛点
- AI 定价信息分散：官方 API、Coding Plan、中转站各自为政，需要反复切换网页
- 现有聚合站（readaitime.com、sectorhq.co、hvoy.ai）要么太全（信息过载），要么太慢（更新延迟），要么不能横向对比
- Coding Plan 额度策略各异（5h 刷新、周额度、月额度），无法一目了然
- 公益中转站（如 AnyRouter）可用性不稳定，需要手动测试
- 订阅工具多了容易忘记续费/取消试用
- 视频博主做的汇总太慢、太散、不够定制化

### 1.2 核心理念
> **不是"把所有价格铺开让你自己比"，而是"你定规则，系统标红标绿，扫一眼就决策"**

这是一个**个人规则驱动的仪表盘**，不是大而全的聚合平台。

---

## 2. 目标用户

**唯一用户**：rainman（学生，嵌入式方向，使用 AI 辅助编程）

### 2.1 用户约束
- 学生预算有限，对价格敏感
- 没有大量时间维护，需要低维护成本方案
- 已有工具：Cursor Pro、Claude Code、AnyRouter（公益中转站）、可能的其他中转站
- 关注但不常用：MiniMax（除非价格足够低）、火山引擎（阈值明确）

### 2.2 用户判断规则（示例，需用户确认）
| 工具/模型 | 规则 |
|-----------|------|
| MiniMax | 忽略，除非价格 <$0.15/M tokens |
| 火山引擎 | 月费 ≤9.9 元 → 🟢，否则 🔴 |
| AnyRouter | 在线 → 🟢，离线 → 🔴 |
| Cursor Pro | 始终显示（在用） |
| DeepSeek | 始终显示（高性价比） |
| 新模型（未设规则） | ⚪ 灰色，等待用户决定 |

---

## 3. 功能模块

### 3.1 模块一：AnyRouter 健康检查

**目的**：公益中转站可用性实时监控，绿/红灯一目了然。

| 项目 | 说明 |
|------|------|
| **检测方式** | 向 AnyRouter API endpoint 发送轻量请求（如列出模型或简单 completion） |
| **轮询频率** | 每 30 分钟一次（cron job） |
| **状态定义** | 🟢 在线（响应正常）/ 🔴 离线（超时或错误） |
| **数据存储** | `data/anyrouter-status.json` |
| **前端展示** | 状态灯 + 最后检测时间 + 最近 24h 可用率趋势 |
| **告警** | 状态变化时通过 Hermes 通知用户（可选） |

**数据结构**：
```json
{
  "status": "online",
  "last_check": "2026-06-23T14:30:00Z",
  "response_time_ms": 320,
  "endpoint": "https://anyrouter.example.com/v1/models",
  "history_24h": [
    {"time": "2026-06-23T14:00:00Z", "status": "online"},
    {"time": "2026-06-23T13:30:00Z", "status": "offline"}
  ]
}
```

**扩展性**：未来可加入其他中转站的健康检查。

---

### 3.2 模块二：Coding Tools 对比

**目的**：所有 AI 编程工具的定价、额度、性价比，一个表看完。

| 项目 | 说明 |
|------|------|
| **覆盖工具**（初版） | GitHub Copilot、Cursor、Claude Code、Windsurf、OpenAI Codex、JetBrains AI、Gemini Code Assist、Amazon Q Developer |
| **更新方式** | Agent 定期（每月/有新闻时）爬各官网定价页，diff 对比后更新 JSON，人工确认 |
| **数据存储** | `data/coding-plans.json` |

**数据结构**：
```json
{
  "tool": "Cursor",
  "url": "https://cursor.com/pricing",
  "last_updated": "2026-06-23",
  "plans": [
    {
      "name": "Pro",
      "price_monthly_usd": 20,
      "billing_model": "credit_pool",
      "credit_system": {
        "total_monthly": 500,
        "auto_mode_unlimited": true,
        "premium_model_cost_multiplier": 1
      },
      "refresh_cycle": "monthly",
      "models_included": ["claude-sonnet-4.5", "gpt-4o", "gemini-2.5-pro"],
      "notes": "Auto mode 不消耗额度"
    },
    {
      "name": "Pro+",
      "price_monthly_usd": 60,
      "credit_system": {
        "total_monthly": 1500
      }
    },
    {
      "name": "Business",
      "price_monthly_usd": 40,
      "per_user": true,
      "credit_system": {
        "total_monthly": 1000
      }
    }
  ],
  "my_status": {
    "current_plan": "Pro",
    "renewal_date": "2026-07-15",
    "auto_renew": true
  }
}
```

**等效换算逻辑**：
- **等效 token**：`plan_price / model_input_price = 等效百万输入token`
- **等效访问次数**：`plan_price / (avg_input_tokens * input_price + avg_output_tokens * output_price)`
- 默认假设：一次 coding session ≈ 10K input + 3K output tokens（用户可调）

---

### 3.3 模块三：官方 API 原价对比

**目的**：各厂商 API 的官方定价矩阵，按用途筛选。

| 项目 | 说明 |
|------|------|
| **数据源** | 开源 JSON（优先级：pydantic/genai-prices → TechyNilesh/LLMPrice → BenchGecko/llm-pricing） |
| **更新方式** | GitHub Actions 每日自动同步 |
| **数据存储** | `data/official-api.json` |
| **筛选维度** | 厂商、用途标签、价格区间、上下文窗口 |

**数据结构**：
```json
{
  "model": "Claude Sonnet 4.6",
  "vendor": "Anthropic",
  "input_price_per_m": 3.00,
  "output_price_per_m": 15.00,
  "cache_read_per_m": 0.30,
  "cache_write_per_m": 3.75,
  "context_window": 1000000,
  "max_output": 128000,
  "tags": ["general", "coding-capable", "tool-calling", "vision"],
  "release_date": "2026-02",
  "status": "active",
  "deprecated": false
}
```

**用途标签体系**（人工标注 + agent 辅助）：

| 标签 | 含义 | 判定方式 |
|------|------|---------|
| `coding-optimized` | 厂商明确为编程优化（如 Codex、Grok Build） | 人工标注 |
| `coding-capable` | 通用模型但被广泛用于编程（如 Sonnet） | 人工标注 |
| `agent-bulk` | 便宜+大上下文+高吞吐，适合 Agent 跑量 | 规则：input <$0.5/M 且 context ≥128K |
| `reasoning` | 高价旗舰推理模型（Opus/GPT-5.5 Pro 级） | 规则：input ≥$5/M |
| `general` | 通用模型 | 默认 |
| `vision` | 支持图片输入 | 从元数据读取 |
| `tool-calling` | 支持函数调用 | 从元数据读取 |

**⚠️ 重要**：标签不依赖模型名中的 "code" 字样。27B 小模型带 "code" 是自部署用的，不是厂商 API。

---

### 3.4 模块四：订阅续费提醒

**目的**：所有订阅工具的到期日和续费状态，防止意外扣费。

| 项目 | 说明 |
|------|------|
| **数据存储** | `data/subscriptions.json` |
| **维护方式** | 用户手动录入（一次性），系统自动计算倒计时 |
| **展示** | 到期倒计时、自动续费状态、月费汇总 |

**数据结构**：
```json
{
  "subscriptions": [
    {
      "tool": "Cursor Pro",
      "price_monthly_usd": 20,
      "renewal_date": "2026-07-15",
      "auto_renew": true,
      "payment_method": "credit_card",
      "cancel_url": "https://cursor.com/settings/billing",
      "notes": ""
    },
    {
      "tool": "GitHub Copilot",
      "price_monthly_usd": 10,
      "renewal_date": "2026-08-01",
      "auto_renew": true,
      "cancel_url": "https://github.com/settings/billing"
    }
  ],
  "total_monthly_usd": 30,
  "alerts": [
    {
      "tool": "Cursor Pro",
      "type": "renewal_soon",
      "message": "Cursor Pro 将在 22 天后续费 $20",
      "days_until": 22
    }
  ]
}
```

---

## 4. 规则引擎

### 4.1 设计原则
- 用户定义阈值，系统自动评估
- 三种状态：🟢（达标/可用）、🔴（不达标/不可用）、⚪（未设规则）
- 新模型/新工具默认 ⚪，用户决定是否关注

### 4.2 规则类型

| 规则类型 | 示例 |
|----------|------|
| `ignore` | MiniMax → 忽略（除非满足条件） |
| `price_threshold` | 火山引擎 → 月费 ≤9.9 时 🟢 |
| `health_check` | AnyRouter → 在线 🟢 / 离线 🔴 |
| `always_show` | Cursor Pro → 始终显示（在用） |
| `conditional_show` | DeepSeek → 价格变动超过 10% 时高亮 |

### 4.3 规则存储

`data/rules.json`：
```json
{
  "models": {
    "minimax": {
      "action": "ignore",
      "unless": {"input_price_per_m_below": 0.15}
    },
    "deepseek": {
      "action": "always_show",
      "highlight_price_change_pct": 10
    },
    "claude-sonnet-4.6": {
      "action": "always_show"
    }
  },
  "coding_tools": {
    "cursor": {"action": "always_show", "current_plan": "Pro"},
    "copilot": {"action": "show_if_below", "max_price_monthly": 15},
    "codex": {"action": "always_show"}
  },
  "relays": {
    "火山引擎": {
      "action": "alert",
      "threshold_monthly_cny": 9.9
    }
  },
  "defaults": {
    "new_model_action": "show_gray",
    "new_tool_action": "show_gray"
  }
}
```

---

## 5. 技术架构

### 5.1 阶段一：本地 MVP

```
AIPricingDashboard/
├── index.html              ← 单文件看板（HTML + CSS + JS，零依赖）
├── data/
│   ├── official-api.json   ← 官方 API 定价（自动同步）
│   ├── coding-plans.json   ← Coding Tools 定价（agent 爬取 + 人工确认）
│   ├── subscriptions.json  ← 个人订阅信息（手动录入）
│   ├── rules.json          ← 用户规则
│   └── anyrouter-status.json ← AnyRouter 健康状态
├── scripts/
│   ├── sync-official-api.py    ← 从开源 JSON 同步官方数据
│   ├── check-anyrouter.py      ← AnyRouter 健康检查
│   ├── scrape-coding-plans.py  ← 爬取 Coding Tools 定价页
│   └── gen-subscription-alerts.py ← 计算续费提醒
├── docs/
│   └── PRD.md              ← 本文件
├── .gitignore
└── README.md
```

**技术选型**：
- 前端：单个 HTML 文件，使用 vanilla JS + CSS Grid（零构建步骤，浏览器直接打开）
- 数据：JSON 文件（git 版本控制，可回溯价格变动）
- 脚本：Python 3.11（已有环境）
- 更新：Hermes cron job 触发脚本

### 5.2 阶段二：云端部署

```
同一份代码 → GitHub repo → GitHub Pages 部署
                      ↓
              GitHub Actions 定时更新数据
                      ↓
              自定义域名（可选）
```

**迁移成本**：几乎为零。HTML + JSON 天然兼容静态托管。

**自动化**：
- `sync-official-api.py` → GitHub Actions 每日执行，commit 更新的 JSON
- `check-anyrouter.py` → GitHub Actions 每 30 分钟执行
- `scrape-coding-plans.py` → GitHub Actions 每周执行，创建 PR 等待确认

### 5.3 阶段三：社区版（远期，暂不规划）
- 多用户规则引擎
- 中转站价格聚合（爬 hvoy.ai 等对比站）
- 社区贡献数据

---

## 6. 前端设计

### 6.1 布局

```
┌──────────────────────────────────────────────────────┐
│  AI Pricing Dashboard                     [设置] [刷新] │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌─ 快速状态栏 ─────────────────────────────────────┐ │
│  │ AnyRouter: 🟢  Cursor: 🟢  Copilot: 🟢          │ │
│  │ 月费总计: $30  下次续费: Cursor (22天后)          │ │
│  └──────────────────────────────────────────────────┘ │
│                                                      │
│  ┌─ 标签页 ─────────────────────────────────────────┐ │
│  │ [Coding Tools] [API 定价] [中转站] [我的订阅]     │ │
│  ├──────────────────────────────────────────────────┤ │
│  │                                                  │ │
│  │  (各标签页内容)                                    │ │
│  │                                                  │ │
│  └──────────────────────────────────────────────────┘ │
│                                                      │
│  ┌─ 筛选栏 ─────────────────────────────────────────┐ │
│  │ 用途: [coding] [agent-bulk] [reasoning] [全部]    │ │
│  │ 厂商: [OpenAI] [Anthropic] [Google] [全部]        │ │
│  │ 状态: [🟢 only] [include ⚪] [全部]               │ │
│  │ 排序: [价格↑] [性价比] [上下文窗口]               │ │
│  └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### 6.2 交互
- 点击筛选标签即时过滤（无需刷新）
- 鼠标悬停显示详细信息（缓存价、等效 token 等）
- 规则编辑：点击工具/模型旁的 ⚙️ 图标弹出规则设置
- 数据最后更新时间显示在页脚

---

## 7. 数据流

```
┌─────────────┐    每日     ┌──────────────┐
│ genai-prices │ ─────────→ │ official.json │
│ (GitHub)     │  Actions   └──────┬───────┘
└─────────────┘                    │
                                   ↓
┌─────────────┐  每月/按需  ┌──────────────┐     ┌─────────┐
│ 官网定价页   │ ─────────→ │ coding.json  │ ──→ │ index   │
│ (Cursor等)   │  Agent爬取  └──────┬───────┘     │ .html   │
└─────────────┘                    │              └────┬────┘
                                   ↓                   │
┌─────────────┐  每30min    ┌──────────────┐           │
│ AnyRouter    │ ─────────→ │ status.json  │ ──────────┘
│ API          │  cron       └──────────────┘
└─────────────┘

用户手动 → rules.json ──────────────────────→ 红绿灯渲染
用户手动 → subscriptions.json ──────────────→ 续费倒计时
```

---

## 8. 开放问题（需用户确认）

### 8.1 紧急（开工前必须确认）
- [ ] **AnyRouter 的 API endpoint** 是什么？（用于健康检查）
- [ ] **你常用的中转站列表**（目前只知道 AnyRouter，其他 2-4 家？）
- [ ] **你当前的订阅列表**（工具名 + 月费 + 到期日）

### 8.2 重要（MVP 阶段需确认）
- [ ] **Coding session 平均 token 消耗**（默认 10K input + 3K output，是否合理？）
- [ ] **规则引擎的默认行为**：新模型默认显示还是隐藏？
- [ ] **前端偏好**：暗色主题还是亮色？（猜你是暗色）

### 8.3 可以后期决定
- [ ] 是否需要多中转站健康检查？
- [ ] 是否需要价格变动历史图表？
- [ ] 部署到 GitHub Pages 时是否需要自定义域名？

---

## 9. 里程碑

| 阶段 | 内容 | 预计时间 |
|------|------|---------|
| **M0** | 需求文档定稿 + 数据结构确认 | 考试前（现在） |
| **M1** | 搭建项目骨架 + 同步官方 API 数据 | 考后第 1 天 |
| **M2** | Coding Tools 模块 + 等效换算 | 考后第 2-3 天 |
| **M3** | AnyRouter 健康检查 + cron 自动化 | M2 后 1 天 |
| **M4** | 订阅续费模块 + 规则引擎 | M3 后 1 天 |
| **M5** | 前端整合 + 筛选/排序 | M4 后 1 天 |
| **M6** | 测试 + 上线 GitHub Pages | M5 后 1 天 |

---

## 10. 参考资源

### 开源数据源
- [pydantic/genai-prices](https://github.com/pydantic/genai-prices) — ⭐309，活跃维护
- [TechyNilesh/LLMPrice](https://github.com/TechyNilesh/LLMPrice) — 2500+ 模型，每日同步
- [BenchGecko/llm-pricing](https://github.com/BenchGecko/llm-pricing) — 300+ 模型，每周更新
- [LiteLLM pricing JSON](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json) — 行业标准参考

### 现有聚合站（参考，不依赖）
- [readaitime.com/llm](https://www.readaitime.com/llm) — 中文，314 模型，每日更新
- [sectorhq.co/llm-pricing](https://www.sectorhq.co/llm-pricing) — 英文，1086 模型，6h 更新
- [devtk.ai](https://devtk.ai/zh/blog/ai-api-pricing-comparison-2026/) — 中文，按用途分档
- [hvoy.ai](https://hvoy.ai/) — 中转站对比
- [getdx.com](https://getdx.com/blog/ai-coding-assistant-pricing/) — Coding Tools 深度对比

---

*本文档随项目迭代持续更新。*
