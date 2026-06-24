#!/usr/bin/env node
// sync-benchmarks.mjs — PROTOTYPE: fetch external capability signals and align them to our model_ids.
//
// Sources (machine-readable, free):
//   - LMArena leaderboard  → HF datasets-server JSON (CC-BY-4.0): per-category human-preference Elo
//        https://datasets-server.huggingface.co/rows?dataset=lmarena-ai/leaderboard-dataset&config=text&split=latest
//   - Aider Polyglot       → raw GitHub YAML (Apache-2.0): objective code pass-rate
//        https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml
//
// Output: data/benchmarks.json  { generated_at, sources, models: { <our_model_id>: {…signals, as_of} }, unresolved, coverage }
// Capability axis only — cost axis stays in official-api.json. Alignment (benchmark name → model_id) is the real work; see normalize()/ALIAS.
//
// Usage: node scripts/sync-benchmarks.mjs

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data')

const HF = 'https://datasets-server.huggingface.co/rows?dataset=lmarena-ai/leaderboard-dataset'
const AIDER_URL = 'https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml'
const ARENA_CATEGORIES = ['overall', 'coding', 'math'] // within the `text` config
const PAGE = 100
const PAGE_CAP = 30 // safety: max pages per config (30*100=3000 rows). Logged if hit.

// hand-maintained overrides for names that rules can't bridge (the ~10% the scout flagged)
const ALIAS = {
  'deepseek-v4-pro': 'deepseek-v4-pro',
  'deepseek-v4-flash': 'deepseek-v4-flash',
  // benchmark-name → our model_id, add as `npm run sync:bench` surfaces unresolved entries
}

async function getJson(url, label, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url)
      const j = await res.json()
      if (j.error && /busier than usual|not ready/i.test(j.error)) throw new Error('hf-busy')
      if (!res.ok && j.error) throw new Error(j.error)
      return j
    } catch (e) {
      if (i === tries - 1) { console.error(`[${label}] giving up: ${e.message}`); return null }
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)))
    }
  }
}

// page through one HF config/split (the `latest` split = current snapshot)
async function arenaConfig(config, split = 'latest') {
  const rows = []
  for (let page = 0; page < PAGE_CAP; page++) {
    const j = await getJson(`${HF}&config=${config}&split=${split}&offset=${page * PAGE}&length=${PAGE}`, `arena:${config}`)
    if (!j || !j.rows?.length) break
    rows.push(...j.rows.map((r) => r.row))
    const total = j.num_rows_total ?? j.num_rows_total_str
    if (rows.length >= (Number(total) || Infinity)) break
    if (page === PAGE_CAP - 1) console.error(`[arena:${config}] hit page cap ${PAGE_CAP} (${rows.length} rows) — may be truncated`)
  }
  return rows
}

// crude flat-YAML list parser (sufficient for aider's `- key: value` blocks; no nesting)
function parseAiderYaml(text) {
  const blocks = text.split(/\n(?=- )/)
  const field = (b, k) => { const m = b.match(new RegExp(`^\\s*${k}:\\s*(.+?)\\s*$`, 'm')); return m ? m[1] : null }
  return blocks.map((b) => ({
    model: field(b, 'model'),
    command: field(b, 'command'),
    pass_rate_2: Number(field(b, 'pass_rate_2')),
    well_formed: Number(field(b, 'percent_cases_well_formed')),
    cost: Number(field(b, 'total_cost')),
    date: field(b, 'date'),
  })).filter((e) => e.model)
}

// normalize a benchmark model name to a candidate model_id
function normalize(name) {
  if (!name) return null
  let s = name.toLowerCase().trim()
  if (ALIAS[s]) return ALIAS[s]
  s = s.replace(/^[a-z0-9-]+\//, '')                 // strip provider prefix: anthropic/…, gemini/…
  s = s.replace(/\s*\(.*?\)\s*/g, '')                // strip "(32k thinking)" etc
  s = s.replace(/-(thinking|high|medium|low|minimal|fast|exp|preview|latest)\b/g, '') // effort/variant tails
  s = s.replace(/[-_]\d{8}$|[-_]\d{6}$|[-_]\d{4}-\d{2}-\d{2}$/, '') // date tails
  s = s.replace(/\s+/g, '-')
  return ALIAS[s] || s
}

async function main() {
  // 1) our model ids (first-party canonical pool we care about)
  const api = JSON.parse(await readFile(path.join(DATA, 'official-api.json'), 'utf8'))
  const idSet = new Set(api.models.map((m) => m.model_id.toLowerCase()))
  const isOurs = (id) => idSet.has(id)

  // 2) LMArena per-category Elo
  const textRows = await arenaConfig('text')
  const visionRows = await arenaConfig('vision')
  const arenaAsOf = textRows[0]?.leaderboard_publish_date || null
  const out = {}
  const unresolved = new Set()
  const putArena = (rows, want, field) => {
    for (const r of rows) {
      const cat = r.category
      if (want && cat !== want) continue
      const id = normalize(r.model_name)
      if (!isOurs(id)) { unresolved.add(`${r.model_name} [${r.organization}]`); continue }
      out[id] ||= {}
      // multiple variants (thinking/non) map to same id → keep the best (highest Elo)
      if (out[id][field] == null || r.rating > out[id][field]) out[id][field] = Math.round(r.rating)
    }
  }
  putArena(textRows, 'overall', 'arena_overall')
  putArena(textRows, 'coding', 'arena_coding')
  putArena(textRows, 'math', 'arena_math')
  putArena(visionRows, null, 'arena_vision')

  // 3) Aider objective coding pass-rate (keep latest per model)
  let aiderAsOf = null
  const aiderTxt = await (await fetch(AIDER_URL).catch(() => null))?.text?.().catch(() => null)
  if (aiderTxt) {
    const entries = parseAiderYaml(aiderTxt)
    const latest = {}
    for (const e of entries) {
      const id = normalize(e.command?.replace(/^aider\s+--model\s+/, '') || e.model)
      if (!isOurs(id)) { if (e.model) unresolved.add(`aider:${e.model}`); continue }
      if (!latest[id] || (e.date || '') > (latest[id].date || '')) latest[id] = e
      if ((e.date || '') > (aiderAsOf || '')) aiderAsOf = e.date
    }
    for (const [id, e] of Object.entries(latest)) {
      out[id] ||= {}
      out[id].aider_pass_rate = e.pass_rate_2
      out[id].aider_cost_run = e.cost
    }
  }

  // 4) write + report
  const doc = {
    generated_at: new Date().toISOString(),
    sources: { lmarena: { as_of: arenaAsOf, license: 'CC-BY-4.0' }, aider: { as_of: aiderAsOf, license: 'Apache-2.0' } },
    coverage: { our_models: idSet.size, with_arena: Object.values(out).filter((x) => x.arena_overall != null).length, with_aider: Object.values(out).filter((x) => x.aider_pass_rate != null).length, unresolved: unresolved.size },
    models: out,
    unresolved: [...unresolved].slice(0, 60),
  }
  await mkdir(DATA, { recursive: true })
  await writeFile(path.join(DATA, 'benchmarks.json'), JSON.stringify(doc, null, 2))
  console.error(`[done] benchmarks.json: ${doc.coverage.with_arena} 个模型有 Arena 分, ${doc.coverage.with_aider} 个有 Aider 分, ${unresolved.size} 条未对齐 (arena as_of ${arenaAsOf}, aider ${aiderAsOf})`)

  // spot-check
  console.error('\n[抽查]')
  for (const id of ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'claude-sonnet-4-6', 'claude-opus-4-8', 'glm-4.6', 'glm-5.2', 'gpt-5.5']) {
    const v = out[id]
    console.error(`  ${id.padEnd(20)} ${idSet.has(id) ? '' : '(不在价格库) '}${v ? JSON.stringify(v) : '— 无 benchmark 命中'}`)
  }
  console.error('\n[未对齐样本(前15)]:', doc.unresolved.slice(0, 15).join(' | '))
}
main().catch((e) => { console.error(e); process.exit(1) })
