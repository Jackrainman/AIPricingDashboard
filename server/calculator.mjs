// calculator.mjs — given a monthly usage scenario, rank models by cost + coding-plan equivalence (ESTIMATE).

function num(x, d = 0) { const n = Number(x); return Number.isFinite(n) ? n : d }

// body: { input_mtok, output_mtok, cache_read_mtok?, cache_write_mtok?,
//         OR sessions + session_input_tokens + session_output_tokens,
//         vendor_filter?: string[], provider_types?: string[], model_ids?: string[], limit? }
export function calculate(officialApi, codingPlans, rules, body = {}) {
  // resolve usage (million-tokens/month)
  let input_mtok, output_mtok
  if (body.sessions != null) {
    const s = num(body.sessions)
    // 默认每会话 10000/3000 token：与 public/js/calculator.js 的 calcState.sin/sout 是两处拷贝，改动需同步
    input_mtok = (s * num(body.session_input_tokens, 10000)) / 1e6
    output_mtok = (s * num(body.session_output_tokens, 3000)) / 1e6
  } else {
    input_mtok = num(body.input_mtok)
    output_mtok = num(body.output_mtok)
  }
  const cache_read_mtok = num(body.cache_read_mtok)
  const cache_write_mtok = num(body.cache_write_mtok)

  const usage = { input_mtok, output_mtok, cache_read_mtok, cache_write_mtok }

  let models = (officialApi?.models || []).filter((m) => m.input_per_m != null || m.output_per_m != null)
  if (Array.isArray(body.model_ids) && body.model_ids.length) {
    const set = new Set(body.model_ids)
    models = models.filter((m) => set.has(m.model_id))
  } else {
    // default to active first-party to keep the list meaningful
    const pt = Array.isArray(body.provider_types) && body.provider_types.length ? body.provider_types : ['first_party']
    models = models.filter((m) => m.status === 'active' && pt.includes(m.provider_type) && (m.kind ?? 'chat') === 'chat')
    if (Array.isArray(body.vendor_filter) && body.vendor_filter.length) {
      const vs = new Set(body.vendor_filter.map((v) => v.toLowerCase()))
      models = models.filter((m) => vs.has((m.vendor || '').toLowerCase()) || vs.has((m.vendor_id || '').toLowerCase()))
    }
  }

  const rows = models.map((m) => {
    const cIn = input_mtok * (m.input_per_m ?? 0)
    const cOut = output_mtok * (m.output_per_m ?? 0)
    const cCacheR = cache_read_mtok * (m.cache_read_per_m ?? 0)
    const cCacheW = cache_write_mtok * (m.cache_write_per_m ?? 0)
    const total = cIn + cOut + cCacheR + cCacheW
    return {
      model_id: m.model_id, name: m.name, vendor: m.vendor, tags: m.tags,
      input_per_m: m.input_per_m, output_per_m: m.output_per_m,
      cost_input: round(cIn), cost_output: round(cOut),
      cost_cache_read: round(cCacheR), cost_cache_write: round(cCacheW),
      monthly_cost_usd: round(total),
      price_note: m.price_note,
    }
  }).sort((a, b) => a.monthly_cost_usd - b.monthly_cost_usd)

  if (body.limit != null) {
    const lim = Math.max(0, Math.floor(num(body.limit, rows.length))) // non-negative integer; avoids RangeError
    rows.length = Math.min(rows.length, lim)
  }

  // coding-plan equivalence (ESTIMATE): how many input-Mtok of the reference model the plan's $ buys
  // fallback 字面值与 store.mjs DEFAULTS rules.calculator.reference_model_id 保持一致（本模块不 import store，需手动同步）
  const refId = rules?.calculator?.reference_model_id || 'claude-sonnet-4-6'
  const ref = (officialApi?.models || []).find((m) => (m.model_id || '').includes(refId)) ||
              (officialApi?.models || []).find((m) => (m.model_id || '').includes('sonnet'))
  const refInput = ref?.input_per_m || 3
  const planEquiv = []
  for (const t of codingPlans?.tools || []) {
    for (const p of t.plans || []) {
      if (typeof p.price_monthly_usd === 'number' && p.price_monthly_usd > 0) {
        planEquiv.push({
          tool: t.tool, plan: p.name, price_monthly_usd: p.price_monthly_usd,
          metering: t.metering_category, quota: p.quota,
          equiv_input_mtok: round(p.price_monthly_usd / refInput),
          discontinued: !!t.discontinued,
        })
      }
    }
  }
  planEquiv.sort((a, b) => a.price_monthly_usd - b.price_monthly_usd)

  return {
    usage,
    cheapest: rows[0] || null,
    rows,
    plan_equivalence: {
      reference_model: ref?.name || refId,
      reference_input_per_m: refInput,
      disclaimer: '等效换算为粗略估算：厂商不公开 credit→token 映射，unlimited/auto 档不可比，仅按参考模型输入价折算。',
      plans: planEquiv,
    },
  }
}

function round(x) { return Math.round(x * 1e4) / 1e4 }
