// recommend.mjs — 性价比之选 (best-value picks). Heuristic capability-per-dollar, no benchmarks.
// blended price = input*0.75 + output*0.25 (typical 3:1 in:out). value = capability_score / blended.

const TAG_SCORE = {
  flagship: 6, reasoning: 4, 'coding-optimized': 4, 'coding-capable': 2,
  'agent-bulk': 1, vision: 0.5, 'tool-calling': 0.5,
}

export function capabilityScore(model) {
  let s = 4 // general baseline
  const tags = model.tags || []
  for (const t of tags) s += TAG_SCORE[t] || 0
  return Math.round(s * 10) / 10
}

export function blendedPrice(model) {
  const i = model.input_per_m, o = model.output_per_m
  if (i == null && o == null) return null
  return (i ?? 0) * 0.75 + (o ?? 0) * 0.25
}

function valueScore(model) {
  const b = blendedPrice(model)
  if (b == null || b <= 0) return null
  return capabilityScore(model) / b
}

function pick(models, filterFn, sortFn) {
  const c = models.filter(filterFn).filter((m) => blendedPrice(m) != null && blendedPrice(m) > 0)
  if (!c.length) return null
  c.sort(sortFn)
  return c[0]
}

function lite(m) {
  return {
    model_id: m.model_id, name: m.name, vendor: m.vendor, tags: m.tags,
    input_per_m: m.input_per_m, output_per_m: m.output_per_m,
    blended_per_m: Math.round(blendedPrice(m) * 1000) / 1000,
    capability_score: capabilityScore(m),
    value_score: Math.round((valueScore(m) || 0) * 100) / 100,
    context_window: m.context_window,
  }
}

// officialApi = {models}, codingPlans = {tools}
export function recommendations(officialApi, codingPlans) {
  // chat-only, active, non-superseded; embeddings/rerank + retired line members excluded from value ranking
  const all = (officialApi?.models || []).filter((m) => m.status === 'active' && (m.kind ?? 'chat') === 'chat' && !m.superseded)
  const fp = all.filter((m) => m.provider_type === 'first_party')
  const pool = fp.length ? fp : all

  const cards = []
  const hasTag = (m, t) => (m.tags || []).includes(t)

  // 1) best-VALUE flagship — the "bang for buck" among genuine top-tier models
  const overall = pick(pool, (m) => hasTag(m, 'flagship'), (a, b) => valueScore(b) - valueScore(a))
  if (overall) cards.push({
    id: 'overall', title: '综合性价比之王',
    pick: lite(overall), metric_label: '能力/价格分',
    why: `顶级模型里每元能力最高（能力分 ${capabilityScore(overall)} ÷ $${lite(overall).blended_per_m}/M）`,
  })

  // 2) cheapest CODING-capable model
  const coding = pick(pool, (m) => hasTag(m, 'coding-optimized') || hasTag(m, 'coding-capable'),
    (a, b) => blendedPrice(a) - blendedPrice(b))
  if (coding) cards.push({
    id: 'coding', title: '编程最划算',
    pick: lite(coding), metric_label: '最低混合价',
    why: `编程可用模型里混合价最低（$${lite(coding).blended_per_m}/M）`,
  })

  // 3) cheapest BULK/agent model (cheap + big context)
  const bulk = pick(pool, (m) => hasTag(m, 'agent-bulk'), (a, b) => blendedPrice(a) - blendedPrice(b))
  if (bulk) cards.push({
    id: 'bulk', title: '跑量/Agent 最划算',
    pick: lite(bulk), metric_label: '最低混合价',
    why: `便宜 + 大上下文，适合 Agent 跑量（$${lite(bulk).blended_per_m}/M, ${(bulk.context_window || 0) / 1000}K ctx）`,
  })

  // 4) best-VALUE reasoning model (distinct from flagship pick)
  const reasoning = pick(pool, (m) => hasTag(m, 'reasoning'), (a, b) => valueScore(b) - valueScore(a))
  if (reasoning && (!overall || reasoning.model_id !== overall.model_id)) cards.push({
    id: 'reasoning', title: '推理最划算',
    pick: lite(reasoning), metric_label: '能力/价格分',
    why: `推理模型里每元能力最高（$${lite(reasoning).blended_per_m}/M）`,
  })

  // best coding plan: cheapest paid monthly plan among non-discontinued tools
  let bestPlan = null
  for (const t of codingPlans?.tools || []) {
    if (t.discontinued) continue
    for (const p of t.plans || []) {
      if (typeof p.price_monthly_usd === 'number' && p.price_monthly_usd > 0) {
        if (!bestPlan || p.price_monthly_usd < bestPlan.price) {
          bestPlan = { tool: t.tool, vendor: t.vendor, plan: p.name, price: p.price_monthly_usd, quota: p.quota, metering: t.metering_category }
        }
      }
    }
  }
  if (bestPlan) cards.push({
    id: 'plan', title: 'Coding 订阅最划算',
    pick: bestPlan, metric_label: '最低月费',
    why: `付费档里月费最低（$${bestPlan.price}/月，${bestPlan.quota || ''}）`,
  })

  const leaderboard = pool
    .filter((m) => capabilityScore(m) >= 6) // usable models only, not toy/embedding tiers
    .map((m) => ({ m, v: valueScore(m) }))
    .filter((x) => x.v != null)
    .sort((a, b) => b.v - a.v)
    .slice(0, 10)
    .map((x) => lite(x.m))

  return {
    generated_at: new Date().toISOString(),
    method: '启发式：能力分(标签加权) ÷ 混合价(输入×0.75+输出×0.25)。非基准测试，仅供快速判断。',
    cards,
    leaderboard,
  }
}
