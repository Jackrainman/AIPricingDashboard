// dashboard.js — 个人仪表盘 (default tab)
import { api } from './api.js'
import { esc, money, usd, dot, tagChips, daysBadge, ago, sparkline, $$ } from './util.js'

export async function renderDashboard(root) {
  const gen = root.dataset.gen // set by app.switchTab; if it changes, a newer tab render superseded us
  root.innerHTML = `<div class="loading muted">加载仪表盘…</div>`
  let d
  try { d = await api.dashboard() } catch (e) {
    if (root.dataset.gen === gen) root.innerHTML = `<div class="error">仪表盘加载失败：${esc(e.message)}</div>`
    return
  }
  if (root.dataset.gen !== gen) return // tab switched away while fetching

  const relayStrip = (d.relays || []).map((r) =>
    `<span class="chip">${dot(r.rule?.status)} ${esc(r.name)} <span class="muted small">${r.response_time_ms != null ? r.response_time_ms + 'ms' : ''}</span></span>`).join('')
  const nextRenew = (d.subscriptions?.alerts || [])[0]

  root.innerHTML = `
    <div class="quickbar">
      <div class="qb-group"><span class="qb-label">中转站</span>${relayStrip || '<span class="muted">无</span>'}</div>
      <div class="qb-group"><span class="qb-label">月费总计</span><span class="qb-big mono">${usd(d.subscriptions?.total_monthly_usd)}</span></div>
      <div class="qb-group"><span class="qb-label">下次续费</span>${nextRenew ? `<span class="chip">${esc(nextRenew.tool)} ${daysBadge(nextRenew.days_until)}</span>` : '<span class="muted">无</span>'}</div>
      <div class="qb-group"><span class="qb-label">模型库</span><span class="mono">${d.counts?.models_first_party}<span class="muted">/${d.counts?.models_total}</span></span></div>
    </div>

    <div class="grid2">
      <section class="panel">
        <div class="panel-head"><h3>我的订阅</h3><button class="btn btn-sm" id="edit-subs">编辑</button></div>
        <div id="subs-list">${subsList(d.subscriptions)}</div>
      </section>

      <section class="panel">
        <div class="panel-head"><h3>中转站健康</h3><button class="btn btn-sm" id="recheck">重新探测</button></div>
        <div id="relay-list">${relayList(d.relays)}</div>
      </section>

      <section class="panel">
        <div class="panel-head"><h3>我在用的 Coding 工具</h3></div>
        ${myTools(d.my_tools)}
      </section>

      <section class="panel">
        <div class="panel-head"><h3>关注的模型 <span class="muted small">(规则命中)</span></h3></div>
        ${watched(d.watched_models)}
      </section>
    </div>

    <div class="updated muted small">API 数据同步于 ${esc(ago(d.api_generated_at))} · 仪表盘 ${esc(ago(d.generated_at))}</div>
  `

  $$('#recheck').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = '探测中…'
    try { await api.checkRelays() } catch {}
    renderDashboard(root)
  }))
  const editBtn = root.querySelector('#edit-subs')
  if (editBtn) editBtn.addEventListener('click', () => openSubsEditor(d.subscriptions?.subscriptions || [], () => renderDashboard(root)))
}

function subsList(subs) {
  const list = subs?.subscriptions || []
  if (!list.length) return `<div class="muted small">还没有订阅。点击「编辑」添加（数据仅存本地，不会上传）。</div>`
  const rows = list.map((s) => {
    const a = (subs.alerts || []).find((x) => x.tool === s.tool)
    return `<div class="sub-row">
      <div class="sub-main"><span class="sub-name">${esc(s.tool)}</span>${a ? daysBadge(a.days_until) : ''}</div>
      <div class="sub-meta mono">${usd(s.price_monthly_usd)}/月 · ${esc(s.renewal_date || '无续费日')} · ${s.auto_renew ? '自动续费' : '手动'}</div>
    </div>`
  }).join('')
  return rows + `<div class="sub-total">合计 <span class="mono">${usd(subs.total_monthly_usd)}/月</span></div>`
}

function relayList(relays) {
  if (!relays?.length) return `<div class="muted small">未配置中转站</div>`
  return relays.map((r) => `
    <div class="relay-row">
      <div class="relay-main">${dot(r.rule?.status)} <span class="relay-name">${esc(r.name)}</span>
        <span class="muted small">${esc(r.rule?.reason || '')}</span></div>
      <div class="relay-spark">${sparkline(r.history_24h)} <span class="muted small">${esc(ago(r.last_check))}</span></div>
    </div>`).join('')
}

function myTools(tools) {
  if (!tools?.length) return `<div class="muted small">数据同步后显示（在 设置/规则 中标记 always_show）。</div>`
  return `<div class="tool-chips">` + tools.map((t) =>
    `<div class="tool-chip">${dot(t.rule?.status)} <b>${esc(t.tool)}</b> <span class="muted small">${esc(t.rule?.reason || '')}</span></div>`).join('') + `</div>`
}

function watched(models) {
  if (!models?.length) return `<div class="muted small">无规则命中的模型</div>`
  return `<table class="mini-table"><tbody>` + models.slice(0, 12).map((m) => `
    <tr>
      <td>${dot(m.rule?.status)}</td>
      <td class="wm-name">${esc(m.name)} <span class="muted small">${esc(m.vendor)}</span></td>
      <td class="mono">${money(m.input_per_m)}</td>
      <td>${tagChips((m.tags || []).slice(0, 2))}</td>
    </tr>`).join('') + `</tbody></table>`
}

// ---- subscription editor modal ----
function openSubsEditor(initial, onSaved) {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  const rowsHtml = (rows) => rows.map((s, i) => `
    <div class="edit-row" data-i="${i}">
      <input class="in-tool" placeholder="工具名" value="${esc(s.tool || '')}">
      <input class="in-price" type="number" step="0.01" placeholder="月费$" value="${s.price_monthly_usd ?? ''}">
      <input class="in-date" type="date" value="${esc(s.renewal_date || '')}">
      <label class="in-auto"><input type="checkbox" ${s.auto_renew ? 'checked' : ''}> 自动</label>
      <input class="in-url" placeholder="取消链接(可选)" value="${esc(s.cancel_url || '')}">
      <button class="btn btn-sm del" title="删除">✕</button>
    </div>`).join('')
  let rows = initial.length ? structuredClone(initial) : [{ tool: '', price_monthly_usd: null, renewal_date: '', auto_renew: true }]
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-head"><h3>编辑订阅</h3><span class="muted small">仅存本地，不上传</span></div>
      <div class="modal-body" id="edit-rows">${rowsHtml(rows)}</div>
      <div class="modal-foot">
        <button class="btn" id="add-row">+ 添加</button>
        <div class="spacer"></div>
        <button class="btn" id="cancel">取消</button>
        <button class="btn btn-primary" id="save">保存</button>
      </div>
    </div>`
  document.body.appendChild(overlay)

  const collect = () => [...overlay.querySelectorAll('.edit-row')].map((r) => ({
    tool: r.querySelector('.in-tool').value.trim(),
    price_monthly_usd: r.querySelector('.in-price').value === '' ? null : Number(r.querySelector('.in-price').value),
    renewal_date: r.querySelector('.in-date').value || null,
    auto_renew: r.querySelector('.in-auto input').checked,
    cancel_url: r.querySelector('.in-url').value.trim() || null,
  })).filter((s) => s.tool)

  overlay.querySelector('#add-row').addEventListener('click', () => {
    rows = collect(); rows.push({ tool: '', price_monthly_usd: null, renewal_date: '', auto_renew: true })
    overlay.querySelector('#edit-rows').innerHTML = rowsHtml(rows); bindDel()
  })
  const bindDel = () => overlay.querySelectorAll('.del').forEach((b) => b.addEventListener('click', (e) => {
    rows = collect(); rows.splice(Number(e.target.closest('.edit-row').dataset.i), 1)
    overlay.querySelector('#edit-rows').innerHTML = rowsHtml(rows); bindDel()
  }))
  bindDel()
  overlay.querySelector('#cancel').addEventListener('click', () => overlay.remove())
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })
  overlay.querySelector('#save').addEventListener('click', async () => {
    const save = overlay.querySelector('#save'); save.disabled = true; save.textContent = '保存中…'
    try { await api.saveSubscriptions(collect()); overlay.remove(); onSaved() }
    catch (err) { save.disabled = false; save.textContent = '保存'; alert('保存失败：' + err.message) }
  })
}
