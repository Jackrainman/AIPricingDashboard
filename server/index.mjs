// index.mjs — zero-dependency Node backend for AI Pricing Dashboard.
// Real API (read + write) + static frontend. Run: node server/index.mjs  (PORT env, default 4178)
import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { read, write, PUBLIC, ROOT } from './store.mjs'
import { evalModel, evalCodingTool, evalRelay } from './rules.mjs'
import { recommendations } from './recommend.mjs'
import { calculate } from './calculator.mjs'
import { initUsage, getUsage, refreshUsage, getPlatforms, enablePlatform, disablePlatform } from './usage.mjs'

const PORT = Number(process.env.PORT) || 4178
// local-only by default; opt into LAN/Tailscale exposure explicitly with HOST=0.0.0.0
// (write + script-trigger endpoints are unauthenticated, so don't expose by accident)
const HOST = process.env.HOST || '127.0.0.1'

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
}

function send(res, code, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...headers })
  res.end(data)
}
function sendJson(res, obj, code = 200) { send(res, code, obj) }

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  if (!chunks.length) return {} // genuinely no body
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { return null } // parse failure is distinct from {}
}

// ---- subscription alerts (idempotent: never mutates user fields) ----
function withSubAlerts(subs) {
  const now = Date.now()
  const list = Array.isArray(subs.subscriptions) ? subs.subscriptions : []
  let total = 0
  const alerts = []
  for (const s of list) {
    if (typeof s.price_monthly_usd === 'number') total += s.price_monthly_usd
    if (s.renewal_date) {
      const d = Date.parse(s.renewal_date)
      if (!Number.isNaN(d)) {
        const days = Math.ceil((d - now) / 86400000)
        if (days <= 30) {
          alerts.push({
            tool: s.tool,
            type: days < 0 ? 'overdue' : 'renewal_soon',
            days_until: days,
            price_monthly_usd: s.price_monthly_usd ?? null,
            auto_renew: !!s.auto_renew,
            cancel_url: s.cancel_url || null,
            message: days < 0
              ? `${s.tool} 已逾期 ${-days} 天`
              : `${s.tool} ${days} 天后${s.auto_renew ? '自动续费' : '到期'}${s.price_monthly_usd != null ? ` $${s.price_monthly_usd}` : ''}`,
          })
        }
      }
    }
  }
  alerts.sort((a, b) => a.days_until - b.days_until)
  return { subscriptions: list, total_monthly_usd: Math.round(total * 100) / 100, alerts }
}

// ---- relay staleness guard ----
function withRelayStatus(relaysDoc) {
  const now = Date.now()
  const staleMin = relaysDoc.stale_threshold_minutes || 90
  const relays = (relaysDoc.relays || []).map((r) => {
    let stale = false
    if (r.last_check) {
      const age = (now - Date.parse(r.last_check)) / 60000
      if (Number.isFinite(age) && age > staleMin) stale = true
    } else if (r.status !== 'unknown') {
      stale = true
    }
    const merged = { ...r, stale }
    merged.rule = evalRelay(merged)
    return merged
  })
  return { ...relaysDoc, relays }
}

const SCRIPT_TIMEOUT_MS = 120000
const scriptRunning = new Set() // in-flight guard: duplicate triggers get 409 instead of a second process

// returns null when the script is already running (caller maps to 409)
function runScript(file) {
  if (scriptRunning.has(file)) return Promise.resolve(null)
  scriptRunning.add(file)
  return new Promise((resolve) => {
    const ps = spawn(process.execPath, [path.join(ROOT, 'scripts', file)], { cwd: ROOT })
    let out = '', err = '', timedOut = false, settled = false
    const killTimer = setTimeout(() => { timedOut = true; ps.kill('SIGTERM') }, SCRIPT_TIMEOUT_MS)
    const done = (r) => {
      if (settled) return
      settled = true
      clearTimeout(killTimer)
      scriptRunning.delete(file)
      resolve(r)
    }
    ps.stdout.on('data', (d) => (out += d))
    ps.stderr.on('data', (d) => (err += d))
    ps.on('close', (code) => done({
      code: timedOut ? -2 : code,
      out: out.slice(-2000),
      err: (timedOut ? `timeout ${SCRIPT_TIMEOUT_MS / 1000}s\n` : '') + err.slice(-2000),
    }))
    ps.on('error', (e) => done({ code: -1, out: '', err: String(e) }))
  })
}

// ---- static file serving (path-traversal safe) ----
async function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0])
  if (rel === '/' || rel === '') rel = '/index.html'
  const full = path.normalize(path.join(PUBLIC, rel))
  if (!full.startsWith(PUBLIC)) return send(res, 403, { error: 'forbidden' })
  try {
    const s = await stat(full)
    if (s.isDirectory()) return serveStatic(req, res, rel.replace(/\/?$/, '/index.html'))
    const buf = await readFile(full)
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' })
    res.end(buf)
  } catch {
    // 无 SPA fallback：前端是 hash 路由；缺失资源必须 404，而不是 200+HTML（难以排查）
    send(res, 404, { error: 'not found' })
  }
}

const server = http.createServer(async (req, res) => {
  const { method } = req
  const url = req.url || '/'
  const urlPath = url.split('?')[0]
  try {
    if (!urlPath.startsWith('/api/')) return serveStatic(req, res, urlPath)

    // ---------- API ----------
    if (urlPath === '/api/health') return sendJson(res, { ok: true, ts: new Date().toISOString() })

    if (urlPath === '/api/official-api' && method === 'GET') return sendJson(res, await read('official-api.json'))

    if (urlPath === '/api/compare' && method === 'GET') {
      const [api, rules] = await Promise.all([read('official-api.json'), read('rules.json')])
      const models = (api.models || []).map((m) => ({ ...m, rule: evalModel(m, rules) }))
      const vendors = [...new Set(models.map((m) => m.vendor))].sort()
      const tags = [...new Set(models.flatMap((m) => m.tags || []))].sort()
      return sendJson(res, {
        generated_at: api.generated_at, count: models.length, models, vendors, tags,
        provider_types: ['first_party', 'cloud', 'aggregator', 'host'],
      })
    }
    if (urlPath === '/api/coding-plans' && method === 'GET') return sendJson(res, await read('coding-plans.json'))
    if (urlPath === '/api/relays' && method === 'GET') return sendJson(res, withRelayStatus(await read('relays.json')))

    if (urlPath === '/api/rules') {
      if (method === 'GET') return sendJson(res, await read('rules.json'))
      if (method === 'PUT' || method === 'POST') {
        const body = await readBody(req)
        // reject parse-failure (null) and empty object, so a bad request can't wipe rules.json
        if (!body || typeof body !== 'object' || Object.keys(body).length === 0) return send(res, 400, { error: 'invalid or empty rules body' })
        await write('rules.json', body)
        return sendJson(res, { ok: true, rules: body })
      }
    }

    if (urlPath === '/api/subscriptions') {
      if (method === 'GET') return sendJson(res, withSubAlerts(await read('subscriptions.json')))
      if (method === 'PUT' || method === 'POST') {
        const body = await readBody(req)
        // a malformed/missing body must NOT silently overwrite the user's billing data with []
        if (body === null) return send(res, 400, { error: 'invalid JSON' })
        if (!Array.isArray(body.subscriptions)) return send(res, 400, { error: 'subscriptions[] required' })
        const computed = withSubAlerts({ subscriptions: body.subscriptions })
        await write('subscriptions.json', computed)
        return sendJson(res, computed)
      }
    }

    if (urlPath === '/api/recommendations' && method === 'GET') {
      const [api, plans] = await Promise.all([read('official-api.json'), read('coding-plans.json')])
      return sendJson(res, recommendations(api, plans))
    }

    if (urlPath === '/api/calculate' && method === 'POST') {
      const body = await readBody(req)
      if (body === null) return send(res, 400, { error: 'invalid JSON' }) // 与 /api/rules、/api/subscriptions 一致
      const [api, plans, rules] = await Promise.all([read('official-api.json'), read('coding-plans.json'), read('rules.json')])
      return sendJson(res, calculate(api, plans, rules, body))
    }

    if (urlPath === '/api/dashboard' && method === 'GET') {
      const [api, plans, relaysDoc, subsDoc, rules] = await Promise.all([
        read('official-api.json'), read('coding-plans.json'), read('relays.json'),
        read('subscriptions.json'), read('rules.json'),
      ])
      const relays = withRelayStatus(relaysDoc).relays
      const subs = withSubAlerts(subsDoc)
      // coding tools with rule status + my_status
      const codingTools = (plans.tools || []).map((t) => ({ ...t, rule: evalCodingTool(t, rules) }))
      const myTools = codingTools.filter((t) => t.rule.status === 'green' || t.my_status?.current_plan)
      // models flagged always_show / watched. First-party canonical only (skip cloud/aggregator
      // rebrands of the same model), and hide superseded line members — show the current version.
      const watchedModels = (api.models || [])
        .map((m) => ({ m, r: evalModel(m, rules) }))
        .filter((x) => (x.r.status === 'green' || x.r.status === 'red') && !x.m.superseded && x.m.provider_type === 'first_party')
        .slice(0, 30)
        .map((x) => ({ model_id: x.m.model_id, name: x.m.name, vendor: x.m.vendor, input_per_m: x.m.input_per_m, output_per_m: x.m.output_per_m, tags: x.m.tags, rule: x.r }))
      const rec = recommendations(api, plans)
      return sendJson(res, {
        generated_at: new Date().toISOString(),
        counts: {
          models_total: api.count || (api.models || []).length,
          models_first_party: (api.models || []).filter((m) => m.provider_type === 'first_party').length,
          coding_tools: (plans.tools || []).length,
          relays: relays.length,
          subscriptions: subs.subscriptions.length,
        },
        api_generated_at: api.generated_at,
        relays,
        subscriptions: subs,
        my_tools: myTools,
        watched_models: watchedModels,
        top_picks: rec.cards.slice(0, 3),
      })
    }

    if (urlPath === '/api/sync' && method === 'POST') {
      const r = await runScript('sync-official-api.mjs')
      return r ? sendJson(res, r) : send(res, 409, { error: 'already running' })
    }
    if (urlPath === '/api/check-relays' && method === 'POST') {
      const r = await runScript('check-relays.mjs')
      return r ? sendJson(res, r) : send(res, 409, { error: 'already running' })
    }

    // ---------- usage tracking (pluggable platforms, see scripts/usage/README.md) ----------
    if (urlPath === '/api/usage' && method === 'GET') return sendJson(res, getUsage())
    if (urlPath === '/api/usage/refresh' && method === 'POST') return sendJson(res, await refreshUsage())
    if (urlPath === '/api/usage/platforms' && method === 'GET') return sendJson(res, { platforms: getPlatforms() })
    const usageEnable = urlPath.match(/^\/api\/usage\/platforms\/([\w-]+)\/enable$/)
    if (usageEnable && method === 'POST') {
      const body = await readBody(req)
      if (!body || typeof body !== 'object') return send(res, 400, { error: 'invalid JSON body' })
      try {
        return sendJson(res, await enablePlatform(usageEnable[1], body)) // 幂等覆盖 = 更新凭据入口
      } catch (e) {
        if (e.code === 'UNKNOWN_PLATFORM') return send(res, 404, { error: e.message })
        if (e.code === 'BAD_CONFIG') return send(res, 400, { error: e.message })
        throw e
      }
    }
    const usageDelete = urlPath.match(/^\/api\/usage\/platforms\/([\w-]+)$/)
    if (usageDelete && method === 'DELETE') return sendJson(res, await disablePlatform(usageDelete[1]))

    return send(res, 404, { error: 'unknown endpoint', path: urlPath })
  } catch (e) {
    console.error('[server] error', e)
    return send(res, 500, { error: String(e?.message || e) })
  }
})

initUsage().catch((e) => console.error('[usage] init failed', e)) // 后台调度；失败不阻塞服务启动

server.listen(PORT, HOST, () => {
  console.log(`AI Pricing Dashboard → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`)
})
