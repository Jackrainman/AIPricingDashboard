# 用量追踪（usage）— 如何添加新平台

每个平台 = `fetchers/` 目录下的一个 `.mjs` 文件。服务启动时自动扫描注册，
**无需改动 server / 前端的任何核心代码**。`_` 开头的文件是模板，不会被注册。

## 三步添加

1. 复制模板：`fetchers/_example-cookie.mjs`（Cookie 型）或 `_example-cli.mjs`（本机 CLI 型），
   或参考完整实现 `fetchers/openrouter.mjs`（API Key 型）。
2. 去掉文件名开头的 `_` 并改名（如 `myplatform.mjs`），修改 `meta` 和 `fetch()`。
3. 重启服务，在前端「用量」页找到该平台卡片，点「启用」粘贴凭据即可。

## fetcher 文件契约

```js
export const meta = {
  id: 'myplatform',            // 全局唯一
  displayName: '我的平台',
  authType: 'api_key',         // api_key | cookie_header | local_cli | local_file
  refreshIntervalSec: 120,     // 建议 60-120
  description: '一句话说明',
  configFields: [              // 前端按此动态渲染启用/更新凭据表单
    { key: 'apiKey', label: 'API Key', secret: true, help: '在哪里获取' },
  ],
}

export async function fetch(config) {
  // config = 用户已保存的配置（secret 字段在这里是真实值，绝不回传前端）
  return [/* Metric... */]
}
```

Metric：`{ platform, displayName, label, used, total: number|null, unit: "%"|"$"|"次"|"token", resetTime: ISO|null, subtitle: string|null }`
（`total: null` 表示无上限，前端只显示数值不显示进度条。）

## 共享助手（`../lib.mjs`）

- `httpJson(url, { headers, timeoutMs })`：带超时；**401/403 自动抛 `AuthError`**，其他非 2xx 抛带状态码的错误。
- `AuthError`：凭据失效时抛出（或让 httpJson 替你抛）。后端据此把平台标记为 `auth_expired`，
  暂停自动刷新并在前端显示「登录已过期，请更新凭据」徽标。
- `readCredentialFile(platformId, name)`：读 `data/credentials/<platformId>/<name>` 大字段凭据。
- `execCliJson(cmd, args, timeoutMs)`：执行本机 CLI 并解析 JSON；未登录自动转 `AuthError`。

## 凭据与安全

- 凭据保存在 `data/credentials/`（已 gitignore，绝不入库）：小字段内联在 `config.json`，
  `cookies`/`authHeader` 等大字段自动落盘为 `<id>/<key>.txt`，`config.json` 只存引用。
- 掉登录不用编辑文件：前端卡片上「更新凭据」重新粘贴即可（幂等覆盖，保存后立即验证一次）。
- 单个 fetcher 可独立测试：`node scripts/usage/fetchers/openrouter.mjs <api_key>`。
