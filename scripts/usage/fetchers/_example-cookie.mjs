// _example-cookie.mjs — 模板：cookie_header 型平台（抓包浏览器 Cookie / Authorization 头）。
//
// 以 _ 开头的文件不会被注册。复制此文件、去掉下划线改名（如 myplatform.mjs），
// 修改 meta 与 fetch() 即添加了一个新平台 —— server / 前端核心代码零改动。
import { pathToFileURL } from 'node:url'
import { httpJson } from '../lib.mjs'

export const meta = {
  id: 'example-cookie', // 改成你的平台 id（英文小写 + 连字符）
  displayName: '示例 · Cookie 平台',
  authType: 'cookie_header',
  refreshIntervalSec: 120,
  description: '演示：整段 Cookie 作为凭据。cookies/authHeader 这类大字段后端会自动落盘成 data/credentials/<id>/cookies.txt，config.json 里只留引用。',
  configFields: [
    { key: 'cookies', label: 'Cookie 整段', secret: true, help: '浏览器 F12 → Network → 任一已登录请求 → 复制请求头 Cookie' },
    // 也可以再加非 secret 字段，例如：
    // { key: 'orgId', label: '组织 ID', secret: false, help: '可选', optional: true },
  ],
}

export async function fetch(config) {
  if (!config?.cookies) throw new Error('未配置 cookies')
  // 换成目标平台真实的用量接口。httpJson 在 401/403 时自动抛 AuthError，
  // 后端会把平台标记为 auth_expired（前端显示"登录已过期"徽标并暂停自动刷新）。
  const json = await httpJson('https://example.com/api/usage', {
    headers: { Cookie: config.cookies },
  })
  return [{
    platform: meta.id,
    displayName: meta.displayName,
    label: '本月额度',
    used: Number(json.used) || 0,
    total: Number.isFinite(Number(json.total)) ? Number(json.total) : null, // null = 无上限，只显示数值
    unit: '%', // "%" | "$" | "次" | "token"
    resetTime: json.reset_at || null, // ISO 时间；前端显示相对倒计时
    subtitle: json.plan ? `套餐：${json.plan}` : null,
  }]
}

// 直接运行测试: node scripts/usage/fetchers/_example-cookie.mjs "<cookie 整段>"
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cookies = process.argv[2]
  if (!cookies) { console.error('用法: node _example-cookie.mjs "<cookies>"'); process.exit(1) }
  fetch({ cookies })
    .then((metrics) => console.log(JSON.stringify(metrics, null, 2)))
    .catch((e) => { console.error(`[${e.name}] ${e.message}`); process.exit(1) })
}
