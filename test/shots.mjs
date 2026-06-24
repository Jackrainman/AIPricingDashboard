// shots.mjs — Playwright smoke render: screenshots the 3 tabs + calculator, asserts zero console errors.
// Resolve Playwright flexibly: set PW_MODULE to a playwright/playwright-core path if not installed in project.
//   PORT=4178 PW_MODULE=/path/to/playwright-core node test/shots.mjs
import { mkdir } from 'node:fs/promises'

const PORT = process.env.PORT || 4178
const OUT = process.env.OUT || new URL('.', import.meta.url).pathname
let PW = process.env.PW_MODULE || 'playwright'
// a bare path to a CommonJS package dir needs the explicit entry file
if (PW.includes('/') && !PW.endsWith('.js')) PW = PW.replace(/\/$/, '') + '/index.js'

const mod = await import(PW)
const chromium = mod.chromium || mod.default?.chromium
if (!chromium) { console.error('could not resolve chromium from', PW); process.exit(2) }

await mkdir(OUT, { recursive: true })
const errors = []
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

const base = `http://localhost:${PORT}`
const shoot = async (name, sel) => {
  try { if (sel) await page.waitForSelector(sel, { timeout: 9000 }) }
  catch (e) { console.log(`  WARN ${name}: ${sel} not found`) }
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/shots-${name}.png`, fullPage: true })
  console.log(`  shots-${name}.png`)
}

await page.goto(base + '/', { waitUntil: 'networkidle', timeout: 15000 })
await shoot('1-dashboard', '.quickbar')
await page.click('button.tab-btn[data-tab="compare"]'); await shoot('2-compare-api', '#api-table tbody tr')
await page.click('button.subtab[data-sub="coding"]'); await shoot('3-compare-coding', '.tool-card')
await page.click('button.tab-btn[data-tab="calculator"]')
await page.waitForSelector('#c-go', { timeout: 9000 }); await page.click('#c-go')
await shoot('4-calculator', '.cheapest-card')

console.log(`\nconsole/page errors: ${errors.length}`)
errors.forEach((e) => console.log('  ' + e))
await browser.close()
process.exit(errors.length ? 1 : 0)
