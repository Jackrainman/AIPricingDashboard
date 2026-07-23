#!/usr/bin/env node
// openrouter.mjs — OpenRouter 余额查询（api_key 型参考实现，开箱可用）。
// 添加新平台？复制本文件改名，改 meta + fetch() 即可，核心代码零改动（_ 开头的文件不会被注册）。
// 单独测试: node scripts/usage/fetchers/openrouter.mjs <api_key>
import { pathToFileURL } from 'node:url'
import { httpJson } from '../lib.mjs'

export const meta = {
  id: 'openrouter', // 全局唯一；配置、状态、API 路径都以此为准
  displayName: 'OpenRouter',
  authType: 'api_key', // "api_key" | "cookie_header" | "local_cli" | "local_file"
  refreshIntervalSec: 120, // 建议 60-120；失败时后端会在此基础上指数退避
  description: '聚合 API 平台：充值总额 / 累计用量 / 剩余额度',
  configFields: [ // 前端按此动态渲染启用/更新凭据表单
    { key: 'apiKey', label: 'API Key', secret: true, help: '在 https://openrouter.ai/keys 创建，形如 sk-or-v1-…' },
  ],
}

// fetch(config) → Metric[]
// Metric = { platform, displayName, label, used, total: number|null, unit: "%"|"$"|"次"|"token",
//            resetTime: ISO|null, subtitle: string|null }
export async function fetch(config) {
  if (!config?.apiKey) throw new Error('未配置 apiKey')
  const json = await httpJson('https://openrouter.ai/api/v1/credits', {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  })
  const total = Number(json?.data?.total_credits)
  const used = Number(json?.data?.total_usage)
  if (!Number.isFinite(total) || !Number.isFinite(used)) throw new Error('credits 响应格式异常')
  return [{
    platform: meta.id,
    displayName: meta.displayName,
    label: '额度用量',
    used: Math.round(used * 100) / 100,
    total: total > 0 ? Math.round(total * 100) / 100 : null, // total=null → 前端只显示数值不显示进度条
    unit: '$',
    resetTime: null, // 余额型额度，无周期重置
    subtitle: `剩余 $${(total - used).toFixed(2)}`,
  }]
}

// 直接运行时打印结果（不影响被 server 动态 import）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apiKey = process.argv[2]
  if (!apiKey) { console.error('用法: node scripts/usage/fetchers/openrouter.mjs <api_key>'); process.exit(1) }
  fetch({ apiKey })
    .then((metrics) => console.log(JSON.stringify(metrics, null, 2)))
    .catch((e) => { console.error(`[${e.name}] ${e.message}`); process.exit(1) })
}
