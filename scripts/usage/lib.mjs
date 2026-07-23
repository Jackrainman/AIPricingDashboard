// lib.mjs — usage fetcher 共享助手：带超时的 httpJson / AuthError / 凭据文件 / CLI JSON。
// 所有 fetcher 只依赖本文件与 Node 内置模块，保持零依赖。
import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CRED_DIR = path.resolve(__dirname, '..', '..', 'data', 'credentials')

// 凭据失效（HTTP 401/403、CLI 报未登录）时抛这个错误 —— server/usage.mjs 据此把平台
// 标记为 auth_expired 并暂停自动刷新，与普通错误（退避重试）区分开。
export class AuthError extends Error {
  constructor(message, { status = null } = {}) {
    super(message)
    this.name = 'AuthError'
    this.status = status // 触发时的 HTTP 状态码（如有）
  }
}

// GET JSON：带超时；401/403 → AuthError；其他非 2xx → 带状态码的普通 Error。
export async function httpJson(url, { headers = {}, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: ctrl.signal })
    if (res.status === 401 || res.status === 403) {
      throw new AuthError(`HTTP ${res.status}（凭据无效或登录已过期）`, { status: res.status })
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

// 读取大字段凭据文件（cookie_header 型的 cookies/authHeader 会落盘成
// data/credentials/<platformId>/<name>，config.json 里只存引用）。文件不存在返回 null。
export async function readCredentialFile(platformId, name) {
  try {
    return (await readFile(path.join(CRED_DIR, platformId, name), 'utf8')).trim()
  } catch {
    return null
  }
}

// 执行本地 CLI 并解析其 stdout 为 JSON。未登录 → AuthError；命令不存在/超时/输出非法 → 友好 Error。
export function execCliJson(cmd, args = [], timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const detail = (String(stderr).trim() || String(err.message || err)).slice(0, 300)
        if (err.code === 'ENOENT') return reject(new Error(`找不到命令 ${cmd}（未安装或不在 PATH）`))
        if (err.signal === 'SIGTERM') return reject(new Error(`${cmd} 执行超时（${timeoutMs}ms）`))
        if (/not logged in|unauthorized|unauthenticated|login required|未登录|登录已过期/i.test(detail)) {
          return reject(new AuthError(`CLI 未登录：${detail}`))
        }
        return reject(new Error(`${cmd} 执行失败：${detail}`))
      }
      try {
        resolve(JSON.parse(stdout))
      } catch {
        reject(new Error(`${cmd} 输出不是合法 JSON`))
      }
    })
  })
}
