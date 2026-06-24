// api.js — thin fetch client for the dashboard backend
async function j(url, opts) {
  const res = await fetch(url, opts)
  if (!res.ok) {
    let detail = ''
    try { detail = (await res.json()).error || '' } catch {}
    throw new Error(`${url} → HTTP ${res.status} ${detail}`)
  }
  return res.json()
}

export const api = {
  officialApi: () => j('/api/official-api'),
  compare: () => j('/api/compare'),
  codingPlans: () => j('/api/coding-plans'),
  relays: () => j('/api/relays'),
  subscriptions: () => j('/api/subscriptions'),
  saveSubscriptions: (subscriptions) =>
    j('/api/subscriptions', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscriptions }) }),
  rules: () => j('/api/rules'),
  saveRules: (rules) =>
    j('/api/rules', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rules) }),
  recommendations: () => j('/api/recommendations'),
  dashboard: () => j('/api/dashboard'),
  calculate: (body) =>
    j('/api/calculate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  sync: () => j('/api/sync', { method: 'POST' }),
  checkRelays: () => j('/api/check-relays', { method: 'POST' }),
}
