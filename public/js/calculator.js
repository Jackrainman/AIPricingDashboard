// calculator.js — 计算器: 用量场景 → 各模型月成本排名 + Coding Plan 等效换算(估算)
import { api } from './api.js'
import { esc, usd, tagChips, money } from './util.js'

let calcState = { mode: 'tokens', input_mtok: 10, output_mtok: 2, cache_read_mtok: 0, cache_write_mtok: 0,
  sessions: 300, sin: 10000, sout: 3000, provider_type: 'first_party', result: null }

export async function renderCalculator(root) {
  root.innerHTML = `
    <div class="calc-grid">
      <section class="panel calc-input">
        <h3>用量场景（每月）</h3>
        <div class="seg">
          <button class="seg-btn ${calcState.mode === 'tokens' ? 'active' : ''}" data-mode="tokens">按 Token 量</button>
          <button class="seg-btn ${calcState.mode === 'sessions' ? 'active' : ''}" data-mode="sessions">按会话数</button>
        </div>
        <div id="calc-fields"></div>
        <label class="field">
          <span>模型范围</span>
          <select id="c-pt" class="input">
            <option value="first_party" ${calcState.provider_type === 'first_party' ? 'selected' : ''}>一方厂商</option>
            <option value="all" ${calcState.provider_type === 'all' ? 'selected' : ''}>全部来源</option>
          </select>
        </label>
        <button class="btn btn-primary btn-block" id="c-go">计算月成本</button>
        <div class="muted small" style="margin-top:8px">成本 = 输入×单价 + 输出×单价 + 缓存读写×单价（按官方 API 价目）。</div>
      </section>
      <section class="calc-output" id="calc-output">
        <div class="muted">输入用量后点击「计算月成本」。</div>
      </section>
    </div>`

  root.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
    calcState.mode = b.dataset.mode; renderCalculator(root)
  }))
  root.querySelector('#c-pt').addEventListener('change', (e) => { calcState.provider_type = e.target.value })
  root.querySelector('#c-go').addEventListener('click', () => compute(root))
  drawFields(root.querySelector('#calc-fields'))
  if (calcState.result) drawOutput(root.querySelector('#calc-output'), calcState.result)
}

function drawFields(host) {
  if (calcState.mode === 'tokens') {
    host.innerHTML = `
      ${numField('input_mtok', '输入 (百万 token)')}
      ${numField('output_mtok', '输出 (百万 token)')}
      ${numField('cache_read_mtok', '缓存读 (百万, 可选)')}
      ${numField('cache_write_mtok', '缓存写 (百万, 可选)')}`
  } else {
    host.innerHTML = `
      ${numField('sessions', '会话数 / 月')}
      ${numField('sin', '每会话输入 token')}
      ${numField('sout', '每会话输出 token')}
      <div class="muted small">等效 = 会话数 × 每会话 token ÷ 1,000,000 百万 token</div>`
  }
  host.querySelectorAll('input[data-k]').forEach((i) => i.addEventListener('input', (e) => {
    calcState[e.target.dataset.k] = e.target.value === '' ? 0 : Number(e.target.value)
  }))
}
function numField(k, label) {
  return `<label class="field"><span>${esc(label)}</span><input class="input" type="number" min="0" step="any" data-k="${k}" value="${calcState[k]}"></label>`
}

async function compute(root) {
  const out = root.querySelector('#calc-output')
  out.innerHTML = `<div class="loading muted">计算中…</div>`
  const body = calcState.mode === 'tokens'
    ? { input_mtok: calcState.input_mtok, output_mtok: calcState.output_mtok, cache_read_mtok: calcState.cache_read_mtok, cache_write_mtok: calcState.cache_write_mtok }
    : { sessions: calcState.sessions, session_input_tokens: calcState.sin, session_output_tokens: calcState.sout }
  if (calcState.provider_type === 'all') body.provider_types = ['first_party', 'cloud', 'aggregator', 'host']
  try {
    const r = await api.calculate(body)
    calcState.result = r
    drawOutput(out, r)
  } catch (e) { out.innerHTML = `<div class="error">计算失败：${esc(e.message)}</div>` }
}

function drawOutput(out, r) {
  const u = r.usage
  const rows = (r.rows || []).slice(0, 40)
  const cheapest = r.cheapest
  const table = rows.map((m, i) => `
    <tr class="${i === 0 ? 'best-row' : ''}">
      <td class="num muted">${i + 1}</td>
      <td>${esc(m.name)} <span class="m-vendor">${esc(m.vendor)}</span> ${tagChips((m.tags || []).filter((t) => t !== 'general').slice(0, 2))}</td>
      <td class="num mono strong">${usd(m.monthly_cost_usd)}</td>
      <td class="num mono muted">${money(m.input_per_m, false)}/${money(m.output_per_m, false)}</td>
    </tr>`).join('')

  const eq = r.plan_equivalence
  const eqRows = (eq?.plans || []).slice(0, 14).map((p) => `
    <tr class="${p.discontinued ? 'discontinued' : ''}">
      <td>${esc(p.tool)} <span class="muted small">${esc(p.plan)}</span></td>
      <td class="num mono">$${esc(p.price_monthly_usd)}</td>
      <td><span class="tag tag-${esc(p.metering)}">${esc(p.metering)}</span></td>
      <td class="num mono">${esc(p.equiv_input_mtok)}M</td>
    </tr>`).join('')

  out.innerHTML = `
    <div class="calc-summary">
      <div class="muted small">场景：输入 ${u.input_mtok}M · 输出 ${u.output_mtok}M${u.cache_read_mtok ? ` · 缓存读 ${u.cache_read_mtok}M` : ''}${u.cache_write_mtok ? ` · 缓存写 ${u.cache_write_mtok}M` : ''} / 月</div>
      ${cheapest ? `<div class="cheapest-card">最省：<b>${esc(cheapest.name)}</b> <span class="mono strong">${usd(cheapest.monthly_cost_usd)}/月</span></div>` : ''}
    </div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th class="num">#</th><th>模型</th><th class="num">月成本</th><th class="num">输入/输出单价</th></tr></thead>
      <tbody>${table || '<tr><td colspan=4 class="muted">无结果</td></tr>'}</tbody>
    </table></div>

    <div class="eq-section">
      <h3>Coding Plan 等效换算 <span class="badge badge-warn">估算</span></h3>
      <div class="muted small">${esc(eq?.disclaimer || '')} 参考模型：${esc(eq?.reference_model || '')}（输入 $${esc(eq?.reference_input_per_m)}/M）。</div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>订阅</th><th class="num">月费</th><th>计量</th><th class="num">≈ 等效输入(M token)</th></tr></thead>
        <tbody>${eqRows}</tbody>
      </table></div>
    </div>`
}
