import { promises as fs } from 'fs'
import path from 'path'

export type PatternType = 'subject' | 'intro' | 'body'
export type PatternStatus = 'active' | 'testing' | 'disabled'

export interface PatternRecord {
  id: string
  type: PatternType
  content: string
  usage_count: number
  open_rate: number
  reply_rate: number
  bounce_rate: number
  score: number
  status: PatternStatus
  last_used_at: string | null
}

export interface PatternMemoryStore {
  version: 2
  patterns: PatternRecord[]
}

const MEMORY_FILE = path.join(process.cwd(), '.sovereign-pattern-memory.json')

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function nowIso(): string {
  return new Date().toISOString()
}

function stableId(input: string): string {
  // Deterministic, stable id without external deps.
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `pat_${(hash >>> 0).toString(16)}`
}

export function createPatternId(type: PatternType, content: string): string {
  return stableId(`${type}:${content.trim().toLowerCase()}`)
}

export function createDefaultStore(): PatternMemoryStore {
  const defaults: Array<{ type: PatternType; content: string; status: PatternStatus }> = [
    { type: 'subject', content: 'Quick idea for {{company}}', status: 'active' },
    { type: 'subject', content: '{{name}}, quick question', status: 'active' },
    { type: 'subject', content: 'Regarding {{company}} growth', status: 'testing' },
    { type: 'intro', content: 'saw your work at {{company}}', status: 'active' },
    { type: 'intro', content: 'noticed what you are building at {{company}}', status: 'testing' },
    { type: 'body', content: 'Are you open to a quick chat this week?', status: 'active' },
  ]

  return {
    version: 2,
    patterns: defaults.map((item) => ({
      id: createPatternId(item.type, item.content),
      type: item.type,
      content: item.content,
      usage_count: 0,
      open_rate: 0,
      reply_rate: 0,
      bounce_rate: 0,
      score: 0,
      status: item.status,
      last_used_at: null,
    })),
  }
}

export async function loadPatternStore(): Promise<PatternMemoryStore> {
  try {
    const raw = await fs.readFile(MEMORY_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<PatternMemoryStore>
    if (parsed.version === 2 && Array.isArray(parsed.patterns)) {
      return {
        version: 2,
        patterns: parsed.patterns
          .filter((p) => Boolean(p && typeof p.id === 'string' && typeof p.type === 'string' && typeof p.content === 'string'))
          .map((p) => ({
            id: String(p.id),
            type: p.type as PatternType,
            content: String(p.content),
            usage_count: Number(p.usage_count ?? 0) || 0,
            open_rate: clamp01(Number(p.open_rate ?? 0)),
            reply_rate: clamp01(Number(p.reply_rate ?? 0)),
            bounce_rate: clamp01(Number(p.bounce_rate ?? 0)),
            score: Number(p.score ?? 0) || 0,
            status: (p.status as PatternStatus) ?? 'testing',
            last_used_at: (p.last_used_at ? String(p.last_used_at) : null),
          })),
      }
    }
    return createDefaultStore()
  } catch {
    return createDefaultStore()
  }
}

export async function savePatternStore(store: PatternMemoryStore): Promise<void> {
  await fs.writeFile(MEMORY_FILE, JSON.stringify(store, null, 2), 'utf8')
}

export async function upsertPattern(input: {
  type: PatternType
  content: string
  status?: PatternStatus
}): Promise<PatternRecord> {
  const content = input.content.trim()
  const id = createPatternId(input.type, content)
  const store = await loadPatternStore()
  const existing = store.patterns.find((p) => p.id === id)

  if (existing) {
    existing.content = content
    existing.status = input.status ?? existing.status
    await savePatternStore(store)
    return existing
  }

  const created: PatternRecord = {
    id,
    type: input.type,
    content,
    usage_count: 0,
    open_rate: 0,
    reply_rate: 0,
    bounce_rate: 0,
    score: 0,
    status: input.status ?? 'testing',
    last_used_at: null,
  }
  store.patterns.push(created)
  await savePatternStore(store)
  return created
}

export async function markPatternUsed(patternId: string): Promise<void> {
  const store = await loadPatternStore()
  const pattern = store.patterns.find((p) => p.id === patternId)
  if (!pattern) return
  pattern.usage_count += 1
  pattern.last_used_at = nowIso()
  await savePatternStore(store)
}

export async function updatePatternRates(patternId: string, rates: {
  open_rate?: number
  reply_rate?: number
  bounce_rate?: number
  score?: number
}): Promise<void> {
  const store = await loadPatternStore()
  const pattern = store.patterns.find((p) => p.id === patternId)
  if (!pattern) return
  if (rates.open_rate !== undefined) pattern.open_rate = clamp01(rates.open_rate)
  if (rates.reply_rate !== undefined) pattern.reply_rate = clamp01(rates.reply_rate)
  if (rates.bounce_rate !== undefined) pattern.bounce_rate = clamp01(rates.bounce_rate)
  if (rates.score !== undefined) pattern.score = rates.score
  await savePatternStore(store)
}

export async function disablePattern(patternId: string): Promise<void> {
  const store = await loadPatternStore()
  const pattern = store.patterns.find((p) => p.id === patternId)
  if (!pattern) return
  pattern.status = 'disabled'
  await savePatternStore(store)
}
