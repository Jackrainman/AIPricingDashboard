#!/usr/bin/env node
// check-annotations.mjs — annotation gap report.
// Lists first-party active chat models the manual annotation layer never touched
// (no release_date AND no annotation_note → pickAnnotation returned null).
// These get only heuristic tags, so new model generations silently miss flagship/coding tiers
// until someone adds an entry to data/model-annotations.json. Turns silent staleness into a TODO.
//
// Usage: node scripts/check-annotations.mjs   (reads data/official-api.json; run after `npm run sync`)

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const F = path.join(ROOT, 'data', 'official-api.json')

if (!existsSync(F)) {
  console.error('data/official-api.json not found — run `npm run sync` first.')
  process.exit(1)
}
const doc = JSON.parse(await readFile(F, 'utf8'))
const models = doc.models || []

const gaps = models.filter(
  (m) => m.provider_type === 'first_party' && m.status === 'active' && (m.kind ?? 'chat') === 'chat' &&
    !m.release_date && !m.annotation_note,
)

if (!gaps.length) {
  console.log('✓ 无标注缺口：所有 first-party active 模型都命中了 model-annotations.json。')
  process.exit(0)
}

const byVendor = {}
for (const m of gaps) (byVendor[m.vendor] ||= []).push(m)

console.log(`未被标注命中的 first-party active 模型：${gaps.length} 个（缺 flagship/coding 等档位标签，性价比之选会忽略它们）`)
console.log('补法：在 data/model-annotations.json 加 {match, family, release_date, tags, notes} 条目，然后 npm run sync。\n')
for (const vendor of Object.keys(byVendor).sort()) {
  console.log(`【${vendor}】`)
  for (const m of byVendor[vendor].sort((a, b) => (a.input_per_m ?? 1e9) - (b.input_per_m ?? 1e9))) {
    const price = m.input_per_m == null ? '?' : `$${m.input_per_m}/${m.output_per_m ?? '?'}`
    console.log(`  ${m.model_id.padEnd(36)} ${String(price).padEnd(16)} tags=[${(m.tags || []).join(',')}]`)
  }
}
