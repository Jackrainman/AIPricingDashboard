// sidebar.js — 性价比之选 (best-value picks + leaderboard)
import { api } from './api.js'
import { esc, money, tagChips } from './util.js'

const CARD_ICON = { overall: '👑', coding: '💻', bulk: '📦', reasoning: '🧠', frontier: '🚀', plan: '🎫' }

export async function renderSidebar(root) {
  root.innerHTML = `<div class="side-head">性价比之选</div><div class="muted small loading">计算中…</div>`
  let data
  try { data = await api.recommendations() } catch (e) {
    root.innerHTML = `<div class="side-head">性价比之选</div><div class="error small">加载失败：${esc(e.message)}</div>`
    return
  }
  const cards = (data.cards || []).map((c) => cardHtml(c)).join('')
  const board = (data.leaderboard || []).map((m, i) => `
    <li>
      <span class="rank">${i + 1}</span>
      <span class="lb-name" title="${esc(m.vendor)}">${esc(m.name)}</span>
      <span class="lb-val mono">${m.value_score}</span>
    </li>`).join('')

  root.innerHTML = `
    <div class="side-head">性价比之选 <span class="side-sub">直接计算</span></div>
    <div class="rec-cards">${cards || '<div class="muted small">暂无（数据同步后出现）</div>'}</div>
    <div class="side-head2">性价比榜 Top10</div>
    <ol class="leaderboard">${board}</ol>
    <div class="method-note small muted" title="${esc(data.method || '')}">ⓘ 启发式排名，非基准测试</div>
  `
}

function cardHtml(c) {
  const p = c.pick || {}
  const isModel = !!p.model_id
  const name = esc(p.name || p.tool || '—')
  const sub = isModel
    ? `<div class="rec-sub mono">${money(p.blended_per_m)} · 能力分 ${p.capability_score}</div>${tagChips((p.tags || []).slice(0, 3))}`
    : `<div class="rec-sub mono">$${esc(p.price)}/月 · ${esc(p.metering || '')}</div><div class="small muted">${esc(p.quota || '')}</div>`
  return `
    <div class="rec-card">
      <div class="rec-title">${CARD_ICON[c.id] || '⭐'} ${esc(c.title)}</div>
      <div class="rec-pick">${name}</div>
      ${sub}
      <div class="rec-why small muted">${esc(c.why || '')}</div>
    </div>`
}
