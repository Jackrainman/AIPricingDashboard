// usage.mjs — 可插拔的平台用量追踪管理模块。
//
// 平台 = scripts/usage/fetchers/ 下的一个 .mjs 文件（_ 开头为模板，跳过），启动时扫描动态 import。
// 添加新平台 = 往 fetchers/ 丢一个文件 + 前端启用，本文件零改动（见 scripts/usage/README.md）。
//
// 每平台状态机（掉登录缓解）：
//   ok ──失败──▶ stale（有旧数据）/ error（从未成功）──指数退避重试──▶ ok
//   任意状态 ──AuthError──▶ auth_expired（暂停自动刷新，保留旧数据，等用户更新凭据）
//   auth_expired ──enablePlatform / 手动 refresh──▶ 尝试一次，成功回 ok，仍 401 回 auth_expired
import { readdir, readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const FETCHERS_DIR = path.join(ROOT, 'scripts', 'usage', 'fetchers')
const CRED_DIR = path.join(ROOT, 'data', 'credentials')
const CRED_FILE = path.join(CRED_DIR, 'config.json')

const MAX_BACKOFF_SEC = 1800 // 退避封顶 30 分钟
const JITTER = 0.1 // 刷新间隔 ±10% 抖动，避免多平台同时打请求
// 这些 key（或任何超长字符串）的值不落 config.json，写文件到 data/credentials/<id>/，json 里只留引用
const FILE_FIELD_KEYS = new Set(['cookies', 'cookie', 'authHeader', 'cookieHeader'])
const FILE_FIELD_MIN_LEN = 500

const registry = new Map() // id → { meta, fetch }
const states = new Map()   // id → { enabled, status, metrics, lastSuccessAt, lastError, failCount, nextRefreshAt, timer, refreshing }
let creds = { enabled: {} } // 持久化结构：{ enabled: { id: { key: value | { __file__ } } } }

const isAuthError = (e) => e && e.name === 'AuthError'

function st(id) {
  if (!states.has(id)) {
    states.set(id, {
      enabled: false, status: 'disabled', metrics: [], lastSuccessAt: null,
      lastError: null, failCount: 0, nextRefreshAt: null, timer: null, refreshing: false,
    })
  }
  return states.get(id)
}

// ---------- fetcher 自动发现 ----------
async function discoverFetchers() {
  let files = []
  try { files = await readdir(FETCHERS_DIR) } catch { return }
  for (const f of files.sort()) {
    if (!f.endsWith('.mjs') || f.startsWith('_')) continue // _ 开头 = 模板，不注册
    try {
      const mod = await import(pathToFileURL(path.join(FETCHERS_DIR, f)).href)
      if (!mod.meta?.id || typeof mod.fetch !== 'function') {
        console.warn(`[usage] ${f}: 缺少 meta.id 或 fetch()，跳过`)
        continue
      }
      registry.set(mod.meta.id, { meta: mod.meta, fetch: mod.fetch })
      st(mod.meta.id)
    } catch (e) {
      console.error(`[usage] 加载 fetcher ${f} 失败: ${e.message}`)
    }
  }
}

// ---------- 凭据存取（config.json + 大字段落盘文件） ----------
async function loadCreds() {
  try {
    const json = JSON.parse(await readFile(CRED_FILE, 'utf8'))
    creds = json && typeof json === 'object' && json.enabled && typeof json.enabled === 'object'
      ? json : { enabled: {} }
  } catch {
    creds = { enabled: {} }
  }
}

async function saveCreds() {
  await mkdir(CRED_DIR, { recursive: true })
  const tmp = CRED_FILE + '.tmp'
  await writeFile(tmp, JSON.stringify(creds, null, 2))
  await rename(tmp, CRED_FILE) // 与 store.mjs 一致的原子写
}

// 还原某平台的完整配置（把 { __file__ } 引用读回真实值），供 fetcher 使用
async function resolveConfig(id) {
  const raw = creds.enabled[id]
  if (!raw) return null
  const cfg = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v && typeof v === 'object' && v.__file__) {
      try { cfg[k] = (await readFile(path.join(CRED_DIR, id, v.__file__), 'utf8')).trim() }
      catch { cfg[k] = null }
    } else {
      cfg[k] = v
    }
  }
  return cfg
}

// 保存配置：大字段写文件，其余内联进 config.json
async function persistConfig(id, config) {
  const raw = {}
  for (const [k, v] of Object.entries(config)) {
    if (typeof v === 'string' && (FILE_FIELD_KEYS.has(k) || v.length > FILE_FIELD_MIN_LEN)) {
      const dir = path.join(CRED_DIR, id)
      await mkdir(dir, { recursive: true })
      const fname = `${k}.txt`
      await writeFile(path.join(dir, fname), v)
      raw[k] = { __file__: fname }
    } else {
      raw[k] = v
    }
  }
  creds.enabled[id] = raw
  await saveCreds()
}

// ---------- 调度：每平台独立 setTimeout 链 + 抖动 + 指数退避 ----------
function clearTimer(s) {
  if (s.timer) { clearTimeout(s.timer); s.timer = null }
}

function schedule(id) {
  const s = st(id)
  clearTimer(s)
  // auth_expired / disabled：不排程，等用户动作（更新凭据 / 手动刷新）唤醒
  if (!s.enabled || s.status === 'auth_expired') { s.nextRefreshAt = null; return }
  const base = registry.get(id)?.meta.refreshIntervalSec || 120
  const delaySec = Math.min(base * 2 ** s.failCount, MAX_BACKOFF_SEC) // 1x→2x→4x… 封顶 30 分钟
  const ms = delaySec * (1 + (Math.random() * 2 - 1) * JITTER) * 1000
  s.nextRefreshAt = new Date(Date.now() + ms).toISOString()
  s.timer = setTimeout(() => { refreshPlatform(id).catch(() => {}) }, ms)
  s.timer.unref?.() // 进程退出不留句柄
}

// 单平台刷新。失败绝不影响其他平台；旧数据永不清空。
async function refreshPlatform(id, { manual = false } = {}) {
  const entry = registry.get(id)
  const s = st(id)
  if (!entry || !s.enabled || s.refreshing) return
  if (s.status === 'auth_expired' && !manual) return // 自动刷新对掉登录平台保持暂停
  s.refreshing = true
  try {
    const config = (await resolveConfig(id)) || {}
    const metrics = await entry.fetch(config)
    s.metrics = Array.isArray(metrics) ? metrics : []
    s.lastSuccessAt = new Date().toISOString()
    s.lastError = null
    s.failCount = 0
    s.status = 'ok'
  } catch (e) {
    if (isAuthError(e)) {
      s.status = 'auth_expired' // 保留旧 metrics；schedule() 会停掉自动刷新
      s.lastError = String(e.message || e)
    } else {
      s.failCount += 1
      s.status = s.metrics.length ? 'stale' : 'error'
      s.lastError = String(e?.message || e)
    }
  } finally {
    s.refreshing = false
    schedule(id)
  }
}

function snapshotPlatform(id) {
  const entry = registry.get(id)
  const s = st(id)
  return {
    id,
    displayName: entry?.meta.displayName || id,
    status: s.status,
    stale: s.status === 'stale',
    lastSuccessAt: s.lastSuccessAt,
    metrics: s.metrics,
    ...(s.lastError ? { error: s.lastError } : {}),
  }
}

// ---------- 对外 API ----------
// 纯内存缓存，不触发任何网络请求
export function getUsage() {
  const platforms = [...registry.keys()].filter((id) => st(id).enabled).map(snapshotPlatform)
  return { platforms, generated_at: new Date().toISOString() }
}

// 手动强制刷新：auth_expired 平台也尝试一次（给用户验证新凭据的手段；仍 401 则回到 auth_expired）
export async function refreshUsage() {
  const ids = [...registry.keys()].filter((id) => st(id).enabled)
  await Promise.allSettled(ids.map((id) => refreshPlatform(id, { manual: true })))
  return getUsage()
}

// 平台健康状态。secret 字段只返回 configured 布尔，绝不回传真实值。
export function getPlatforms() {
  return [...registry.values()].map(({ meta }) => {
    const s = st(meta.id)
    const raw = creds.enabled[meta.id] || {}
    const configFields = (meta.configFields || []).map((f) => {
      const v = raw[f.key]
      const configured = v != null && v !== ''
      return {
        key: f.key,
        label: f.label || f.key,
        secret: !!f.secret,
        help: f.help || '',
        optional: !!f.optional,
        configured,
        ...(f.secret ? {} : { value: configured && typeof v !== 'object' ? v : '' }),
      }
    })
    const ready = s.enabled && configFields.every((f) => f.optional || f.configured)
    return {
      id: meta.id,
      displayName: meta.displayName,
      authType: meta.authType,
      description: meta.description || '',
      refreshIntervalSec: meta.refreshIntervalSec || 120,
      configFields,
      enabled: s.enabled,
      ready,
      status: s.enabled ? s.status : 'disabled',
      lastSuccessAt: s.lastSuccessAt,
      lastError: s.lastError,
      nextRefreshAt: s.nextRefreshAt,
    }
  })
}

// 启用 / 更新凭据（幂等覆盖）。空字符串 = "保持已存值"（secret 字段从不回显，用户只贴要改的）。
// 保存后立即手动刷新一次验证新凭据。
export async function enablePlatform(id, config) {
  const entry = registry.get(id)
  if (!entry) { const e = new Error(`未知平台: ${id}`); e.code = 'UNKNOWN_PLATFORM'; throw e }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    const e = new Error('请求体必须是 config 对象'); e.code = 'BAD_CONFIG'; throw e
  }
  const existing = (await resolveConfig(id)) || {}
  const merged = { ...existing }
  for (const [k, v] of Object.entries(config)) {
    if (typeof v === 'string' && v.trim() === '') continue
    merged[k] = v
  }
  const missing = (entry.meta.configFields || [])
    .filter((f) => !f.optional && (merged[f.key] == null || merged[f.key] === ''))
    .map((f) => f.label || f.key)
  if (missing.length) { const e = new Error(`缺少必填配置: ${missing.join(', ')}`); e.code = 'BAD_CONFIG'; throw e }

  await persistConfig(id, merged)
  const s = st(id)
  s.enabled = true
  s.failCount = 0
  s.lastError = null
  s.status = s.metrics.length ? 'stale' : 'error'
  await refreshPlatform(id, { manual: true }) // 立即验证凭据；manual 绕过 auth_expired 暂停
  return getPlatforms().find((p) => p.id === id)
}

// 禁用：停调度、删凭据（含大字段文件）。重新启用需重新填凭据。
export async function disablePlatform(id) {
  const s = st(id)
  s.enabled = false
  s.status = 'disabled'
  s.nextRefreshAt = null
  clearTimer(s)
  delete creds.enabled[id]
  await saveCreds()
  await rm(path.join(CRED_DIR, id), { recursive: true, force: true })
  return { ok: true }
}

// 服务启动时调用：发现 fetcher → 加载凭据 → 启用平台错开首刷（避免启动瞬间并发打满）
export async function initUsage() {
  await discoverFetchers()
  await loadCreds()
  let enabledCount = 0
  for (const id of Object.keys(creds.enabled)) {
    if (!registry.has(id)) {
      console.warn(`[usage] 配置中的平台 ${id} 没有对应 fetcher 文件，忽略`)
      continue
    }
    const s = st(id)
    s.enabled = true
    s.status = 'error' // 尚无数据；lastError 为空时前端显示"等待刷新"
    enabledCount++
  }
  let i = 0
  for (const id of registry.keys()) {
    const s = st(id)
    if (!s.enabled) continue
    const ms = 1500 + i * 2000
    s.nextRefreshAt = new Date(Date.now() + ms).toISOString()
    s.timer = setTimeout(() => { refreshPlatform(id).catch(() => {}) }, ms)
    s.timer.unref?.()
    i++
  }
  console.log(`[usage] 注册 ${registry.size} 个平台 fetcher，启用 ${enabledCount} 个`)
}
