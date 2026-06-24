// util.js — shared formatters + tiny DOM helpers
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export function money(v, perM = true) {
  if (v == null) return '<span class="muted">—</span>'
  const n = Number(v)
  if (!Number.isFinite(n)) return '<span class="muted">—</span>'
  const s = n < 0.01 && n > 0 ? n.toFixed(4) : n < 1 ? n.toFixed(3) : n.toFixed(2)
  return `$${s}${perM ? '<span class="unit">/M</span>' : ''}`
}

export function usd(v) {
  if (v == null) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return '$' + (Math.abs(n) < 1 ? n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : n.toFixed(2))
}

export function ctx(v) {
  if (v == null) return '<span class="muted">—</span>'
  const n = Number(v)
  if (n >= 1e6) return (n / 1e6) + 'M'
  if (n >= 1000) return Math.round(n / 1000) + 'K'
  return String(n)
}

export const STATUS = {
  green: { dot: '🟢', cls: 'st-green' },
  red: { dot: '🔴', cls: 'st-red' },
  gray: { dot: '⚪', cls: 'st-gray' },
  hidden: { dot: '🚫', cls: 'st-hidden' },
  online: { dot: '🟢', cls: 'st-green' },
  offline: { dot: '🔴', cls: 'st-red' },
  unknown: { dot: '⚪', cls: 'st-gray' },
}
export function dot(status) {
  return (STATUS[status] || STATUS.gray).dot
}

export function tagChips(tags) {
  if (!tags || !tags.length) return ''
  const order = ['flagship', 'coding-optimized', 'coding-capable', 'reasoning', 'agent-bulk', 'vision', 'tool-calling', 'general']
  const sorted = [...tags].sort((a, b) => (order.indexOf(a) + 99 * (order.indexOf(a) < 0)) - (order.indexOf(b) + 99 * (order.indexOf(b) < 0)))
  return sorted.map((t) => `<span class="tag tag-${esc(t)}">${esc(t)}</span>`).join('')
}

export function daysBadge(days) {
  if (days == null) return ''
  if (days < 0) return `<span class="badge badge-danger">逾期 ${-days}天</span>`
  if (days <= 3) return `<span class="badge badge-danger">${days}天</span>`
  if (days <= 7) return `<span class="badge badge-warn">${days}天</span>`
  return `<span class="badge">${days}天</span>`
}

export function fmtDateTime(iso) {
  if (!iso) return '从未'
  try {
    const d = new Date(iso)
    const pad = (x) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch { return iso }
}

export function ago(iso) {
  if (!iso) return '从未'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return iso
  const m = Math.floor(ms / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m}分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}小时前`
  return `${Math.floor(h / 24)}天前`
}

// sparkline from history_24h (online=1, offline=0)
export function sparkline(history) {
  if (!history || !history.length) return ''
  const bars = history.slice(-24).map((h) => {
    const up = h.status === 'online'
    return `<i class="spark ${up ? 'spark-up' : 'spark-down'}" title="${esc(h.time || '')}: ${esc(h.status)}"></i>`
  }).join('')
  return `<span class="sparkline">${bars}</span>`
}

// minimal element factory
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v
    else if (k === 'html') e.innerHTML = v
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v)
    else if (v != null) e.setAttribute(k, v)
  }
  for (const c of children.flat()) {
    if (c == null) continue
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return e
}

export const $ = (sel, root = document) => root.querySelector(sel)
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]
