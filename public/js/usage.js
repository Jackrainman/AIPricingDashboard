// usage.js — 用量追踪页：平台卡片（状态徽标 / 指标进度条 / 凭据表单）
// 平台列表与表单字段完全由后端 fetcher 的 meta 驱动，新增平台无需改本文件。
import { api } from './api.js'
import { esc, ago, $$ } from './util.js'

const STATUS_BADGE = {
  ok: ['badge-ok', '正常'],
  stale: ['badge-warn', '数据陈旧'],
  auth_expired: ['badge-danger', '登录已过期'],
  error: ['badge-danger', '错误'],
  disabled: ['badge', '未启用'],
}

export async function renderUsage(root) {
  const gen = root.dataset.gen // 与 dashboard.js 一致：异步渲染被新页签取代时放弃
  root.innerHTML = `<div class="loading muted">加载用量数据…</div>`
  let usage, platformsDoc
  try {
    ;[usage, platformsDoc] = await Promise.all([api.usage(), api.usagePlatforms()])
  } catch (e) {
    if (root.dataset.gen === gen) root.innerHTML = `<div class="error">用量数据加载失败：${esc(e.message)}</div>`
    return
  }
  if (root.dataset.gen !== gen) return

  const plist = platformsDoc?.platforms || []
  const byId = Object.fromEntries((usage?.platforms || []).map((p) => [p.id, p]))

  root.innerHTML = `
    <div class="usage-topbar">
      <span class="muted small">平台用量 / 余额追踪 · 平台由 fetcher 文件可插拔注册（scripts/usage/README.md）</span>
      <div class="spacer"></div>
      <button class="btn btn-sm" id="usage-refresh-all">↻ 全部刷新</button>
    </div>
    ${plist.length
      ? `<div class="usage-grid">${plist.map((p) => card(p, byId[p.id])).join('')}</div>`
      : `<div class="panel"><div class="muted small">未发现任何平台 fetcher。把 .mjs 文件放进 scripts/usage/fetchers/ 后重启服务即可。</div></div>`}
  `

  root.querySelector('#usage-refresh-all')?.addEventListener('click', async (e) => {
    const b = e.target; b.disabled = true; b.textContent = '刷新中…'
    try { await api.refreshUsage() } catch {}
    renderUsage(root)
  })
  $$('.act-refresh', root).forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = '刷新中…'
    try { await api.refreshUsage() } catch {} // 后端按平台刷新；单平台失败不影响其他
    renderUsage(root)
  }))
  $$('.act-disable', root).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`禁用 ${b.dataset.name} 并删除其已存凭据？`)) return
    try { await api.disableUsagePlatform(b.dataset.id) } catch (e) { alert('禁用失败：' + e.message) }
    renderUsage(root)
  }))
  $$('.cred-form', root).forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault()
    const id = f.dataset.id
    const config = {}
    f.querySelectorAll('input[data-key]').forEach((inp) => { config[inp.dataset.key] = inp.value })
    const btn = f.querySelector('button[type=submit]')
    btn.disabled = true; btn.textContent = '验证中…'
    try {
      await api.enableUsagePlatform(id, config) // 后端保存后立即尝试刷新一次验证凭据
      renderUsage(root)
    } catch (err) {
      btn.disabled = false; btn.textContent = '保存并验证'
      alert('保存失败：' + err.message)
    }
  }))
}

function card(p, u) {
  const metrics = u?.metrics || []
  return `
  <section class="panel usage-card">
    <div class="panel-head"><h3>${esc(p.displayName)}</h3>${badge(p)}</div>
    ${p.description ? `<div class="muted small" style="margin-bottom:8px">${esc(p.description)}</div>` : ''}
    ${p.status === 'auth_expired' ? `<div class="auth-note">⚠ 登录已过期，请在下方「更新凭据」重新粘贴凭据，保存后自动恢复刷新。</div>` : ''}
    ${p.enabled
      ? (metrics.length ? metrics.map(metricHtml).join('') : `<div class="muted small">暂无数据${p.lastError ? '' : '，等待首次刷新…'}</div>`)
      : `<div class="muted small">未启用。在下方「启用」中填写凭据即可开始追踪。</div>`}
    ${p.enabled ? `<div class="usage-meta muted small">
      数据更新于 ${esc(ago(u?.lastSuccessAt || p.lastSuccessAt))}${u?.stale ? '（刷新失败，显示上次成功的数据）' : ''}
      · 下次刷新 ${esc(nextIn(p.nextRefreshAt))}
    </div>` : ''}
    ${p.lastError && p.status !== 'auth_expired' ? `<div class="usage-err small">${esc(p.lastError)}</div>` : ''}
    <div class="usage-actions">
      ${p.enabled ? `<button class="btn btn-sm act-refresh" data-id="${esc(p.id)}">↻ 刷新</button>` : ''}
      ${credForm(p)}
      ${p.enabled ? `<button class="btn btn-sm act-disable" data-id="${esc(p.id)}" data-name="${esc(p.displayName)}">禁用</button>` : ''}
    </div>
  </section>`
}

function badge(p) {
  if (p.enabled && p.status === 'error' && !p.lastError) return `<span class="badge">等待刷新</span>`
  const [cls, label] = STATUS_BADGE[p.enabled ? p.status : 'disabled'] || STATUS_BADGE.error
  return `<span class="badge ${cls}">${label}</span>`
}

function metricHtml(m) {
  const pct = m.total > 0 ? Math.min(100, (m.used / m.total) * 100) : null
  const cls = pct == null ? '' : pct < 60 ? 'ubar-ok' : pct <= 85 ? 'ubar-warn' : 'ubar-danger'
  const val = m.total != null
    ? `${fmtNum(m.used)}<span class="muted">/${fmtNum(m.total)}</span> ${esc(m.unit)}`
    : `${fmtNum(m.used)} ${esc(m.unit)}`
  return `<div class="usage-metric">
    <div class="um-head"><span>${esc(m.label)}</span><span class="mono">${val}</span></div>
    ${pct != null ? `<div class="ubar"><i class="${cls}" style="width:${pct.toFixed(1)}%"></i></div>` : ''}
    ${m.subtitle || m.resetTime
      ? `<div class="um-sub muted small">${esc(m.subtitle || '')}${m.subtitle && m.resetTime ? ' · ' : ''}${m.resetTime ? esc(resetIn(m.resetTime)) : ''}</div>`
      : ''}
  </div>`
}

// 按 meta.configFields 动态渲染；secret 用 password input，已配置的 secret 留空表示保持不变
function credForm(p) {
  const fields = (p.configFields || []).map((f) => `
    <label class="field">
      <span>${esc(f.label)}${f.optional ? ' <span class="muted">(可选)</span>' : ''}${f.secret && f.configured ? ' <span class="muted">(已配置，留空保持不变)</span>' : ''}</span>
      <input class="input" data-key="${esc(f.key)}" type="${f.secret ? 'password' : 'text'}"
        value="${!f.secret && f.value ? esc(f.value) : ''}" placeholder="${f.secret ? '••••••••' : ''}" autocomplete="off">
      ${f.help ? `<span class="muted small">${esc(f.help)}</span>` : ''}
    </label>`).join('')
  return `<details class="cred-box">
    <summary class="btn btn-sm">${p.enabled ? '更新凭据' : '启用'}</summary>
    <form class="cred-form" data-id="${esc(p.id)}">${fields}
      <div><button class="btn btn-primary btn-sm" type="submit">保存并验证</button></div>
    </form>
  </details>`
}

function fmtNum(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v ?? '—')
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function resetIn(iso) {
  const ms = new Date(iso).getTime() - Date.now()
  if (!Number.isFinite(ms)) return ''
  if (ms <= 0) return '已到期'
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${Math.max(1, m)} 分钟后重置`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时后重置`
  return `${Math.floor(h / 24)} 天后重置`
}

function nextIn(iso) {
  if (!iso) return '—'
  const ms = new Date(iso).getTime() - Date.now()
  if (!Number.isFinite(ms)) return '—'
  if (ms <= 0) return '即将'
  const m = Math.round(ms / 60000)
  if (m < 60) return `${Math.max(1, m)} 分钟后`
  const h = Math.floor(m / 60)
  return `${h} 小时后`
}
