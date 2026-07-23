// store.mjs — read/write JSON data files with safe defaults + atomic writes.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(__dirname, '..')
export const DATA = path.join(ROOT, 'data')
export const PUBLIC = path.join(ROOT, 'public')

const DEFAULTS = {
  'official-api.json': { generated_at: null, sources: [], count: 0, annotations_applied: 0, models: [] },
  'coding-plans.json': { generated_at: null, tools: [] },
  'relays.json': { generated_at: null, relays: [] },
  'subscriptions.json': { subscriptions: [], total_monthly_usd: 0, alerts: [] },
  'rules.json': {
    models: {}, coding_tools: {}, relays: {},
    calculator: { reference_model_id: 'claude-sonnet-4-6' },
    defaults: { new_model_action: 'show_gray' },
  },
}

export async function read(name) {
  const f = path.join(DATA, name)
  if (!existsSync(f)) {
    // fresh clone (subscriptions.json is gitignored): fall back to the committed example
    if (name === 'subscriptions.json') {
      const ex = path.join(DATA, 'subscriptions.example.json')
      if (existsSync(ex)) { try { return JSON.parse(await readFile(ex, 'utf8')) } catch {} }
    }
    return structuredClone(DEFAULTS[name] ?? {})
  }
  try {
    return JSON.parse(await readFile(f, 'utf8'))
  } catch (e) {
    console.error(`[store] failed to parse ${name}: ${e.message}; returning default`)
    return structuredClone(DEFAULTS[name] ?? {})
  }
}

export async function write(name, obj) {
  await mkdir(DATA, { recursive: true })
  const f = path.join(DATA, name)
  const tmp = f + '.tmp'
  await writeFile(tmp, JSON.stringify(obj, null, 2))
  await rename(tmp, f) // atomic on same filesystem
  return obj
}
