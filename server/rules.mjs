// rules.mjs — pure rule-engine evaluators. Status: green 🟢 / red 🔴 / gray ⚪ / hidden.
// Priority: explicit entry > tag-level > global default(show_gray). Unknown action -> gray, never throws.

function lc(s) { return (s || '').toLowerCase() }

// find the rule whose key equals or is a substring of the id/name.
// Substring matches go longest-key-first, so a specific key (gpt-5-pro) beats a
// shorter one (gpt-5) that would also match.
function matchRule(table, ...keys) {
  if (!table || typeof table !== 'object') return null
  const targets = keys.map(lc).filter(Boolean)
  const entries = Object.entries(table)
  // exact first
  for (const [k, v] of entries) {
    if (targets.includes(lc(k))) return { key: k, rule: v }
  }
  // substring either direction, most specific (longest) key first
  const byLenDesc = entries.slice().sort((a, b) => b[0].length - a[0].length)
  for (const [k, v] of byLenDesc) {
    const kk = lc(k)
    if (targets.some((t) => t.includes(kk) || kk.includes(t))) return { key: k, rule: v }
  }
  return null
}

// model -> { status, reason, rule_key|null }
export function evalModel(model, rules) {
  const def = rules?.defaults?.new_model_action || 'show_gray'
  const m = matchRule(rules?.models, model.model_id, model.name)
  if (!m) {
    // honor the configured default: hide / show_green / (default) show_gray
    const status = { hide: 'hidden', show_green: 'green', show_gray: 'gray' }[def] ?? 'gray'
    return { status, reason: '未设规则', rule_key: null }
  }
  const r = m.rule || {}
  const action = r.action
  const price = model.input_per_m
  try {
    switch (action) {
      case 'always_show':
        return { status: 'green', reason: '始终关注', rule_key: m.key }
      case 'ignore': {
        const u = r.unless || {}
        if (u.input_price_per_m_below != null && price != null && price < u.input_price_per_m_below) {
          return { status: 'green', reason: `低于 $${u.input_price_per_m_below}/M，破例关注`, rule_key: m.key }
        }
        return { status: 'hidden', reason: '已忽略', rule_key: m.key }
      }
      case 'show_if_below': {
        const thr = r.input_price_per_m_below
        if (thr != null && price != null) {
          return price <= thr
            ? { status: 'green', reason: `≤ $${thr}/M`, rule_key: m.key }
            : { status: 'red', reason: `> $${thr}/M`, rule_key: m.key }
        }
        return { status: 'gray', reason: '阈值缺失', rule_key: m.key }
      }
      default:
        return { status: 'gray', reason: `未知规则(${action ?? '空'})`, rule_key: m.key }
    }
  } catch {
    return { status: 'gray', reason: '规则求值异常', rule_key: m.key }
  }
}

// coding tool -> status. price = cheapest paid plan monthly
export function evalCodingTool(tool, rules) {
  const minPrice = (tool.plans || [])
    .map((p) => p.price_monthly_usd)
    .filter((x) => typeof x === 'number' && x > 0)
    .sort((a, b) => a - b)[0]
  const m = matchRule(rules?.coding_tools, tool.tool, tool.vendor)
  if (!m) return { status: 'gray', reason: '未设规则', rule_key: null }
  const r = m.rule || {}
  try {
    switch (r.action) {
      case 'always_show':
        return { status: 'green', reason: r.current_plan ? `在用 (${r.current_plan})` : '始终关注', rule_key: m.key }
      case 'show_if_below': {
        const thr = r.max_price_monthly
        if (thr != null && minPrice != null) {
          return minPrice <= thr
            ? { status: 'green', reason: `起价 $${minPrice} ≤ $${thr}`, rule_key: m.key }
            : { status: 'red', reason: `起价 $${minPrice} > $${thr}`, rule_key: m.key }
        }
        return { status: 'gray', reason: '阈值缺失', rule_key: m.key }
      }
      case 'ignore':
        return { status: 'hidden', reason: '已忽略', rule_key: m.key }
      default:
        return { status: 'gray', reason: `未知规则(${r.action ?? '空'})`, rule_key: m.key }
    }
  } catch {
    return { status: 'gray', reason: '规则求值异常', rule_key: m.key }
  }
}

// relay -> status from live health only (stale / online / offline)
export function evalRelay(relay) {
  const alive = relay.status === 'online'
  const stale = relay.stale === true
  if (stale) return { status: 'gray', reason: 'STALE（数据过期）', rule_key: null }
  return alive
    ? { status: 'green', reason: `在线 ${relay.response_time_ms ?? '?'}ms`, rule_key: null }
    : { status: 'red', reason: relay.status === 'unknown' ? '未检测' : '离线', rule_key: null }
}
