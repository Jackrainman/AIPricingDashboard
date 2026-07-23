// compare.js — 对比表: 官方 API 价目表 + Coding Plan 按计量分桶
import { api } from './api.js'
import { esc, money, ctx, dot, tagChips } from './util.js'

let state = {
  sub: 'api', // 'api' | 'coding'
  models: [], vendors: [], tags: [],
  sortKey: 'input_per_m', sortDir: 1,
  q: '', providerType: 'first_party', vendor: '', tag: '', activeOnly: true, chatOnly: true,
  coding: null,
}

// invalidate cached API/coding data so the next render re-fetches (after a data sync)
export function resetCompareCache() {
  state.models = []; state.vendors = []; state.tags = []; state.coding = null
}

export async function renderCompare(root) {
  root.innerHTML = `
    <div class="subtabs">
      <button class="subtab ${state.sub === 'api' ? 'active' : ''}" data-sub="api">官方 API 定价</button>
      <button class="subtab ${state.sub === 'coding' ? 'active' : ''}" data-sub="coding">Coding Plan</button>
    </div>
    <div id="compare-body"><div class="loading muted">加载中…</div></div>`
  root.querySelectorAll('.subtab').forEach((b) => b.addEventListener('click', () => {
    state.sub = b.dataset.sub
    renderCompare(root)
  }))
  const body = root.querySelector('#compare-body')
  if (state.sub === 'api') await renderApi(body)
  else await renderCoding(body)
}

// ---------------- 官方 API ----------------
async function renderApi(body) {
  if (!state.models.length) {
    try {
      const d = await api.compare()
      state.models = d.models; state.vendors = d.vendors; state.tags = d.tags
    } catch (e) { body.innerHTML = `<div class="error">加载失败：${esc(e.message)}</div>`; return }
  }
  if (!body.isConnected) return // tab switched away while fetching — don't paint stale content
  const vendorOpts = ['<option value="">全部厂商</option>']
    .concat(state.vendors.map((v) => `<option value="${esc(v)}" ${state.vendor === v ? 'selected' : ''}>${esc(v)}</option>`)).join('')
  const tagOpts = ['<option value="">全部标签</option>']
    .concat(state.tags.map((t) => `<option value="${esc(t)}" ${state.tag === t ? 'selected' : ''}>${esc(t)}</option>`)).join('')

  body.innerHTML = `
    <div class="filterbar">
      <input id="f-q" class="input" placeholder="搜索模型/厂商…" value="${esc(state.q)}">
      <select id="f-pt" class="input">
        <option value="first_party" ${state.providerType === 'first_party' ? 'selected' : ''}>一方厂商</option>
        <option value="all" ${state.providerType === 'all' ? 'selected' : ''}>全部来源</option>
        <option value="cloud" ${state.providerType === 'cloud' ? 'selected' : ''}>云平台</option>
        <option value="aggregator" ${state.providerType === 'aggregator' ? 'selected' : ''}>聚合(OpenRouter)</option>
        <option value="host" ${state.providerType === 'host' ? 'selected' : ''}>托管</option>
      </select>
      <select id="f-vendor" class="input">${vendorOpts}</select>
      <select id="f-tag" class="input">${tagOpts}</select>
      <label class="chk"><input type="checkbox" id="f-active" ${state.activeOnly ? 'checked' : ''}> 仅在售</label>
      <label class="chk"><input type="checkbox" id="f-chat" ${state.chatOnly ? 'checked' : ''}> 仅对话</label>
      <span class="flex-spacer"></span>
      <span id="f-count" class="muted small"></span>
    </div>
    <div class="table-wrap"><table class="data-table" id="api-table"></table></div>`

  const bind = (id, ev, fn) => { const e = body.querySelector(id); if (e) e.addEventListener(ev, fn) }
  bind('#f-q', 'input', (e) => { state.q = e.target.value; drawApiTable(body) })
  bind('#f-pt', 'change', (e) => { state.providerType = e.target.value; drawApiTable(body) })
  bind('#f-vendor', 'change', (e) => { state.vendor = e.target.value; drawApiTable(body) })
  bind('#f-tag', 'change', (e) => { state.tag = e.target.value; drawApiTable(body) })
  bind('#f-active', 'change', (e) => { state.activeOnly = e.target.checked; drawApiTable(body) })
  bind('#f-chat', 'change', (e) => { state.chatOnly = e.target.checked; drawApiTable(body) })
  drawApiTable(body)
}

const COLS = [
  { key: 'name', label: '模型', sortable: true, num: false },
  { key: 'input_per_m', label: '输入', sortable: true, num: true },
  { key: 'output_per_m', label: '输出', sortable: true, num: true },
  { key: 'cache_read_per_m', label: '缓存读', sortable: true, num: true },
  { key: 'cache_write_per_m', label: '缓存写', sortable: true, num: true },
  { key: 'context_window', label: '上下文', sortable: true, num: true },
  { key: 'max_output', label: '最大输出', sortable: true, num: true },
  { key: 'tags', label: '标签', sortable: false, num: false },
]

function filtered() {
  const q = state.q.trim().toLowerCase()
  return state.models.filter((m) => {
    if (state.activeOnly && m.status !== 'active') return false
    if (state.chatOnly && (m.kind ?? 'chat') !== 'chat') return false
    if (state.providerType !== 'all' && m.provider_type !== state.providerType) return false
    if (state.vendor && m.vendor !== state.vendor) return false
    if (state.tag && !(m.tags || []).includes(state.tag)) return false
    if (q && !(`${m.name} ${m.vendor} ${m.model_id}`.toLowerCase().includes(q))) return false
    return true
  })
}

function drawApiTable(body) {
  const rows = filtered()
  const k = state.sortKey, dir = state.sortDir
  rows.sort((a, b) => {
    let av = a[k], bv = b[k]
    if (k === 'name') return String(av).localeCompare(String(bv)) * dir
    av = av == null ? Infinity : av; bv = bv == null ? Infinity : bv
    return (av - bv) * dir
  })
  const head = `<thead><tr>` + COLS.map((c) => {
    const arrow = state.sortKey === c.key ? (state.sortDir === 1 ? ' ▲' : ' ▼') : ''
    return `<th class="${c.num ? 'num' : ''} ${c.sortable ? 'sortable' : ''}" data-key="${c.key}">${c.label}${arrow}</th>`
  }).join('') + `</tr></thead>`
  const tbody = `<tbody>` + rows.slice(0, 400).map((m) => `
    <tr>
      <td class="cell-name">
        <span class="rule-dot" title="${esc(m.rule?.reason || '')}">${dot(m.rule?.status)}</span>
        <span class="m-name">${esc(m.name)}</span>
        <span class="m-vendor">${esc(m.vendor)}</span>
        ${m.status !== 'active' ? '<span class="badge badge-muted">弃用</span>' : ''}
        ${m.price_note ? `<span class="note-flag" title="${esc(m.price_note)}">ⓘ</span>` : ''}
      </td>
      <td class="num mono">${money(m.input_per_m)}</td>
      <td class="num mono">${money(m.output_per_m)}</td>
      <td class="num mono">${money(m.cache_read_per_m)}</td>
      <td class="num mono">${money(m.cache_write_per_m)}</td>
      <td class="num mono">${ctx(m.context_window)}</td>
      <td class="num mono">${ctx(m.max_output)}</td>
      <td class="cell-tags">${tagChips((m.tags || []).filter((t) => t !== 'general').slice(0, 4))}</td>
    </tr>`).join('') + `</tbody>`
  const table = body.querySelector('#api-table')
  table.innerHTML = head + tbody
  body.querySelector('#f-count').textContent = `${rows.length} 个模型${rows.length > 400 ? '（显示前 400）' : ''}`
  table.querySelectorAll('th.sortable').forEach((th) => th.addEventListener('click', () => {
    const key = th.dataset.key
    if (state.sortKey === key) state.sortDir *= -1
    else { state.sortKey = key; state.sortDir = 1 }
    drawApiTable(body)
  }))
}

// ---------------- Coding Plan ----------------
const BUCKETS = [
  { key: 'token', label: '按 Token 计量', desc: '自带 key / 按实际 token 消耗付费' },
  { key: 'price', label: '按额度($)计量', desc: '美元额度池 / AI Credits，按花费扣减' },
  { key: 'count', label: '按次数计量', desc: '按请求 / 消息 / agent 次数计费' },
  { key: 'other', label: '其他计量', desc: '时间窗倍率 / 不公开 token 数 / 包月不限' },
]

async function renderCoding(body) {
  if (!state.coding) {
    try { state.coding = await api.codingPlans() } catch (e) { body.innerHTML = `<div class="error">加载失败：${esc(e.message)}</div>`; return }
  }
  if (!body.isConnected) return // tab switched away while fetching
  const tools = state.coding.tools || []
  const sections = BUCKETS.map((bk) => {
    const inBucket = tools.filter((t) => t.metering_category === bk.key)
    if (!inBucket.length) return ''
    return `
      <section class="bucket">
        <div class="bucket-head"><h3>${esc(bk.label)} <span class="muted small">${esc(bk.desc)}</span></h3><span class="bucket-count">${inBucket.length}</span></div>
        <div class="tool-grid">${inBucket.map(toolCard).join('')}</div>
      </section>`
  }).join('')
  body.innerHTML = `<div class="coding-intro muted small">按计量方式分桶对比 AI 编程订阅。价格随官网变动，数据更新于 ${esc(state.coding.today || '')}。</div>${sections}`
}

function toolCard(t) {
  const plans = (t.plans || []).map((p) => `
    <tr>
      <td class="plan-name">${esc(p.name)}</td>
      <td class="num mono">${p.price_monthly_usd == null ? '<span class="muted">免费/用量</span>' : '$' + p.price_monthly_usd}</td>
      <td class="plan-quota">${esc(p.quota || '')}</td>
    </tr>`).join('')
  const mine = t.my_status?.current_plan
  return `
    <div class="tool-card ${t.discontinued ? 'discontinued' : ''}">
      <div class="tool-card-head">
        <a href="${esc(t.url)}" target="_blank" rel="noopener" class="tool-name">${esc(t.tool)}</a>
        ${t.discontinued ? '<span class="badge badge-danger">已停服/停新注册</span>' : ''}
        ${mine ? `<span class="badge badge-ok">在用 ${esc(mine)}</span>` : ''}
      </div>
      <div class="tool-vendor muted small">${esc(t.vendor)} · ${esc(t.metering_reason || '')}</div>
      <table class="plan-table"><tbody>${plans}</tbody></table>
    </div>`
}
