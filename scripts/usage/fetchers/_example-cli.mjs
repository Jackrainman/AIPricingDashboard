// _example-cli.mjs — 模板：local_cli 型平台（读本机已登录 CLI 的用量输出，无需在面板里存凭据）。
//
// 以 _ 开头的文件不会被注册。复制此文件、去掉下划线改名（如 mycli.mjs），
// 修改 meta 与 fetch() 即添加了一个新平台 —— server / 前端核心代码零改动。
import { pathToFileURL } from 'node:url'
import { execCliJson } from '../lib.mjs'

export const meta = {
  id: 'example-cli', // 改成你的平台 id
  displayName: '示例 · CLI 平台',
  authType: 'local_cli',
  refreshIntervalSec: 120,
  description: '演示：调用本机 CLI（假定已在终端登录），解析其 JSON 输出。CLI 报未登录时自动转为"登录已过期"状态。',
  configFields: [
    // local_cli 平台通常不需要凭据；这里演示一个非 secret 的可选参数
    { key: 'profile', label: 'CLI profile 名', secret: false, optional: true, help: '留空用默认 profile' },
  ],
}

export async function fetch(config) {
  // 换成目标 CLI 真实的命令与参数；要求它能输出 JSON 到 stdout。
  // execCliJson：命令不存在/超时/输出非 JSON → 友好 Error；输出含"未登录"类字样 → AuthError。
  const args = ['usage', '--json']
  if (config?.profile) args.push('--profile', config.profile)
  const json = await execCliJson('example-cli', args)
  return [{
    platform: meta.id,
    displayName: meta.displayName,
    label: '本周 token 用量',
    used: Number(json.used_tokens) || 0,
    total: Number.isFinite(Number(json.quota_tokens)) ? Number(json.quota_tokens) : null,
    unit: 'token', // "%" | "$" | "次" | "token"
    resetTime: json.week_reset_at || null,
    subtitle: null,
  }]
}

// 直接运行测试: node scripts/usage/fetchers/_example-cli.mjs [profile]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetch({ profile: process.argv[2] || '' })
    .then((metrics) => console.log(JSON.stringify(metrics, null, 2)))
    .catch((e) => { console.error(`[${e.name}] ${e.message}`); process.exit(1) })
}
