#!/usr/bin/env node
// sync-official-api.mjs — normalize official API pricing into data/official-api.json
//
// Source of truth: pydantic/genai-prices (MIT, authoritative: cache_write first-class).
// Supplement: BerriAI/litellm model_prices_and_context_window.json (max_output, vision, tool-calling, fallback).
// Overlay:    data/model-annotations.json (manual release_date + coding tags; never overwritten by sources).
//
// Handles genai price shapes: flat dict | tiered {base,tiers} | time-constraint list.
// Null-safe: missing fields are stored as null, never dropped.
//
// Usage: node scripts/sync-official-api.mjs   (fetches live; falls back to scratchpad/local cache)

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DATA = path.join(ROOT, 'data')

const GENAI_URL = 'https://raw.githubusercontent.com/pydantic/genai-prices/main/prices/data.json'
const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
// local dev caches (so the build works offline once primed)
const CACHE = {
  genai: process.env.GENAI_CACHE || path.join(DATA, '.cache', 'genai-data.json'),
  litellm: process.env.LITELLM_CACHE || path.join(DATA, '.cache', 'litellm.json'),
}

// vendor (genai provider id) -> preferred litellm_provider names, for capability join
const VENDOR_LITELLM = {
  anthropic: ['anthropic', 'bedrock', 'bedrock_converse', 'vertex_ai-anthropic_models'],
  openai: ['openai', 'azure', 'azure_ai'],
  google: ['gemini', 'vertex_ai-language-models', 'vertex_ai'],
  deepseek: ['deepseek'],
  mistral: ['mistral'],
  'x-ai': ['xai'],
  cohere: ['cohere', 'cohere_chat'],
  perplexity: ['perplexity'],
  moonshotai: ['moonshot', 'moonshotai'],
  zhipuai: ['zhipuai'],
  minimax: ['minimax'],
}

// provider_type lets the UI default to first-party vendors and fold the rest away
const PROVIDER_TYPE = {
  anthropic: 'first_party', openai: 'first_party', google: 'first_party', deepseek: 'first_party',
  mistral: 'first_party', 'x-ai': 'first_party', cohere: 'first_party', perplexity: 'first_party',
  moonshotai: 'first_party', zhipuai: 'first_party', minimax: 'first_party', voyageai: 'first_party',
  aws: 'cloud', azure: 'cloud', ovhcloud: 'cloud',
  openrouter: 'aggregator',
  together: 'host', fireworks: 'host', groq: 'host', cerebras: 'host', novita: 'host',
  avian: 'host', doubleword: 'host',
}
function providerType(id) {
  if (PROVIDER_TYPE[id]) return PROVIDER_TYPE[id]
  if (id.startsWith('huggingface_')) return 'host'
  return 'host'
}

async function loadJson(url, cachePath, label) {
  // try live fetch first
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 25000)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const json = await res.json()
    // refresh cache opportunistically
    try {
      await mkdir(path.dirname(cachePath), { recursive: true })
      await writeFile(cachePath, JSON.stringify(json))
    } catch {}
    console.error(`[${label}] fetched live (${url})`)
    return json
  } catch (e) {
    console.error(`[${label}] live fetch failed (${e.message}); trying cache ${cachePath}`)
    if (existsSync(cachePath)) return JSON.parse(await readFile(cachePath, 'utf8'))
    throw new Error(`[${label}] no live data and no cache — cannot proceed`)
  }
}

// Compile a genai match rule into predicate over a lowercased model key
function compileMatch(rule) {
  if (!rule || typeof rule !== 'object') return () => false
  if (rule.or) { const ps = rule.or.map(compileMatch); return (s) => ps.some((p) => p(s)) }
  if (rule.and) { const ps = rule.and.map(compileMatch); return (s) => ps.every((p) => p(s)) }
  if (rule.starts_with != null) { const v = rule.starts_with.toLowerCase(); return (s) => s.startsWith(v) }
  if (rule.ends_with != null) { const v = rule.ends_with.toLowerCase(); return (s) => s.endsWith(v) }
  if (rule.equals != null) { const v = rule.equals.toLowerCase(); return (s) => s === v }
  if (rule.contains != null) { const v = rule.contains.toLowerCase(); return (s) => s.includes(v) }
  if (rule.regex != null) { let re; try { re = new RegExp(rule.regex, 'i') } catch { return () => false }; return (s) => re.test(s) }
  return () => false
}

// genai prices -> {input,output,cache_read,cache_write} per Mtok + a price_note for non-flat shapes
function extractPrices(prices) {
  let note = null
  let p = prices
  if (Array.isArray(p)) {
    // time/constraint-based: prefer the unconstrained (default) entry
    const def = p.find((e) => !e.constraint) || p[0]
    if (p.length > 1) note = '分时/条件计价，显示标准档'
    p = def?.prices || {}
  }
  if (!p || typeof p !== 'object') p = {}
  const pick = (key) => {
    const v = p[key]
    if (v == null) return null
    if (typeof v === 'number') return v
    if (typeof v === 'object' && v.base != null) {
      if (!note) note = '按上下文长度分级，显示基础档'
      return v.base
    }
    return null
  }
  return {
    input_per_m: pick('input_mtok'),
    output_per_m: pick('output_mtok'),
    cache_read_per_m: pick('cache_read_mtok'),
    cache_write_per_m: pick('cache_write_mtok'),
    price_note: note,
  }
}

function uniq(arr) { return [...new Set(arr.filter(Boolean))] }

const SIZE_WORD = /(nano|mini|lite|flash|small|tiny|micro|haiku|air|edge)/

// named variants that are NOT a clean version bump -> treat as downgrade (drop flagship/reasoning).
// NOTE: 'thinking' is intentionally NOT here — a thinking variant IS a reasoning model and should keep the parent tier.
const VARIANT_WORD = /(fast|non[-_]?reasoning|distill|instruct|chat|turbo|preview-tts|tts|audio|image|search)/
// upgrade variants (top-tier SKUs): keep the parent flagship/reasoning tier rather than downgrading.
const UPGRADE_WORD = /(pro|max|ultra|plus|heavy|advanced)/
// Classify how annotation key `k` matches model id `idl`: 'exact' | 'version' | 'downgrade' | null
function classifyAnn(idl, k) {
  if (idl === k) return 'exact'
  if (idl.startsWith(k)) {
    const suf = idl.slice(k.length)
    if (SIZE_WORD.test(suf) || VARIANT_WORD.test(suf)) return 'downgrade'
    // pro/max/ultra/plus are UPGRADED SKUs of the same line -> inherit flagship/reasoning
    if (UPGRADE_WORD.test(suf)) return 'version'
    // a pure date/version tail OR a 'thinking' variant inherits the parent tier (flagship/reasoning)
    if (/^[-._]?(\d|20\d\d|v\d|latest|preview|exp|thinking)/.test(suf) || /thinking/.test(suf)) return 'version'
    return 'downgrade'
  }
  return null
}
// pick the most specific (longest key) annotation; returns {ann, downgrade, family}
function pickAnnotation(idl, naml, annotList) {
  let best = null, bestLen = -1, downgrade = false
  for (const a of annotList) {
    const k = (a.match || '').toLowerCase()
    if (!k) continue
    let cls = classifyAnn(idl, k)
    if (!cls && naml && naml === k) cls = 'exact'
    if (cls && k.length > bestLen) { best = a; bestLen = k.length; downgrade = cls === 'downgrade' }
  }
  return { ann: best, downgrade, family: best?.family ?? null }
}

function detectKind(vendorId, name, id, mode) {
  const n = `${name} ${id}`.toLowerCase()
  if (vendorId === 'voyageai' || /embed|rerank/.test(n) || mode === 'embedding' || mode === 'rerank') return 'embedding'
  if (mode && !['chat', 'completion', 'responses', 'audio'].includes(mode)) return 'other'
  return 'chat'
}

async function main() {
  const [genai, litellm, annot] = await Promise.all([
    loadJson(GENAI_URL, CACHE.genai, 'genai'),
    loadJson(LITELLM_URL, CACHE.litellm, 'litellm'),
    (async () => {
      const f = path.join(DATA, 'model-annotations.json')
      if (existsSync(f)) {
        try { const j = JSON.parse(await readFile(f, 'utf8')); return j.annotations || j || [] } catch { return [] }
      }
      return []
    })(),
  ])

  // index litellm by provider for vendor-preferred capability join
  const llEntries = Object.entries(litellm).filter(([k]) => k !== 'sample_spec')
  function findLitellm(matchFn, vendor) {
    const prefer = VENDOR_LITELLM[vendor] || []
    let fallback = null
    for (const [name, spec] of llEntries) {
      if (typeof spec !== 'object' || !spec) continue
      if (!matchFn(name.toLowerCase())) continue
      const prov = spec.litellm_provider || ''
      if (prefer.includes(prov)) return spec
      if (!fallback) fallback = spec
    }
    return fallback
  }

  const annotList = Array.isArray(annot) ? annot : []

  const models = []
  for (const provider of genai) {
    const vendorId = provider.id
    const vendorName = provider.name || vendorId
    const ptype = providerType(vendorId)
    for (const m of provider.models || []) {
      const { input_per_m, output_per_m, cache_read_per_m, cache_write_per_m, price_note } = extractPrices(m.prices)
      const matchFn = compileMatch(m.match)
      const ll = findLitellm(matchFn, vendorId)
      const max_output = ll?.max_output_tokens ?? ll?.max_tokens ?? null
      const context_window = m.context_window ?? ll?.max_input_tokens ?? ll?.max_tokens ?? null
      const vision = !!ll?.supports_vision
      const tool_calling = !!ll?.supports_function_calling

      // annotation overlay: most-specific (longest-key) match; size-downgrade siblings drop flagship/reasoning
      const idl = (m.id || '').toLowerCase()
      const naml = (m.name || '').toLowerCase()
      const { ann, downgrade, family } = pickAnnotation(idl, naml, annotList)
      const kind = detectKind(vendorId, m.name || '', m.id || '', ll?.mode)

      // tags
      const tags = []
      if (ann?.tags) for (let t of ann.tags) {
        if (t === 'cheap-bulk') t = 'agent-bulk'
        if (downgrade && (t === 'flagship' || t === 'reasoning')) continue
        tags.push(t)
      }
      if (vision) tags.push('vision')
      if (tool_calling) tags.push('tool-calling')
      // auto tags (feasibility §2.1)
      if (input_per_m != null && input_per_m < 0.5 && context_window && context_window >= 128000) tags.push('agent-bulk')
      if (input_per_m != null && input_per_m >= 5) tags.push('reasoning')
      const finalTags = uniq(tags)
      if (!finalTags.some((t) => ['coding-optimized', 'coding-capable', 'reasoning', 'agent-bulk', 'flagship'].includes(t))) {
        finalTags.push('general')
      }

      models.push({
        model_id: m.id,
        name: m.name || m.id,
        vendor: vendorName,
        vendor_id: vendorId,
        provider_type: ptype,
        kind: kind,
        input_per_m,
        output_per_m,
        cache_read_per_m,
        cache_write_per_m,
        context_window: context_window,
        max_output: max_output,
        tags: uniq(finalTags),
        status: m.deprecated ? 'deprecated' : 'active',
        deprecated: !!m.deprecated,
        superseded: false, // set by family-supersession pass below
        release_date: ann?.release_date ?? null,
        price_note: price_note,
        annotation_note: ann?.notes ?? null,
        __family: family, // internal; stripped before write
      })
    }
  }

  // --- family supersession: within a curated `family`, only the newest (by release_date)
  // keeps the flagship crown; older line members are marked superseded + lose flagship.
  // Keyed on human-curated release_date (reliable), not fragile id/version parsing.
  const fams = {}
  for (const m of models) {
    if (!m.__family) continue
    ;(fams[m.__family] ||= []).push(m)
  }
  let supersededCount = 0
  for (const list of Object.values(fams)) {
    const top = list.reduce((a, b) => ((b.release_date || '') > (a.release_date || '') ? b : a)).release_date || ''
    for (const m of list) {
      if ((m.release_date || '') < top) {
        m.superseded = true
        m.tags = (m.tags || []).filter((t) => t !== 'flagship')
        supersededCount++
      }
    }
  }
  for (const m of models) delete m.__family

  // sort: first-party first, then vendor, then input price asc (nulls last)
  const typeRank = { first_party: 0, cloud: 1, aggregator: 2, host: 3 }
  models.sort((a, b) => {
    const tr = (typeRank[a.provider_type] ?? 9) - (typeRank[b.provider_type] ?? 9)
    if (tr) return tr
    if (a.vendor !== b.vendor) return a.vendor.localeCompare(b.vendor)
    const ap = a.input_per_m ?? Infinity, bp = b.input_per_m ?? Infinity
    return ap - bp
  })

  const out = {
    generated_at: new Date().toISOString(),
    sources: [GENAI_URL, LITELLM_URL, 'data/model-annotations.json'],
    count: models.length,
    annotations_applied: models.filter((m) => m.release_date || m.annotation_note).length,
    models,
  }
  await writeFile(path.join(DATA, 'official-api.json'), JSON.stringify(out, null, 2))
  console.error(`[done] wrote ${models.length} models -> data/official-api.json (annotations applied: ${out.annotations_applied}, superseded: ${supersededCount})`)
  // gap heads-up: first-party active chat models the annotation layer never touched (run `npm run check-annotations` for the list)
  const gaps = models.filter((m) => m.provider_type === 'first_party' && m.status === 'active' && (m.kind ?? 'chat') === 'chat' && !m.release_date && !m.annotation_note)
  if (gaps.length) console.error(`[gap] ${gaps.length} first-party models未被标注命中 → npm run check-annotations 查看清单`)
  // tiny sanity summary
  const byVendor = {}
  for (const m of models) byVendor[m.vendor] = (byVendor[m.vendor] || 0) + 1
  const top = Object.entries(byVendor).sort((a, b) => b[1] - a[1]).slice(0, 8)
  console.error('[summary] top vendors:', top.map(([v, n]) => `${v}:${n}`).join(' '))
}

main().catch((e) => { console.error(e); process.exit(1) })
