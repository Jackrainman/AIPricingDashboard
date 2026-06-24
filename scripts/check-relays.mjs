#!/usr/bin/env node
// check-relays.mjs — probe each relay's /v1/models. Alive = reachable + new-api JSON (401 or 200). No key needed.
// Writes data/relays.json (preserves config, updates status/last_check/history). Run via cron / POST /api/check-relays.
import { readFile, writeFile, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.join(__dirname, '..', 'data', 'relays.json')

async function probe(endpoint) {
  const t0 = Date.now()
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 12000)
    const res = await fetch(endpoint, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    const ms = Date.now() - t0
    clearTimeout(timer)
    const ct = res.headers.get('content-type') || ''
    let bodyText = ''
    try { bodyText = (await res.text()).slice(0, 400) } catch {}
    const looksNewApi = /new_api_error|"data"\s*:|"object"\s*:|"models"/.test(bodyText)
    const isJson = ct.includes('json') || /^\s*[{[]/.test(bodyText)
    // alive: reachable + (401 or 200) + json-ish/new-api body  (200 SPA HTML is NOT a health signal)
    const alive = (res.status === 401 || res.status === 200) && (isJson || looksNewApi) && bodyText.length > 0
    return { status: alive ? 'online' : 'offline', response_time_ms: ms, http_code: res.status }
  } catch (e) {
    return { status: 'offline', response_time_ms: null, http_code: null, error: String(e?.name || e) }
  }
}

async function main() {
  const doc = existsSync(FILE)
    ? JSON.parse(await readFile(FILE, 'utf8'))
    : { stale_threshold_minutes: 90, relays: [] }
  const now = new Date().toISOString()
  for (const r of doc.relays || []) {
    const result = await probe(r.endpoint)
    r.status = result.status
    r.response_time_ms = result.response_time_ms
    r.http_code = result.http_code
    r.last_check = now
    r.history_24h = Array.isArray(r.history_24h) ? r.history_24h : []
    r.history_24h.push({ time: now, status: result.status, ms: result.response_time_ms })
    if (r.history_24h.length > 48) r.history_24h = r.history_24h.slice(-48)
    console.error(`[relay] ${r.name}: ${result.status} (${result.http_code ?? 'err'}, ${result.response_time_ms ?? '-'}ms)`)
  }
  doc.generated_at = now
  const tmp = FILE + '.tmp'
  await writeFile(tmp, JSON.stringify(doc, null, 2))
  await rename(tmp, FILE)
  console.error(`[done] updated ${(doc.relays || []).length} relays -> data/relays.json`)
}
main().catch((e) => { console.error(e); process.exit(1) })
