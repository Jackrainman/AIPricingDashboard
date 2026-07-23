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

// POST helper: no body → bare POST; with body → JSON-encode it
const post = (url, body) =>
  j(url, body === undefined
    ? { method: 'POST' }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
  compare: () => j('/api/compare'),
  codingPlans: () => j('/api/coding-plans'),
  relays: () => j('/api/relays'),
  subscriptions: () => j('/api/subscriptions'),
  saveSubscriptions: (subscriptions) =>
    j('/api/subscriptions', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscriptions }) }),
  recommendations: () => j('/api/recommendations'),
  dashboard: () => j('/api/dashboard'),
  calculate: (body) => post('/api/calculate', body),
  sync: () => post('/api/sync'),
  checkRelays: () => post('/api/check-relays'),
  usage: () => j('/api/usage'),
  refreshUsage: () => post('/api/usage/refresh'),
  usagePlatforms: () => j('/api/usage/platforms'),
  enableUsagePlatform: (id, config) => post(`/api/usage/platforms/${encodeURIComponent(id)}/enable`, config),
  disableUsagePlatform: (id) =>
    j(`/api/usage/platforms/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
