// app.js — bootstrap, header, tab routing (个人仪表盘 / 对比表 / 计算器) + sidebar
import { renderDashboard } from './dashboard.js'
import { renderCompare, resetCompareCache } from './compare.js'
import { renderCalculator } from './calculator.js'
import { renderUsage } from './usage.js'
import { renderSidebar } from './sidebar.js'
import { api } from './api.js'

const TABS = [
  { id: 'dashboard', label: '个人仪表盘', render: renderDashboard },
  { id: 'compare', label: '对比表', render: renderCompare },
  { id: 'calculator', label: '计算器', render: renderCalculator },
  { id: 'usage', label: '用量', render: renderUsage },
]

let current = 'dashboard'
let renderGen = 0 // bumped on every tab switch; async renders bail if superseded

function switchTab(id) {
  current = id
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === id))
  const main = document.getElementById('tab-content')
  main.dataset.gen = String(++renderGen)
  const tab = TABS.find((t) => t.id === id)
  if (tab) tab.render(main)
  try { history.replaceState(null, '', '#' + id) } catch {}
}

function boot() {
  const app = document.getElementById('app')
  app.innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="logo">◆</span> AI Pricing Dashboard <span class="brand-sub">个人定价看板</span></div>
      <nav class="tabs">
        ${TABS.map((t) => `<button class="tab-btn ${t.id === current ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
      </nav>
      <div class="top-actions">
        <button class="btn btn-sm" id="refresh-data" title="重新同步官方 API 数据">↻ 同步</button>
      </div>
    </header>
    <div class="layout">
      <aside class="sidebar" id="sidebar"></aside>
      <main class="content" id="tab-content"></main>
    </div>
    <div id="toast" class="toast"></div>`

  document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)))
  document.getElementById('refresh-data').addEventListener('click', onRefresh)

  // keyboard: ← / → switch tabs
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return
    const idx = TABS.findIndex((t) => t.id === current)
    if (e.key === 'ArrowRight') switchTab(TABS[(idx + 1) % TABS.length].id)
    else if (e.key === 'ArrowLeft') switchTab(TABS[(idx - 1 + TABS.length) % TABS.length].id)
  })

  renderSidebar(document.getElementById('sidebar'))
  const hash = location.hash.slice(1)
  switchTab(TABS.some((t) => t.id === hash) ? hash : 'dashboard')
}

async function onRefresh() {
  const btn = document.getElementById('refresh-data')
  btn.disabled = true; btn.textContent = '同步中…'
  toast('正在重新同步官方 API 数据…')
  try {
    const r = await api.sync()
    toast(r.code === 0 ? '同步完成 ✓' : '同步脚本返回非 0，详见控制台')
    if (r.code !== 0) console.warn(r)
  } catch (e) { toast('同步失败：' + e.message) }
  btn.disabled = false; btn.textContent = '↻ 同步'
  resetCompareCache() // server data regenerated — drop stale client cache so compare re-fetches
  renderSidebar(document.getElementById('sidebar'))
  const main = document.getElementById('tab-content')
  main.dataset.gen = String(++renderGen)
  const tab = TABS.find((t) => t.id === current)
  if (tab) tab.render(main)
}

let toastTimer
function toast(msg) {
  const t = document.getElementById('toast')
  t.textContent = msg; t.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800)
}

boot()
