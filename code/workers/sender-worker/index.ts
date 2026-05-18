import 'dotenv/config'
import { Worker as BullWorker, Queue as BullQueue, type Job } from 'bullmq'
import IORedis from 'ioredis'
import { Pool } from 'pg'
import crypto from 'crypto'
import os from 'os'
import { decide } from '@sovereign/decision-engine'
import { rotateInbox, enforceCaps } from '@sovereign/sending-engine'
import { ingestEvent } from '@sovereign/tracking-engine'
import { updateDomainStats, getDomainScore } from '@sovereign/reputation-engine'
import { sendSmtp } from '@sovereign/smtp-client'
import { ContentMutationService, type ContentMutationResult } from '@sovereign/content-mutation'
import { recipientApprovalBlockers, type RecipientGuardrailContact } from './recipient-guardrails'
import {
  computeAdaptiveThroughput,
  loadDomainSignals,
  type AdaptiveControlSignal,
  type AdaptiveState,
  type ProviderSignals,
} from '@sovereign/adaptive-controller'
import { detectProvider, getProviderPolicy } from '@sovereign/provider-engine'
import type { DbExecutor, TrackingIngestEvent, ValidationVerdict, Lane } from '@sovereign/types'

type SendJob = {
  clientId: number
  campaignId?: number
  contactId?: number
  queueJobId?: number
  sequenceStep?: number
  toEmail: string
  subject: string
  html?: string
  text?: string
  idempotencyKey?: string
}

const SEND_QUEUE = process.env.SEND_QUEUE ?? 'xv-send-queue'
const SEND_DLQ = process.env.SEND_DLQ ?? 'xv-send-dlq'
const MAX_SEND_ATTEMPTS = Number(process.env.SEND_MAX_ATTEMPTS ?? 6)
const ADAPTIVE_CANARY = process.env.ADAPTIVE_CANARY === 'true'
const ADAPTIVE_EXPERIMENT = process.env.ADAPTIVE_EXPERIMENT === 'true'
function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw == null) return fallback
  const v = String(raw).trim().toLowerCase()
  if (!v) return fallback
  if (v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 'on') return true
  if (v === '0' || v === 'false' || v === 'no' || v === 'n' || v === 'off') return false
  return fallback
}

const SEND_ALLOW_UNKNOWN_VALIDATION = envBool('SEND_ALLOW_UNKNOWN_VALIDATION', true)
const MOCK_SMTP = envBool('MOCK_SMTP', false)
const MOCK_SMTP_FASTLANE = MOCK_SMTP && envBool('MOCK_SMTP_FASTLANE', false)

// Legacy API-gateway queue (minimal JSON payloads).
// The current API enqueues into this queue to preserve `pnpm dev` parity.
const LEGACY_READY_QUEUE = process.env.LEGACY_READY_QUEUE ?? 'email:queue'
const LEGACY_SCHEDULED_QUEUE = process.env.LEGACY_SCHEDULED_QUEUE ?? 'email:queue:scheduled'
const LEGACY_PROCESSING_QUEUE = process.env.LEGACY_PROCESSING_QUEUE ?? 'email:queue:processing'
const LEGACY_VISIBILITY_ZSET = process.env.LEGACY_VISIBILITY_ZSET ?? 'email:queue:visibility'
const LEGACY_VISIBILITY_TIMEOUT_SEC = Number(process.env.LEGACY_VISIBILITY_TIMEOUT_SEC ?? 5 * 60)
const LEGACY_LOOP_BATCH_SIZE = Math.max(
  1,
  Math.min(Number(process.env.LEGACY_LOOP_BATCH_SIZE ?? 10), 100)
)

function reqEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

function readJsonArray(name: string): any[] {
  const raw = process.env[name]
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function stableIndex(key: string, mod: number) {
  if (mod <= 1) return 0
  // Use a stable hash so any idempotency key format works (not just hex prefixes).
  const hex = crypto.createHash('sha256').update(String(key)).digest('hex')
  const n = parseInt(hex.slice(0, 8), 16)
  return n % mod
}

function intEnv(name: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = Number.parseInt(String(process.env[name] ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return clamp(n, min, max)
}

const PG_POOL_MAX = intEnv('PG_POOL_MAX', 5, 1, 50)
const PG_POOL_IDLE_TIMEOUT_MS = intEnv('PG_POOL_IDLE_TIMEOUT_MS', 30_000, 1_000, 10 * 60_000)
const PG_POOL_CONNECTION_TIMEOUT_MS = intEnv('PG_POOL_CONNECTION_TIMEOUT_MS', 5_000, 500, 60_000)
const FASTLANE_COMPLETION_BATCH_SIZE = intEnv('FASTLANE_COMPLETION_BATCH_SIZE', 500, 25, 5_000)
const FASTLANE_COMPLETION_FLUSH_MS = intEnv('FASTLANE_COMPLETION_FLUSH_MS', 500, 50, 5_000)
const pool = new Pool({
  connectionString: reqEnv('DATABASE_URL'),
  max: PG_POOL_MAX,
  idleTimeoutMillis: PG_POOL_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: PG_POOL_CONNECTION_TIMEOUT_MS,
})
const redis = new IORedis(reqEnv('REDIS_URL'))
const REGION = process.env.XV_REGION ?? 'local'
const GLOBAL_SENDS_PER_MINUTE = Number(process.env.GLOBAL_SENDS_PER_MINUTE ?? 120)
const GLOBAL_SHAPER_RATE_PER_SEC = Number(process.env.GLOBAL_SHAPER_RATE_PER_SEC ?? 2) // tokens/sec
const GLOBAL_SHAPER_BURST = Number(process.env.GLOBAL_SHAPER_BURST ?? 10) // max tokens
const WORKER_CONCURRENCY = Number(process.env.SENDER_WORKER_CONCURRENCY ?? 10)
const WORKER_ID =
  process.env.WORKER_ID ??
  `${os.hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`
const WORKER_HEARTBEAT_INTERVAL_MS = Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS ?? 15_000)
const WORKER_HEARTBEAT_TTL_SEC = Number(process.env.WORKER_HEARTBEAT_TTL_SEC ?? 60)
const WORKER_STARTED_AT = new Date().toISOString()
const WORKER_HEARTBEAT_KEY = `xv:${REGION}:workers:sender:${WORKER_ID}`
const WORKER_ROTATION_SEND_LIMIT = Number(process.env.WORKER_ROTATION_SEND_LIMIT ?? 5_000)
const WORKER_ROTATION_MAX_AGE_MS = Number(process.env.WORKER_ROTATION_MAX_AGE_MS ?? 24 * 60 * 60_000)
const WORKER_ROTATION_DRAIN_MS = Number(process.env.WORKER_ROTATION_DRAIN_MS ?? 15_000)
const LICENSING_CONTROL_URL = process.env.LICENSING_CONTROL_URL ?? ''
const LICENSING_KEY = process.env.LICENSING_KEY ?? ''
const LICENSING_HEARTBEAT_INTERVAL_MS = Number(process.env.LICENSING_HEARTBEAT_INTERVAL_MS ?? 60_000)
const LICENSING_FAIL_CLOSED = envBool('LICENSING_FAIL_CLOSED', false)
const LICENSING_LOCK_TTL_SEC = Number(process.env.LICENSING_LOCK_TTL_SEC ?? 120)
let heartbeatTimer: NodeJS.Timeout | null = null
let licenseTimer: NodeJS.Timeout | null = null
let bullWorker: BullWorker<SendJob> | null = null
let workerProcessedSends = 0
let workerDraining = false
let workerRotationReason: string | null = null
let workerRetirementTimer: NodeJS.Timeout | null = null
let activeLegacyBatches = 0
let licenseState: 'not_configured' | 'active' | 'revoked' | 'unreachable' = LICENSING_CONTROL_URL && LICENSING_KEY ? 'unreachable' : 'not_configured'
let licenseCheckedAt: string | null = null
let lastCpuUsage = process.cpuUsage()
let lastCpuSampleAt = Date.now()

const dlq = new BullQueue<SendJob>(SEND_DLQ, { connection: { url: reqEnv('REDIS_URL') } })
const sendQueue = new BullQueue<SendJob>(SEND_QUEUE, { connection: { url: reqEnv('REDIS_URL') } })
const contentMutations = new ContentMutationService({ redis, region: REGION })
const fastlaneSelectionCache = new Map<string, { expiresAt: number; selection: Awaited<ReturnType<typeof rotateInbox>> }>()
const fastlaneCompletionBatches = new Map<number, { ids: Set<number>; timer: NodeJS.Timeout | null; flushing: boolean }>()

const SMTP_HOST = reqEnv('SMTP_HOST')
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 587)
const SMTP_SECURE = process.env.SMTP_SECURE === 'true'
const SMTP_ACCOUNTS = readJsonArray('SMTP_ACCOUNTS')
  .map((x) => ({ user: String(x?.user ?? ''), pass: String(x?.pass ?? '') }))
  .filter((x) => x.user && x.pass)

type SenderAccount = { user: string; pass: string }

function cleanEmail(raw: unknown): string {
  const email = String(raw ?? '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

function emailDomain(raw: unknown): string {
  return cleanEmail(raw).split('@')[1] ?? ''
}

function providerModeFromEnv(): 'smtp' | 'brevo' | 'resend' {
  const explicit = String(process.env.EMAIL_PROVIDER || process.env.SEND_PROVIDER || '').trim().toLowerCase()
  if (explicit === 'resend' || explicit.startsWith('re_') || explicit.includes('resend_api_key=')) return 'resend'
  if (explicit === 'brevo' || explicit.startsWith('xsmtpsib-') || explicit.includes('brevo_api_key=')) return 'brevo'
  if (process.env.BREVO_API_KEY) return 'brevo'
  if (process.env.RESEND_API_KEY) return 'resend'
  return 'smtp'
}

function firstConfiguredSendingEmail(): string {
  const raw = String(process.env.BOOTSTRAP_SENDING_EMAILS ?? '').trim()
  if (!raw) return ''

  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return cleanEmail(parsed.find((item) => cleanEmail(item)) ?? '')
    }
  } catch {
    // Also support comma/newline-separated env values from hosting dashboards.
  }

  return cleanEmail(raw.split(/[\n,;]/).find((item) => cleanEmail(item)) ?? '')
}

function preferredEspFromAddress(): string {
  return (
    cleanEmail(process.env.SMTP_FROM_EMAIL) ||
    cleanEmail(process.env.RESEND_FROM_EMAIL) ||
    cleanEmail(process.env.SEND_FROM_EMAIL) ||
    firstConfiguredSendingEmail()
  )
}

function selectSenderAccount(idemKey: string): SenderAccount {
  const provider = providerModeFromEnv()
  const preferredFrom = preferredEspFromAddress()

  if ((provider === 'resend' || provider === 'brevo') && preferredFrom) {
    const matched = SMTP_ACCOUNTS.find((account) => cleanEmail(account.user) === preferredFrom)
    return { user: preferredFrom, pass: matched?.pass ?? process.env.SMTP_PASS ?? '' }
  }

  if ((provider === 'resend' || provider === 'brevo') && SMTP_ACCOUNTS.length > 0) {
    const preferredDomain = String(
      process.env.BOOTSTRAP_SENDING_DOMAIN || process.env.RESEND_SENDING_DOMAIN || ''
    )
      .trim()
      .toLowerCase()
    const matched = preferredDomain
      ? SMTP_ACCOUNTS.find((account) => emailDomain(account.user) === preferredDomain)
      : undefined
    return matched ?? SMTP_ACCOUNTS[0]!
  }

  if (SMTP_ACCOUNTS.length > 0) return SMTP_ACCOUNTS[stableIndex(idemKey, SMTP_ACCOUNTS.length)]!

  return { user: reqEnv('SMTP_USER'), pass: reqEnv('SMTP_PASS') }
}

const GLOBAL_RISK_SLOWDOWN_FACTOR = 0.75
const GLOBAL_RISK_WINDOW_SEC = 60 * 60 // 1h
const GLOBAL_RISK_THRESHOLD = 3 // domains spiking before applying slowdown

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function sampleCanary(idemKey: string) {
  // Stable 10% sampling based on idempotency key.
  const n = parseInt(idemKey.slice(0, 8), 16)
  return (n % 100) < 10
}

function experimentGroup(idemKey: string): 'adaptive' | 'baseline' {
  const n = parseInt(idemKey.slice(0, 8), 16)
  return (n % 100) < 50 ? 'adaptive' : 'baseline'
}

type SmtpClass = 'deferral' | 'block' | 'bounce' | 'unknown'

function maskEmail(raw: unknown): string {
  const email = String(raw ?? '').trim().toLowerCase()
  const [local, domain] = email.split('@')
  if (!local || !domain) return email ? '[redacted]' : ''
  const visible = local.length <= 2 ? local[0] ?? '*' : `${local[0]}***${local[local.length - 1]}`
  return `${visible}@${domain}`
}

function sanitizeLogValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeLogValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => {
        const lower = key.toLowerCase()
        if (lower.includes('pass') || lower.includes('secret') || lower.includes('token')) return [key, '[redacted]']
        if (lower.includes('email') || lower === 'to' || lower === 'from') return [key, maskEmail(item)]
        return [key, sanitizeLogValue(item)]
      })
    )
  }
  if (typeof value === 'string' && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(value)) {
    return value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (email) => maskEmail(email))
  }
  return value
}

function truncateText(raw: unknown, maxLen: number): string {
  const s = String(raw ?? '')
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen) + `\n\n...[truncated ${s.length - maxLen} chars]`
}

function classifySmtpFailure(err: any): { smtpClass: SmtpClass; responseCode: number | null } {
  const code = Number(err?.responseCode ?? err?.code ?? err?.response?.statusCode ?? NaN)
  const msg = String(err?.response ?? err?.message ?? '').toLowerCase()
  const responseCode = Number.isFinite(code) ? code : null

  // 4xx => temporary deferral unless the provider explicitly says policy/blacklist.
  if (responseCode && responseCode >= 400 && responseCode < 500) {
    if (
      msg.includes('blocked') ||
      msg.includes('blacklist') ||
      msg.includes('policy') ||
      msg.includes('spam')
    ) {
      return { smtpClass: 'block', responseCode }
    }
    return { smtpClass: 'deferral', responseCode }
  }

  // 5xx => hard failures. Some are "block" (policy), others are bounce.
  if (responseCode && responseCode >= 500 && responseCode < 600) {
    if (msg.includes('blocked') || msg.includes('blacklist') || msg.includes('policy') || msg.includes('spam')) {
      return { smtpClass: 'block', responseCode }
    }
    return { smtpClass: 'bounce', responseCode }
  }

  return { smtpClass: 'unknown', responseCode }
}

// Atomic Redis token bucket (anti-burst).
const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local rate = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local ttl_sec = tonumber(ARGV[5])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then tokens = burst end
if ts == nil then ts = now_ms end

local delta = math.max(0, now_ms - ts)
local refill = (delta / 1000.0) * rate
tokens = math.min(burst, tokens + refill)

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call('HSET', key, 'tokens', tokens, 'ts', now_ms)
redis.call('EXPIRE', key, ttl_sec)
return { allowed, tokens }
`

async function takeGlobalToken(clientId: number): Promise<boolean> {
  const key = `xv:${REGION}:shaper:global:${clientId}`
  const now = Date.now()
  const [allowed] = (await redis.eval(
    TOKEN_BUCKET_LUA,
    1,
    key,
    String(GLOBAL_SHAPER_RATE_PER_SEC),
    String(GLOBAL_SHAPER_BURST),
    String(now),
    '1',
    '120'
  )) as any
  return Number(allowed) === 1
}

async function takeTokenBucket(key: string, ratePerSecond: number, burst: number, ttlSec = 300): Promise<boolean> {
  if (ratePerSecond <= 0 || burst <= 0) return false
  const [allowed] = (await redis.eval(
    TOKEN_BUCKET_LUA,
    1,
    key,
    String(ratePerSecond),
    String(burst),
    String(Date.now()),
    '1',
    String(ttlSec)
  )) as any
  return Number(allowed) === 1
}

function parseLaneSignal(raw: string | null): AdaptiveControlSignal | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as AdaptiveControlSignal
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.provider || !Number.isFinite(Number(parsed.maxPerHour))) return null
    return parsed
  } catch {
    return null
  }
}

async function loadLaneSignal(clientId: number, domainId: number, provider: string): Promise<AdaptiveControlSignal | null> {
  const key = `xv:${REGION}:adaptive:lane:${clientId}:${domainId}:${provider}`
  const cached = parseLaneSignal(await redis.get(key))
  if (cached) return cached

  const res = await db<{
    state: AdaptiveControlSignal['state']
    max_per_hour: number | string
    max_per_minute: number | string
    max_concurrency: number | string
    cooldown_until: string | null
    reasons: any
    metrics_snapshot: any
  }>(
    `SELECT state, max_per_hour, max_per_minute, max_concurrency, cooldown_until, reasons, metrics_snapshot
     FROM reputation_state
     WHERE client_id = $1 AND domain_id = $2 AND provider = $3
     LIMIT 1`,
    [clientId, domainId, provider]
  ).catch(() => ({ rows: [], rowCount: 0 }))

  const row = res.rows[0]
  if (!row) return null
  const maxPerHour = Number(row.max_per_hour ?? 50)
  const signal: AdaptiveControlSignal = {
    clientId,
    domainId,
    provider: provider as any,
    state: row.state,
    action: row.state === 'paused' ? 'pause' : 'hold',
    maxPerHour,
    maxPerMinute: Math.max(0, Number(row.max_per_minute ?? Math.ceil(maxPerHour / 60))),
    maxConcurrency: Math.max(0, Number(row.max_concurrency ?? 1)),
    ratePerSecond: maxPerHour > 0 ? maxPerHour / 3600 : 0,
    burst: maxPerHour > 0 ? Math.max(1, Math.min(25, Math.ceil(maxPerHour / 12))) : 0,
    jitterPct: 0.15,
    cooldownUntil: row.cooldown_until,
    reasons: Array.isArray(row.reasons) ? row.reasons.map(String) : [],
    metrics: {
      deferralRate1h: Number(row.metrics_snapshot?.metrics?.deferralRate1h ?? 0),
      blockRate1h: Number(row.metrics_snapshot?.metrics?.blockRate1h ?? 0),
      sendSuccessRate1h: Number(row.metrics_snapshot?.metrics?.sendSuccessRate1h ?? 1),
      seedPlacementInboxRate: Number(row.metrics_snapshot?.metrics?.seedPlacementInboxRate ?? 1),
      providerRisk: Number(row.metrics_snapshot?.metrics?.providerRisk ?? 0),
    },
  }
  await redis.set(key, JSON.stringify(signal), 'EX', 60 * 5).catch(() => {})
  return signal
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

type LegacyQueuePayload = {
  id: number | string
  client_id: number | string
  campaign_id: number | string
  contact_id: number | string
  sequence_step: number
  scheduled_at: string
  idempotency_key?: string
  to_email?: string
  subject?: string
  body?: string
  text?: string
  html?: string
  stress_fastlane?: boolean
}

async function backfillLegacyFromDb(limit = 25) {
  // Safety net: if Redis queue state is lost (restart/deploy/manual flush),
  // republish due DB jobs so the legacy bridge can continue to make progress.
  const res = await db<{
    id: number
    client_id: number
    campaign_id: number
    contact_id: number
    sequence_step: number
    scheduled_at: any
    idempotency_key: string | null
    status: string
    reserved_at: any
  }>(
    `SELECT id, client_id, campaign_id, contact_id, sequence_step, scheduled_at, idempotency_key, status, reserved_at
     FROM queue_jobs
     WHERE (
         (status IN ('pending','retry') AND scheduled_at <= CURRENT_TIMESTAMP)
         OR (status = 'processing' AND (reserved_at IS NULL OR reserved_at < (CURRENT_TIMESTAMP - INTERVAL '10 minutes')))
       )
     ORDER BY scheduled_at ASC
     LIMIT $1`,
    [limit]
  )

  if (!res.rows.length) return 0

  let published = 0
  for (const row of res.rows) {
    const idemKey = `email:idem:${row.id}`
    const ok = await redis.set(idemKey, '1', 'EX', 60 * 60 * 24 * 7, 'NX')
    if (!ok) continue

    const scheduledAt = row.scheduled_at instanceof Date ? row.scheduled_at.toISOString() : new Date(row.scheduled_at).toISOString()
    const payload: LegacyQueuePayload = {
      id: row.id,
      client_id: row.client_id,
      campaign_id: row.campaign_id,
      contact_id: row.contact_id,
      sequence_step: row.sequence_step,
      scheduled_at: scheduledAt,
      idempotency_key: row.idempotency_key ?? undefined,
    }
    await redis.rpush(LEGACY_READY_QUEUE, JSON.stringify(payload))
    published += 1

    if (row.status === 'processing') {
      await db(
        `UPDATE queue_jobs
         SET status = 'retry',
             last_error = COALESCE(last_error, 'recovered_from_stale_processing'),
             updated_at = CURRENT_TIMESTAMP
         WHERE client_id = $1 AND id = $2 AND status = 'processing'`,
        [row.client_id, row.id]
      ).catch(() => {})
    }
  }

  if (published > 0) {
    console.warn('[sender-worker] backfilled legacy queue from DB due jobs', { published })
  }
  return published
}

async function promoteLegacyDue(limit = 10) {
  const now = Date.now()
  const due = (await redis.zrangebyscore(LEGACY_SCHEDULED_QUEUE, 0, now, 'LIMIT', 0, limit)) as string[]
  if (!due.length) return 0
  const pipeline = redis.pipeline()
  for (const item of due) {
    pipeline.zrem(LEGACY_SCHEDULED_QUEUE, item)
    pipeline.rpush(LEGACY_READY_QUEUE, item)
  }
  await pipeline.exec()
  return due.length
}

async function reclaimLegacyVisibility(limit = 25) {
  const now = Date.now()
  const expired = (await redis.zrangebyscore(LEGACY_VISIBILITY_ZSET, 0, now, 'LIMIT', 0, limit)) as string[]
  if (!expired.length) return 0

  const pipeline = redis.pipeline()
  for (const item of expired) {
    pipeline.zrem(LEGACY_VISIBILITY_ZSET, item)
    pipeline.lrem(LEGACY_PROCESSING_QUEUE, 1, item)
    pipeline.rpush(LEGACY_READY_QUEUE, item)
  }
  await pipeline.exec()
  console.warn('[sender-worker] reclaimed legacy visibility items', { count: expired.length })
  return expired.length
}

async function ackLegacyPayload(raw: string) {
  const pipeline = redis.pipeline()
  pipeline.zrem(LEGACY_VISIBILITY_ZSET, raw)
  pipeline.lrem(LEGACY_PROCESSING_QUEUE, 1, raw)
  await pipeline.exec()
}

async function flushFastlaneCompletionBatch(clientId: number) {
  const batch = fastlaneCompletionBatches.get(clientId)
  if (!batch || batch.flushing || batch.ids.size === 0) return
  batch.flushing = true
  if (batch.timer) {
    clearTimeout(batch.timer)
    batch.timer = null
  }
  const ids = Array.from(batch.ids)
  batch.ids.clear()
  try {
    await db(
      `UPDATE queue_jobs
       SET status = 'completed',
           completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = ANY($2::bigint[])`,
      [clientId, ids]
    )
  } finally {
    batch.flushing = false
    if (batch.ids.size > 0) {
      batch.timer = setTimeout(() => void flushFastlaneCompletionBatch(clientId), FASTLANE_COMPLETION_FLUSH_MS)
      batch.timer.unref?.()
    }
  }
}

async function markLegacyCompleted(clientId: number, queueJobId: number) {
  if (!queueJobId) return
  if (!MOCK_SMTP_FASTLANE) {
    await db(
      `UPDATE queue_jobs
       SET status = 'completed',
           completed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2`,
      [clientId, queueJobId]
    ).catch(() => {})
    return
  }

  let batch = fastlaneCompletionBatches.get(clientId)
  if (!batch) {
    batch = { ids: new Set<number>(), timer: null, flushing: false }
    fastlaneCompletionBatches.set(clientId, batch)
  }
  batch.ids.add(queueJobId)
  if (batch.ids.size >= FASTLANE_COMPLETION_BATCH_SIZE) {
    await flushFastlaneCompletionBatch(clientId)
    return
  }
  if (!batch.timer) {
    batch.timer = setTimeout(() => void flushFastlaneCompletionBatch(clientId), FASTLANE_COMPLETION_FLUSH_MS)
    batch.timer.unref?.()
  }
}

function parseRetryLater(msg: string): { backoffMs: number } | null {
  if (!msg.startsWith('retry_later:')) return null
  if (msg.includes('db_capacity')) return { backoffMs: jitterMs(20_000, 0.75) }
  if (msg.includes('provider_lane_paused')) return { backoffMs: jitterMs(10 * 60_000, 0.15) }
  if (msg.includes('adaptive_lane_bucket')) return { backoffMs: jitterMs(60_000, 0.15) }
  if (msg.includes('adaptive_throttle')) return { backoffMs: jitterMs(25_000, 0.3) }
  if (msg.includes('domain_concurrency_cap')) return { backoffMs: jitterMs(10_000, 0.5) }
  if (msg.includes('global_shaper')) return { backoffMs: jitterMs(15_000, 0.4) }
  if (msg.includes('global_cap')) return { backoffMs: jitterMs(45_000, 0.2) }
  if (msg.includes('inflight_lock')) return { backoffMs: jitterMs(8_000, 0.6) }
  if (msg.includes('recent_failure')) return { backoffMs: jitterMs(60_000, 0.2) }
  if (msg.includes('worker_rotation_draining')) return { backoffMs: jitterMs(30_000, 0.3) }
  if (msg.includes('license_lockdown')) return { backoffMs: jitterMs(120_000, 0.2) }
  return { backoffMs: jitterMs(30_000, 0.3) }
}

function isDbCapacityError(msg: string) {
  const v = String(msg || '').toLowerCase()
  return (
    v.includes('too many clients') ||
    v.includes('remaining connection slots') ||
    v.includes('connection terminated unexpectedly') ||
    v.includes('timeout exceeded when trying to connect') ||
    v.includes('connection terminated due to connection timeout') ||
    v.includes('53300')
  )
}

async function computeSmartSmtpRetry(input: {
  clientId: number
  domainId?: number | null
  provider: string
  retryCount: number
  smtpClass: SmtpClass
  responseCode: number | null
}): Promise<{ backoffMs: number; reason: string; laneState: string | null } | null> {
  if (input.smtpClass !== 'deferral') return null
  if (input.responseCode && (input.responseCode < 400 || input.responseCode >= 500)) return null

  const retryCount = Math.max(0, Math.min(10, input.retryCount))
  let laneState: string | null = null
  let maxPerHour: number | null = null

  if (input.domainId) {
    const res = await db<{ state: string; max_per_hour: string | number }>(
      `SELECT state, max_per_hour
       FROM reputation_state
       WHERE client_id = $1 AND domain_id = $2 AND provider = $3
       LIMIT 1`,
      [input.clientId, input.domainId, input.provider]
    ).catch(() => ({ rows: [], rowCount: 0 }))
    laneState = res.rows[0]?.state ?? null
    maxPerHour = res.rows[0] ? Number(res.rows[0].max_per_hour ?? 0) : null
  }

  const throttled = laneState
    ? ['warmup', 'degraded', 'cooldown', 'paused'].includes(laneState) || Number(maxPerHour ?? 0) <= 50
    : false
  const base = throttled ? 10 * 60_000 : 5 * 60_000
  const multiplier = throttled ? Math.pow(2, retryCount) : Math.max(1, retryCount + 1)
  const maxDelay = Number(process.env.SMART_RETRY_MAX_DELAY_MS ?? 6 * 60 * 60_000)
  const backoffMs = jitterMs(Math.min(maxDelay, base * multiplier), 0.2)

  return {
    backoffMs,
    laneState,
    reason: throttled ? 'smtp_4xx_deferral_lane_throttled' : 'smtp_4xx_deferral_lane_checked',
  }
}

async function requeueLegacyRaw(raw: string, backoffMs: number) {
  if (backoffMs <= 0) {
    await redis.rpush(LEGACY_READY_QUEUE, raw)
    return
  }
  await redis.zadd(LEGACY_SCHEDULED_QUEUE, Date.now() + backoffMs, raw)
}

async function buildSendJobFromLegacy(payload: LegacyQueuePayload): Promise<SendJob | null> {
  const qjId = Number(payload.id)
  const clientId = Number(payload.client_id)
  if (!Number.isFinite(qjId) || !Number.isFinite(clientId)) return null

  if (
    MOCK_SMTP_FASTLANE &&
    payload.stress_fastlane &&
    payload.to_email &&
    payload.subject &&
    (payload.text || payload.body || payload.html)
  ) {
    return {
      clientId,
      campaignId: Number(payload.campaign_id),
      contactId: Number(payload.contact_id),
      queueJobId: qjId,
      sequenceStep: Number(payload.sequence_step ?? 0),
      toEmail: String(payload.to_email),
      subject: String(payload.subject),
      text: payload.text ?? payload.body,
      html: payload.html,
      idempotencyKey: payload.idempotency_key || undefined,
    }
  }

  const res = await db<{
    queue_job_id: number
    campaign_id: number
    contact_id: number
    to_email: string
    subject: string
    body: string
    sequence_step: number
    idempotency_key: string | null
  }>(
    `SELECT
       qj.id AS queue_job_id,
       qj.campaign_id,
       qj.contact_id,
       c.email AS to_email,
       ss.subject AS subject,
       ss.body AS body,
       qj.sequence_step,
       qj.idempotency_key
     FROM queue_jobs qj
     JOIN contacts c ON c.id = qj.contact_id AND c.client_id = qj.client_id
     JOIN campaigns ca ON ca.id = qj.campaign_id AND ca.client_id = qj.client_id
     JOIN sequence_steps ss ON ss.sequence_id = ca.sequence_id AND ss.step_index = qj.sequence_step
     WHERE qj.client_id = $1 AND qj.id = $2
     LIMIT 1`,
    [clientId, qjId]
  )
  const row = res.rows[0]
  if (!row) return null

  return {
    clientId,
    campaignId: Number(row.campaign_id),
    contactId: Number(row.contact_id),
    queueJobId: Number(row.queue_job_id),
    sequenceStep: Number(row.sequence_step ?? payload.sequence_step ?? 0),
    toEmail: row.to_email,
    subject: row.subject,
    text: row.body,
    idempotencyKey: (payload.idempotency_key ?? row.idempotency_key ?? undefined) || undefined,
  }
}

async function processLegacyRaw(raw: string) {
  let payload: LegacyQueuePayload | null = null
  try {
    payload = JSON.parse(raw) as LegacyQueuePayload
  } catch {
    await ackLegacyPayload(raw).catch(() => {})
    return
  }

  let job: SendJob | null = null
  try {
    job = await buildSendJobFromLegacy(payload)
  } catch (err) {
    const msg = (err as any)?.message ?? String(err)
    if (isDbCapacityError(msg)) {
      const backoffMs = jitterMs(20_000, 0.75)
      await ackLegacyPayload(raw).catch(() => {})
      await requeueLegacyRaw(raw, backoffMs)
      console.warn('[sender-worker] legacy job deferred before hydration', {
        id: payload?.id,
        reason: 'retry_later:db_capacity',
        backoffMs,
      })
      return
    }
    throw err
  }
  if (!job) {
    await ackLegacyPayload(raw).catch(() => {})
    return
  }

  await redis.zadd(LEGACY_VISIBILITY_ZSET, Date.now() + LEGACY_VISIBILITY_TIMEOUT_SEC * 1000, raw)

  // Best-effort DB state transition (keeps UI coherent).
  if (!MOCK_SMTP_FASTLANE) {
    await db(
      `UPDATE queue_jobs
       SET status = 'processing', reserved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2 AND status = 'pending'`,
      [job.clientId, job.queueJobId ?? 0]
    ).catch(() => {})
  }

  if (!MOCK_SMTP_FASTLANE) {
    console.log('[sender-worker] legacy send start', {
      queueJobId: job.queueJobId,
      campaignId: job.campaignId,
      to: maskEmail(job.toEmail),
    })
  }

  try {
    await runSend(job)
  } catch (err) {
    const msg = (err as any)?.message ?? String(err)
    const retry = parseRetryLater(msg)
    const capacityRetry = isDbCapacityError(msg)
      ? { backoffMs: jitterMs(20_000, 0.75), reason: 'retry_later:db_capacity', laneState: null }
      : undefined
    const smartRetry =
      capacityRetry ??
      ((err as any)?.smartRetry as { backoffMs: number; reason: string; laneState: string | null } | undefined)
    if (retry || smartRetry) {
      const backoffMs = retry?.backoffMs ?? smartRetry!.backoffMs
      const reason = retry ? msg : smartRetry!.reason
      await db(
        `UPDATE queue_jobs
         SET status = 'retry',
             attempts = attempts + 1,
             last_error = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE client_id = $1 AND id = $2`,
        [job.clientId, job.queueJobId ?? 0, String(sanitizeLogValue(reason))]
      ).catch(() => {})

      await ackLegacyPayload(raw).catch(() => {})
      await requeueLegacyRaw(raw, backoffMs)
      console.warn('[sender-worker] legacy job deferred', {
        queueJobId: job.queueJobId,
        reason,
        backoffMs,
        laneState: smartRetry?.laneState ?? null,
      })
      return
    }

    await db(
      `UPDATE queue_jobs
       SET status = 'failed',
           attempts = attempts + 1,
           last_error = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2`,
      [job.clientId, job.queueJobId ?? 0, String(sanitizeLogValue(msg))]
    ).catch(() => {})

    await ackLegacyPayload(raw).catch(() => {})
    console.error('[sender-worker] legacy job failed', { queueJobId: job.queueJobId, err: sanitizeLogValue(msg) })
    return
  }

  await markLegacyCompleted(job.clientId, job.queueJobId ?? 0)

  await ackLegacyPayload(raw).catch(() => {})
  if (!MOCK_SMTP_FASTLANE) {
    console.log('[sender-worker] legacy send completed', { queueJobId: job.queueJobId })
  }
}

async function runLegacyQueueLoop() {
  console.log('[sender-worker] legacy queue bridge enabled', {
    ready: LEGACY_READY_QUEUE,
    scheduled: LEGACY_SCHEDULED_QUEUE,
    processing: LEGACY_PROCESSING_QUEUE,
    visibility: LEGACY_VISIBILITY_ZSET,
    batchSize: LEGACY_LOOP_BATCH_SIZE,
  })

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      if (workerDraining) {
        await sleep(250)
        continue
      }

      const promoted = await promoteLegacyDue(25)
      if (promoted > 0) {
        console.log('[sender-worker] promoted legacy scheduled items', { promoted })
      }

      await reclaimLegacyVisibility(25)

      // If Redis has nothing ready but DB has due jobs, republish them.
      if (promoted === 0) {
        const readyLen = Number((await redis.llen(LEGACY_READY_QUEUE)) ?? 0)
        if (readyLen === 0) {
          await backfillLegacyFromDb(25).catch(() => {})
        }
      }

      const raws: string[] = []
      for (let i = 0; i < LEGACY_LOOP_BATCH_SIZE; i += 1) {
        const raw = (await redis.lmove(LEGACY_READY_QUEUE, LEGACY_PROCESSING_QUEUE, 'LEFT', 'RIGHT')) as string | null
        if (!raw) break
        raws.push(raw)
      }
      if (!raws.length) continue

      activeLegacyBatches += 1
      try {
        await Promise.allSettled(raws.map((raw) => processLegacyRaw(raw)))
      } finally {
        activeLegacyBatches = Math.max(0, activeLegacyBatches - 1)
      }
    } catch (err) {
      console.error('[sender-worker] legacy queue loop error', err)
      await sleep(1000)
    }
  }
}

function jitterMs(base: number, pct = 0.15) {
  const j = base * pct
  return Math.max(0, Math.floor(base + (Math.random() * 2 - 1) * j))
}

async function rotateInboxForSend(clientId: number, lane: Lane) {
  if (!MOCK_SMTP_FASTLANE) return rotateInbox({ db }, clientId, lane)
  const key = `${clientId}:${lane}`
  const cached = fastlaneSelectionCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.selection
  const selection = await rotateInbox({ db }, clientId, lane)
  if (selection) {
    fastlaneSelectionCache.set(key, { selection, expiresAt: Date.now() + 30_000 })
  }
  return selection
}

async function getBestHours(clientId: number, domainId: number): Promise<number[] | null> {
  const cacheKey = `xv:${REGION}:adaptive:best_hours:${clientId}:${domainId}`
  const cached = await redis.get(cacheKey)
  if (cached) {
    try {
      const v = JSON.parse(cached)
      if (Array.isArray(v) && v.every((n) => Number.isFinite(n))) return v as number[]
    } catch {}
  }

  // Compute top hours by reply rate over last 7 days; require some volume for signal.
  const res = await db<{ hour: number; sent: string; reply: string }>(
    `SELECT
       EXTRACT(HOUR FROM created_at)::int AS hour,
       COUNT(*) FILTER (WHERE event_type='sent')::text AS sent,
       COUNT(*) FILTER (WHERE event_type='reply')::text AS reply
     FROM events
     WHERE client_id = $1 AND domain_id = $2
       AND created_at > (CURRENT_TIMESTAMP - INTERVAL '7 days')
       AND event_type IN ('sent','reply')
     GROUP BY 1
     ORDER BY 1`,
    [clientId, domainId]
  )

  const scored = res.rows
    .map((r) => {
      const sent = Number(r.sent ?? 0)
      const reply = Number(r.reply ?? 0)
      const rate = sent >= 20 ? reply / Math.max(sent, 1) : -1
      return { hour: r.hour, rate, sent }
    })
    .filter((x) => x.rate >= 0)
    .sort((a, b) => b.rate - a.rate)

  const best = scored.slice(0, 3).map((x) => x.hour)
  if (!best.length) return null
  await redis.set(cacheKey, JSON.stringify(best), 'EX', 6 * 60 * 60)
  return best
}

const db: DbExecutor = async (sql, params = []) => {
  const res = await pool.query(sql, params as any[])
  return { rows: res.rows as any[], rowCount: res.rowCount ?? 0 }
}

async function bootstrapFromSnapshots() {
  // Partial recovery: restore only missing Redis keys from DB snapshots.
  // Never overwrite fresh keys.
  try {
    await redis.ping()
  } catch (err) {
    console.error('[sender-worker] redis unavailable; entering degraded conservative mode', { err: (err as any)?.message ?? String(err) })
    // Degraded mode: no ramp; keep deploy conservative factor longer.
    await redis.set(`xv:${REGION}:deploy:conservative`, '0.5', 'EX', 30 * 60)
    return
  }

  const activeDomains = await db<{ client_id: number; domain_id: number }>(
    `SELECT client_id, id AS domain_id
     FROM domains
     WHERE status = 'active'`
  )

  for (const d of activeDomains.rows) {
    const stateKey = `xv:${REGION}:adaptive:state:${d.client_id}:${d.domain_id}`
    const exists = await redis.get(stateKey)
    if (exists) continue

    const snap = await db<{ throughput_current: any; cooldown_active: boolean; created_at: string }>(
      `SELECT throughput_current, cooldown_active, created_at
       FROM adaptive_state_snapshots
       WHERE client_id = $1 AND domain_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [d.client_id, d.domain_id]
    )
    const row = snap.rows[0]
    if (!row) continue

    const restored = {
      throughputCurrent: Math.max(2, Math.min(10, Number(row.throughput_current ?? 2))),
      cooldownUntil: row.cooldown_active ? Date.now() + 30 * 60_000 : 0,
      restoredFrom: 'snapshot',
      snapshotCreatedAt: row.created_at,
    }
    await redis.set(stateKey, JSON.stringify(restored), 'EX', 60 * 60 * 24 * 7)
    console.log('[sender-worker] snapshot_restored', { clientId: d.client_id, domainId: d.domain_id })
    await recordMetric(d.client_id, 'snapshot_restored', 1, { domainId: d.domain_id })
  }

  // Provider risk restore (best-effort).
  const providers: Array<'gmail' | 'outlook' | 'yahoo' | 'other'> = ['gmail', 'outlook', 'yahoo', 'other']
  const clientIdsRes = await db<{ client_id: number }>(`SELECT DISTINCT client_id FROM domains`)
  for (const row of clientIdsRes.rows) {
    for (const p of providers) {
      const riskKey = `xv:${REGION}:adaptive:provider_risk:${row.client_id}:${p}`
      const exists = await redis.get(riskKey)
      if (exists) continue
      const snap = await db<{ throttle_factor: any; created_at: string }>(
        `SELECT throttle_factor, created_at
         FROM provider_health_snapshots
         WHERE client_id = $1 AND provider = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [row.client_id, p]
      )
      const s = snap.rows[0]
      if (!s) continue
      const throttle = Math.max(0, Math.min(0.5, Number(s.throttle_factor ?? 0)))
      if (throttle <= 0) continue
      await redis.set(riskKey, String(throttle), 'EX', 60 * 60)
      console.log('[sender-worker] snapshot_restored_provider', { clientId: row.client_id, provider: p, throttle })
      await recordMetric(row.client_id, 'snapshot_restored', 1, { provider: p })
    }
  }
}

async function lookupValidation(email: string): Promise<{ verdict: ValidationVerdict; score: number; catchAll?: boolean }> {
  const normalized = String(email || '').trim().toLowerCase()
  const res = await db<{ verdict: ValidationVerdict; score: string | number; catch_all: any }>(
    `SELECT verdict, score, catch_all
     FROM email_validations
     WHERE normalized_email = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [normalized]
  )
  const row = res.rows[0]
  if (!row) return { verdict: 'unknown', score: 0.5 }
  const catchAll = Boolean((row as any).catch_all?.isCatchAll ?? (row as any).catch_all?.catchAll)
  return { verdict: row.verdict, score: Number(row.score ?? 0), catchAll }
}

async function loadRecipientGuardrailBlockers(job: SendJob): Promise<string[]> {
  if (!job.contactId) return []

  const res = await db<RecipientGuardrailContact>(
    `SELECT
       email,
       status,
       verification_status,
       bounced_at::text AS bounced_at,
       unsubscribed_at::text AS unsubscribed_at,
       custom_fields
     FROM contacts
     WHERE client_id = $1 AND id = $2
     LIMIT 1`,
    [job.clientId, job.contactId]
  )

  return recipientApprovalBlockers(res.rows[0] ?? null, job.toEmail)
}

async function handleTracking(event: TrackingIngestEvent) {
  await ingestEvent({ db }, event)
  if (MOCK_SMTP_FASTLANE) return
  try {
    await updateDomainStats({ db }, event)
  } catch (err) {
    const code = (err as any)?.code
    const message = (err as any)?.message ?? String(err)
    if (code === '40P01' || code === '40001' || /deadlock detected/i.test(message)) {
      await sleep(jitterMs(150, 0.5))
      try {
        await updateDomainStats({ db }, event)
        return
      } catch (retryErr) {
        console.warn('[sender-worker] reputation counter update skipped after retry', {
          code: (retryErr as any)?.code ?? null,
          err: sanitizeLogValue((retryErr as any)?.message ?? String(retryErr)),
        })
        return
      }
    }
    console.warn('[sender-worker] reputation counter update skipped', {
      code: code ?? null,
      err: sanitizeLogValue(message),
    })
  }
}

async function recordMetric(clientId: number, name: string, value: number, metadata?: Record<string, unknown>) {
  try {
    await db(`INSERT INTO system_metrics (client_id, metric_name, metric_value, metadata) VALUES ($1,$2,$3,$4::jsonb)`, [
      clientId,
      name,
      value,
      JSON.stringify(metadata ?? {}),
    ])
  } catch (err) {
    console.warn('[sender-worker] metric insert failed', { name, err: (err as any)?.message ?? String(err) })
  }
}

async function writeWorkerHeartbeat() {
  const uptimeMs = Math.max(0, Date.now() - new Date(WORKER_STARTED_AT).getTime())
  const memory = process.memoryUsage()
  const now = Date.now()
  const cpuDelta = process.cpuUsage(lastCpuUsage)
  const elapsedMs = Math.max(1, now - lastCpuSampleAt)
  const cpuPercent = Math.max(0, ((cpuDelta.user + cpuDelta.system) / 1000 / elapsedMs) * 100)
  lastCpuUsage = process.cpuUsage()
  lastCpuSampleAt = now
  const rssMb = Math.round((memory.rss / 1024 / 1024) * 100) / 100
  const heapUsedMb = Math.round((memory.heapUsed / 1024 / 1024) * 100) / 100
  const externalMb = Math.round((memory.external / 1024 / 1024) * 100) / 100
  await redis
    .set(
      WORKER_HEARTBEAT_KEY,
      JSON.stringify({
        workerId: WORKER_ID,
        role: 'sender',
        queue: SEND_QUEUE,
        region: REGION,
        host: os.hostname(),
        pid: process.pid,
        concurrency: WORKER_CONCURRENCY,
        legacyLoopBatchSize: LEGACY_LOOP_BATCH_SIZE,
        pgPoolMax: PG_POOL_MAX,
        mockSmtp: MOCK_SMTP,
        desiredState: workerDraining ? 'draining' : 'active',
        processedSends: workerProcessedSends,
        uptimeMs,
        resources: {
          rssMb,
          heapUsedMb,
          externalMb,
          cpuPercent: Math.round(cpuPercent * 100) / 100,
          memoryMbPer10kSends:
            workerProcessedSends > 0
              ? Math.round((rssMb / Math.max(workerProcessedSends / 10_000, 1)) * 100) / 100
              : null,
        },
        rotation: {
          sendLimit: WORKER_ROTATION_SEND_LIMIT,
          maxAgeMs: WORKER_ROTATION_MAX_AGE_MS,
          reason: workerRotationReason,
        },
        license: {
          state: licenseState,
          checkedAt: licenseCheckedAt,
          failClosed: LICENSING_FAIL_CLOSED,
        },
        startedAt: WORKER_STARTED_AT,
        lastSeenAt: new Date().toISOString(),
      }),
      'EX',
      WORKER_HEARTBEAT_TTL_SEC
    )
    .catch((err) => {
      console.warn('[sender-worker] heartbeat failed', { err: (err as any)?.message ?? String(err) })
    })
}

async function scheduleWorkerRetirement(reason: string) {
  if (workerDraining) return
  workerDraining = true
  workerRotationReason = reason
  await redis
    .set(
      `xv:${REGION}:workers:sender_retire:${WORKER_ID}`,
      JSON.stringify({
        workerId: WORKER_ID,
        reason,
        processedSends: workerProcessedSends,
        startedAt: WORKER_STARTED_AT,
        retiringAt: new Date().toISOString(),
      }),
      'EX',
      Math.max(60, Math.ceil(WORKER_ROTATION_DRAIN_MS / 1000) + 60)
    )
    .catch(() => {})
  await writeWorkerHeartbeat()
  await bullWorker?.pause(true).catch(() => {})
  console.warn('[sender-worker] entering graceful rotation drain', {
    workerId: WORKER_ID,
    reason,
    processedSends: workerProcessedSends,
    drainMs: WORKER_ROTATION_DRAIN_MS,
  })
  const drainDeadline = Date.now() + WORKER_ROTATION_DRAIN_MS
  const drainAndShutdown = async () => {
    while (activeLegacyBatches > 0 && Date.now() < drainDeadline) {
      await sleep(250)
    }
    await shutdown(`ROTATE_${reason}`)
  }
  workerRetirementTimer = setTimeout(() => void drainAndShutdown(), 250)
  workerRetirementTimer.unref?.()
}

function checkWorkerRotation() {
  if (workerDraining) return
  if (WORKER_ROTATION_SEND_LIMIT > 0 && workerProcessedSends >= WORKER_ROTATION_SEND_LIMIT) {
    void scheduleWorkerRetirement('send_limit_reached')
    return
  }
  if (WORKER_ROTATION_MAX_AGE_MS > 0 && Date.now() - new Date(WORKER_STARTED_AT).getTime() >= WORKER_ROTATION_MAX_AGE_MS) {
    void scheduleWorkerRetirement('max_age_reached')
  }
}

async function setLicenseLockdown(reason: string) {
  await redis
    .set(
      `xv:${REGION}:license:lockdown`,
      JSON.stringify({
        workerId: WORKER_ID,
        reason,
        state: licenseState,
        checkedAt: licenseCheckedAt ?? new Date().toISOString(),
      }),
      'EX',
      LICENSING_LOCK_TTL_SEC
    )
    .catch(() => {})
}

async function checkLicenseHeartbeat() {
  if (!LICENSING_CONTROL_URL || !LICENSING_KEY) return
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)
  try {
    const res = await fetch(LICENSING_CONTROL_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${LICENSING_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        workerId: WORKER_ID,
        role: 'sender',
        region: REGION,
        processedSends: workerProcessedSends,
        startedAt: WORKER_STARTED_AT,
        checkedAt: new Date().toISOString(),
      }),
      signal: controller.signal,
    })
    licenseCheckedAt = new Date().toISOString()
    if (!res.ok) {
      licenseState = res.status === 401 || res.status === 403 ? 'revoked' : 'unreachable'
    } else {
      const payload = (await res.json().catch(() => ({}))) as { status?: string; active?: boolean; revoked?: boolean }
      licenseState = payload.revoked || payload.active === false || payload.status === 'revoked' ? 'revoked' : 'active'
    }
  } catch {
    licenseCheckedAt = new Date().toISOString()
    licenseState = 'unreachable'
  } finally {
    clearTimeout(timeout)
  }

  if (licenseState === 'revoked' || (licenseState === 'unreachable' && LICENSING_FAIL_CLOSED)) {
    await setLicenseLockdown(licenseState === 'revoked' ? 'license_revoked' : 'license_unreachable_fail_closed')
  }
  await writeWorkerHeartbeat()
}

function startLicenseHeartbeat() {
  if (!LICENSING_CONTROL_URL || !LICENSING_KEY) return
  void checkLicenseHeartbeat()
  licenseTimer = setInterval(() => void checkLicenseHeartbeat(), LICENSING_HEARTBEAT_INTERVAL_MS)
  licenseTimer.unref?.()
}

async function stopLicenseHeartbeat() {
  if (licenseTimer) {
    clearInterval(licenseTimer)
    licenseTimer = null
  }
}

async function assertWorkerCanAccept(job: SendJob) {
  if (workerDraining) {
    await recordMetric(job.clientId, 'retry_count', 1, { scope: 'worker', reason: 'worker_rotation_draining' })
    throw new Error('retry_later:worker_rotation_draining')
  }
  const lockdown = await redis.get(`xv:${REGION}:license:lockdown`)
  if (lockdown) {
    await recordMetric(job.clientId, 'retry_count', 1, { scope: 'worker', reason: 'license_lockdown' })
    throw new Error('retry_later:license_lockdown')
  }
}

function startWorkerHeartbeat() {
  void writeWorkerHeartbeat()
  heartbeatTimer = setInterval(() => {
    checkWorkerRotation()
    void writeWorkerHeartbeat()
  }, WORKER_HEARTBEAT_INTERVAL_MS)
  heartbeatTimer.unref?.()
}

async function stopWorkerHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  await redis.del(WORKER_HEARTBEAT_KEY).catch(() => {})
}

async function resolveIdempotencyKey(job: SendJob, bullJobId: string | number | undefined): Promise<string> {
  if (job.idempotencyKey) return job.idempotencyKey

  if (job.queueJobId) {
    const res = await db<{ idempotency_key: string | null }>(
      `SELECT idempotency_key
       FROM queue_jobs
       WHERE client_id = $1 AND id = $2
       LIMIT 1`,
      [job.clientId, job.queueJobId]
    )
    const k = res.rows[0]?.idempotency_key
    if (k) return k
  }

  // Fallback: stable per BullMQ job id (prevents duplicates from retries/crashes).
  const fallbackPayload = `${job.clientId}|${String(job.toEmail || '').trim().toLowerCase()}|${job.campaignId ?? 0}|${String(bullJobId ?? '')}`
  return crypto.createHash('sha256').update(fallbackPayload).digest('hex').slice(0, 40)
}

async function runSend(job: SendJob, bull?: Pick<Job<SendJob>, 'id' | 'attemptsMade'>) {
  const bullJobId = bull?.id
  const idemKey = await resolveIdempotencyKey(job, bullJobId)
  const doneKey = `xv:${REGION}:send:done:${job.clientId}:${idemKey}`
  const inflightKey = `xv:${REGION}:send:inflight:${job.clientId}:${idemKey}`
  const failedKey = `xv:${REGION}:send:failed:${job.clientId}:${idemKey}`
  let selectedDomainId: number | null = null
  let recipientProviderForRun = 'other'
  let outboundSubject = job.subject
  let outboundText = job.text
  let outboundHtml = job.html
  let mutationResult: ContentMutationResult | null = null

  // Back-compat: if older keys exist (pre-region), respect them so we don't re-send.
  const legacyDoneKey = `xv:send:done:${job.clientId}:${idemKey}`

  const alreadyDone = (await redis.get(doneKey)) ?? (await redis.get(legacyDoneKey))
  if (alreadyDone) {
    console.warn('[sender-worker] duplicate suppressed (already done)', { bullJobId, queueJobId: job.queueJobId, idemKey })
    await recordMetric(job.clientId, 'idempotency_hits', 1, { scope: 'worker', state: 'done' })
    await recordMetric(job.clientId, 'duplicate_send_prevented', 1, { scope: 'worker', reason: 'done' })
    return
  }

  await assertWorkerCanAccept(job)

  const recentlyFailed = await redis.get(failedKey)
  if (recentlyFailed) {
    await recordMetric(job.clientId, 'retry_count', 1, { scope: 'worker', reason: 'recent_failure' })
    throw new Error('retry_later:recent_failure')
  }

  // In-flight lock to prevent concurrent duplicate sends.
  const inflightOk = await redis.set(inflightKey, String(bullJobId ?? 'job'), 'EX', 10 * 60, 'NX')
  if (!inflightOk) {
    console.warn('[sender-worker] duplicate suppressed (inflight)', { bullJobId, queueJobId: job.queueJobId, idemKey })
    await recordMetric(job.clientId, 'inflight_conflicts', 1, { scope: 'worker' })
    await recordMetric(job.clientId, 'duplicate_send_prevented', 1, { scope: 'worker', reason: 'inflight' })
    // Let BullMQ retry later; inflight TTL ensures crash recovery.
    throw new Error('retry_later:inflight_lock')
  }

  let expGroup: 'adaptive' | 'baseline' | null = null
  let fromAddress = ''

  try {
    if (!MOCK_SMTP_FASTLANE) {
      console.log('[sender-worker] send attempt start', {
        bullJobId,
        queueJobId: job.queueJobId,
        campaignId: job.campaignId,
        to: maskEmail(job.toEmail),
        idemKey,
      })
    }

    const recipientGuardrailBlockers = MOCK_SMTP_FASTLANE ? [] : await loadRecipientGuardrailBlockers(job)
    if (recipientGuardrailBlockers.length > 0) {
      const normalizedTo = String(job.toEmail || '').trim().toLowerCase()
      const reason = `pre_send_guardrail:${recipientGuardrailBlockers.join(',')}`
      console.warn('[sender-worker] pre-send guardrail blocked recipient', {
        bullJobId,
        queueJobId: job.queueJobId,
        to: maskEmail(normalizedTo),
        blockers: recipientGuardrailBlockers,
      })

      await handleTracking({
        type: 'FAILED',
        clientId: job.clientId,
        campaignId: job.campaignId ?? null,
        contactId: job.contactId ?? null,
        queueJobId: job.queueJobId ?? null,
        metadata: {
          event_code: 'EMAIL_BLOCKED',
          reason: 'pre_send_guardrail',
          guardrail_blockers: recipientGuardrailBlockers,
          to_email: normalizedTo,
          subject: outboundSubject,
          body_text: truncateText(outboundText, 20_000),
          body_html: truncateText(outboundHtml, 40_000),
          idempotency_key: idemKey,
        },
      })

      if (job.queueJobId) {
        await db(
          `UPDATE queue_jobs
           SET status = 'skipped',
               last_error = $3,
               completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
               updated_at = CURRENT_TIMESTAMP
           WHERE client_id = $1 AND id = $2`,
          [job.clientId, job.queueJobId, reason]
        ).catch(() => {})
      }

      await redis.set(doneKey, '1', 'EX', 60 * 60 * 24 * 7)
      await redis.set(legacyDoneKey, '1', 'EX', 60 * 60 * 24 * 7)
      await redis.del(inflightKey)
      await redis.del(failedKey)
      await recordMetric(job.clientId, 'pre_send_guardrail_blocked', 1, {
        blockers: recipientGuardrailBlockers,
      })
      return
    }

    const useCanary = ADAPTIVE_CANARY ? sampleCanary(idemKey) : true
    expGroup = ADAPTIVE_EXPERIMENT ? experimentGroup(idemKey) : null
    const useAdaptiveControl = expGroup ? expGroup === 'adaptive' : true

    // Jitter injection: avoid batchy patterns. Internal mock fastlane keeps videos/tests snappy without touching real SMTP.
    await sleep(MOCK_SMTP_FASTLANE ? 0 : jitterMs(250, 0.8))

    // Global cap safety: queue instead of sending if we exceed global throughput.
    // This protects domains during load spikes.
    const minuteBucket = new Date().toISOString().slice(0, 16) // minute bucket
    if (!MOCK_SMTP_FASTLANE) {
      const globalKey = `xv:${REGION}:cap:global_send:${minuteBucket}`
      const globalCount = await redis.incr(globalKey)
      if (globalCount === 1) {
        await redis.expire(globalKey, 60)
      }
      if (globalCount > GLOBAL_SENDS_PER_MINUTE) {
        await recordMetric(job.clientId, 'defer_rate', 1, { scope: 'worker', reason: 'global_cap' })
        throw new Error('retry_later:global_cap')
      }
    }

    // Global shaper (anti-burst): token bucket across all domains for this client/org.
    // Always apply during experiment so timing isn't wildly different.
    if (!MOCK_SMTP_FASTLANE && (useCanary || ADAPTIVE_EXPERIMENT)) {
      const ok = await takeGlobalToken(job.clientId)
      if (!ok) {
        await recordMetric(job.clientId, 'defer_rate', 1, { scope: 'worker', reason: 'global_shaper' })
        // jittered backoff to smooth retry storms
        throw new Error('retry_later:global_shaper')
      }
    }

    const validation = MOCK_SMTP_FASTLANE
      ? { verdict: 'valid' as const, score: 0.99, catchAll: false }
      : await lookupValidation(job.toEmail)
    // Local/demo safety: if validator has not run yet, don't stall sending forever.
    // Treat unknown as risky and route to a conservative lane.
    const effectiveValidation =
      validation.verdict === 'unknown' && SEND_ALLOW_UNKNOWN_VALIDATION
        ? { ...validation, verdict: 'risky' as const, score: Math.max(validation.score, 0.55) }
        : validation

  // Best-effort: domain score is used to route valid traffic if domain is unhealthy.
  let domainScore: number | undefined
  if (!MOCK_SMTP_FASTLANE) {
    const domainIdRes = await db<{ id: number }>(
      `SELECT id
       FROM domains
       WHERE client_id = $1 AND domain = split_part($2,'@',2)
       LIMIT 1`,
      [job.clientId, job.toEmail]
    )
    const domainId = domainIdRes.rows[0]?.id
    domainScore = domainId ? (await getDomainScore({ db }, job.clientId, domainId))?.score : undefined
  }

	  const decision = decide({
	    email: job.toEmail,
	    verdict: effectiveValidation.verdict,
	    score: effectiveValidation.score,
	    domainScore,
	    catchAll: effectiveValidation.catchAll,
	  })

    if (!MOCK_SMTP_FASTLANE) {
      console.log('[sender-worker] decision', {
        bullJobId,
        queueJobId: job.queueJobId,
        action: (decision as any).action,
        lane: (decision as any).lane,
        reason: (decision as any).reason,
        verdict: effectiveValidation.verdict,
        score: effectiveValidation.score,
      })
    }

  if (decision.action === 'drop') {
    await handleTracking({
      type: 'FAILED',
      clientId: job.clientId,
      campaignId: job.campaignId ?? null,
      contactId: job.contactId ?? null,
      queueJobId: job.queueJobId ?? null,
      metadata: { reason: decision.reason, event_code: 'EMAIL_FAILED' },
    })
    return
  }

  if (decision.action === 'retry_later') {
    throw new Error(`retry_later:${decision.reason}`)
  }

    let lane: Lane = decision.lane
    let selection = await rotateInboxForSend(job.clientId, lane)

    // Production behavior: if the preferred lane is too strict for the currently configured domains
    // (common when SPF/DKIM/DMARC aren't populated yet), gracefully fall back to normal lane
    // instead of hard-failing the send pipeline.
    if (!selection && lane !== 'normal') {
      console.warn('[sender-worker] no sender available for lane; falling back to normal', {
        queueJobId: job.queueJobId,
        bullJobId,
        clientId: job.clientId,
        requestedLane: lane,
      })
      await recordMetric(job.clientId, 'lane_fallback_to_normal', 1, { from: lane })
      lane = 'normal'
      selection = await rotateInboxForSend(job.clientId, lane)
    }

    if (!selection) throw new Error('retry_later:no_sender_identity_available')
    selectedDomainId = selection.domain.id

    const caps = enforceCaps(selection, lane)
    if (!caps.ok) {
      const reason = 'reason' in caps ? caps.reason : 'unknown'
      throw new Error(`caps:${reason}`)
    }

    // Adaptive sending control (per-domain, provider-safe, abuse-resistant).
    // Multi-signal gating + EMA + cooldown + ramp profiles.
    const recipientProvider = detectProvider(job.toEmail)
    recipientProviderForRun = recipientProvider
    const providerPolicy = getProviderPolicy(recipientProvider)
    const bestHours = await getBestHours(job.clientId, selection.domain.id)
    const nowHour = new Date().getUTCHours()
    const timeWindowOk = bestHours ? bestHours.includes(nowHour) : true
    const providerSignals: ProviderSignals = { provider: recipientProvider, timeWindowHour: nowHour }
    const laneSignal = await loadLaneSignal(job.clientId, selection.domain.id, recipientProvider)
    const providerPause = await redis.get(`xv:${REGION}:adaptive:provider_pause:${job.clientId}:${recipientProvider}`)

    if (providerPause) {
      await recordMetric(job.clientId, 'adaptive_lane_paused', 1, {
        domainId: selection.domain.id,
        provider: recipientProvider,
        reason: 'global_provider_pause',
      })
      throw new Error('retry_later:provider_lane_paused')
    }

    if (laneSignal?.state === 'paused' || laneSignal?.action === 'pause' || laneSignal?.maxPerHour === 0) {
      await recordMetric(job.clientId, 'adaptive_lane_paused', 1, {
        domainId: selection.domain.id,
        provider: recipientProvider,
        reasons: laneSignal?.reasons ?? [],
      })
      throw new Error('retry_later:provider_lane_paused')
    }

    if (laneSignal?.state === 'cooldown' && laneSignal.cooldownUntil && new Date(laneSignal.cooldownUntil).getTime() > Date.now()) {
      await recordMetric(job.clientId, 'cooldown_events', 1, {
        domainId: selection.domain.id,
        provider: recipientProvider,
        reason: 'provider_lane_cooldown',
      })
      throw new Error('retry_later:provider_lane_paused')
    }

    const domainSignals = await loadDomainSignals(db, job.clientId, selection.domain.id)
    const adaptiveStateKey = `xv:${REGION}:adaptive:state:${job.clientId}:${selection.domain.id}`
    const prevStateRaw = await redis.get(adaptiveStateKey)
    const prevState: AdaptiveState | undefined = prevStateRaw ? (JSON.parse(prevStateRaw) as any) : undefined

    const { throughput: adaptive, nextState } = computeAdaptiveThroughput(domainSignals, providerSignals, prevState, Date.now())
    await redis.set(adaptiveStateKey, JSON.stringify(nextState), 'EX', 60 * 60 * 24 * 7)

    if (adaptive.shouldPauseDomain) {
      await recordMetric(job.clientId, 'domain_pause_triggered', 1, { domainId: selection.domain.id })
      await recordMetric(job.clientId, 'auto_pause_count', 1, { domainId: selection.domain.id, reasons: adaptive.reasons })
      // Append-only audit event for client trust.
      await db(
        `INSERT INTO domain_pause_events (client_id, domain_id, reason, metrics_snapshot)
         VALUES ($1,$2,$3,$4::jsonb)`,
        [
          job.clientId,
          selection.domain.id,
          adaptive.hardStop ? 'hard_stop' : 'pause',
          JSON.stringify({
            reasons: adaptive.reasons,
            adaptive,
            domainSignals,
            recipientProvider,
            timeWindowHour: nowHour,
          }),
        ]
      ).catch(() => {})
      // Best-effort pause in DB so UI reflects safety state.
      await db(
        `UPDATE domains
         SET status = 'paused', updated_at = CURRENT_TIMESTAMP
         WHERE client_id = $1 AND id = $2`,
        [job.clientId, selection.domain.id]
      )
      if (adaptive.hardStop) {
        await recordMetric(job.clientId, 'cooldown_events', 1, { domainId: selection.domain.id, kind: 'hard_stop' })
        // Hard-stop: do not retry this job; suppress future attempts.
        await handleTracking({
          type: 'FAILED',
          clientId: job.clientId,
          campaignId: job.campaignId ?? null,
          contactId: job.contactId ?? null,
          queueJobId: job.queueJobId ?? null,
          metadata: {
            event_code: 'EMAIL_FAILED',
            reason: 'domain_hard_stop',
            idempotency_key: idemKey,
            adaptive: {
              throughput_current: adaptive.maxPerMinute,
              reasons: adaptive.reasons,
              next_window_action: adaptive.nextWindowAction,
              provider: recipientProvider,
            },
          },
        })
        await redis.set(doneKey, '1', 'EX', 60 * 60 * 24 * 7)
        await redis.set(legacyDoneKey, '1', 'EX', 60 * 60 * 24 * 7)
        await redis.del(inflightKey)
        await redis.del(failedKey)
        return
      }
      throw new Error('retry_later:domain_paused_adaptive')
    }

    // Time-of-day bias: reduce throughput outside best windows (soft).
    let effectiveMaxPerMinute = adaptive.maxPerMinute
    let pressureSlowFactor: number | null = null
    let providerRisk = 0

    if (!useCanary) {
      // Baseline behavior: keep conservative shaping only.
      effectiveMaxPerMinute = Math.max(2, Math.min(5, effectiveMaxPerMinute))
    } else {
      if (!timeWindowOk) {
        effectiveMaxPerMinute = Math.max(2, Math.floor(effectiveMaxPerMinute * 0.8))
      }

      // Backpressure: system pressure slow-down (set by /api/system/pressure).
      const pressureSlow = Number((await redis.get(`xv:${REGION}:adaptive:pressure_slow:${job.clientId}`)) ?? 0)
      if (pressureSlow > 0) {
        pressureSlowFactor = pressureSlow
        effectiveMaxPerMinute = Math.max(2, Math.floor(effectiveMaxPerMinute * pressureSlow))
      }
    }

    // Deploy conservative mode factor (auto-safe deploy).
    const deployFactor = Number((await redis.get(`xv:${REGION}:deploy:conservative`)) ?? 0)
    if (deployFactor > 0) {
      effectiveMaxPerMinute = Math.max(2, Math.floor(effectiveMaxPerMinute * deployFactor))
    }

    // Experiment: baseline group uses a fixed conservative throughput (still obeys safety pauses/hard-stops above).
    if (expGroup === 'baseline') {
      effectiveMaxPerMinute = 2
    }

    if (laneSignal) {
      effectiveMaxPerMinute = Math.max(1, Math.min(effectiveMaxPerMinute, laneSignal.maxPerMinute || 1))
    }

    if (useCanary) {
      // Cross-domain safe coupling: if multiple domains show throttling signals, slow the whole org slightly.
      const riskBucket = `xv:${REGION}:adaptive:risk_bucket:${job.clientId}:${minuteBucket}`
      const hasRiskSignal =
        adaptive.reasons.includes('block_rate_detected_cooldown') ||
        adaptive.reasons.includes('deferral_rate_spike_halve')
      if (hasRiskSignal) {
        const n = await redis.incr(riskBucket)
        if (n === 1) await redis.expire(riskBucket, 10 * 60)
        if (n >= GLOBAL_RISK_THRESHOLD) {
          await redis.set(`xv:${REGION}:adaptive:global_risk:${job.clientId}`, '1', 'EX', GLOBAL_RISK_WINDOW_SEC)
          await recordMetric(job.clientId, 'cooldown_events', 1, { scope: 'global', reason: 'multi_domain_risk' })
        }
      }
      const globalRisk = await redis.get(`xv:${REGION}:adaptive:global_risk:${job.clientId}`)
      if (globalRisk) {
        effectiveMaxPerMinute = Math.max(2, Math.floor(effectiveMaxPerMinute * GLOBAL_RISK_SLOWDOWN_FACTOR))
      }

      // Recipient-provider memory throttling: if provider is degraded, slow just that provider.
      const providerKey = `xv:${REGION}:adaptive:provider_risk:${job.clientId}:${recipientProvider}`
      providerRisk = Number((await redis.get(providerKey)) ?? 0)
      if (providerRisk > 0) {
        effectiveMaxPerMinute = Math.max(2, Math.floor(effectiveMaxPerMinute * (1 - clamp(providerRisk, 0.1, 0.5))))
      }
    }

    if (laneSignal) {
      effectiveMaxPerMinute = Math.max(1, Math.min(effectiveMaxPerMinute, laneSignal.maxPerMinute || 1))
    }

    if (!MOCK_SMTP_FASTLANE && laneSignal) {
      const laneBucketKey = `xv:${REGION}:adaptive:lane_bucket:${job.clientId}:${selection.domain.id}:${recipientProvider}`
      const ok = await takeTokenBucket(
        laneBucketKey,
        laneSignal.ratePerSecond,
        laneSignal.burst,
        60 * 30
      )
      if (!ok) {
        await recordMetric(job.clientId, 'adaptive_lane_bucket_wait', 1, {
          domainId: selection.domain.id,
          provider: recipientProvider,
          maxPerHour: laneSignal.maxPerHour,
          burst: laneSignal.burst,
        })
        throw new Error('retry_later:adaptive_lane_bucket')
      }
    }

    const normalizedTo = String(job.toEmail || '').trim().toLowerCase()

    // Duplicate anomaly fallback: if we already sent to the same recipient recently,
    // suppress before SMTP so we protect domains without creating false "sent then failed" records.
    if (!MOCK_SMTP_FASTLANE) {
      const dupRes = await db<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM events
         WHERE client_id = $1
           AND event_type = 'sent'
           AND COALESCE(metadata->>'to_email','') = $2
           AND created_at > (CURRENT_TIMESTAMP - INTERVAL '1 hour')`,
        [job.clientId, normalizedTo]
      )
      if (Number(dupRes.rows[0]?.count ?? 0) > 0) {
        await recordMetric(job.clientId, 'duplicate_send_prevented', 1, { scope: 'worker', reason: 'recent_window' })
        console.warn('[sender-worker] duplicate anomaly suppressed before smtp (recent window)', {
          bullJobId,
          idemKey,
          to: maskEmail(normalizedTo),
        })
        await redis.set(doneKey, '1', 'EX', 60 * 60 * 24 * 7)
        await redis.set(legacyDoneKey, '1', 'EX', 60 * 60 * 24 * 7)
        await redis.del(inflightKey)
        await redis.del(failedKey)
        await handleTracking({
          type: 'FAILED',
          clientId: job.clientId,
          campaignId: job.campaignId ?? null,
          contactId: job.contactId ?? null,
          queueJobId: job.queueJobId ?? null,
          metadata: { event_code: 'EMAIL_FAILED', reason: 'duplicate_recent_window', to_email: normalizedTo, idempotency_key: idemKey },
        })
        return
      }
    }

    // Per-domain per-minute limiter.
    // NOTE: minuteBucket already defined above for global cap; keep it consistent for shaping.
    const domainRateKey = `xv:${REGION}:adaptive:domain_rate:${job.clientId}:${selection.domain.id}:${minuteBucket}`
    if (!MOCK_SMTP_FASTLANE) {
      const count = await redis.incr(domainRateKey)
      if (count === 1) await redis.expire(domainRateKey, 70)
      if (count > effectiveMaxPerMinute) {
        await recordMetric(job.clientId, 'adaptive_throttled', 1, {
          domainId: selection.domain.id,
          maxPerMinute: effectiveMaxPerMinute,
          targetPerDay: adaptive.targetPerDay,
          reasons: adaptive.reasons,
          nextWindowAction: adaptive.nextWindowAction,
        })
        // Graceful drain: jittered retry so we don't synchronize.
        throw new Error('retry_later:adaptive_throttle')
      }
    }

    // Max concurrent SMTP connections per domain (hard safety floor).
    // Provider-aware concurrency ceiling (recipient provider).
    const maxConcurrency = Math.max(1, Math.min(3, providerPolicy.maxDomainConcurrency, laneSignal?.maxConcurrency ?? 3))
    const concKey = `xv:${REGION}:adaptive:smtp_conc:${job.clientId}:${selection.domain.id}`
    const conc = MOCK_SMTP_FASTLANE ? 1 : await redis.incr(concKey)
    if (!MOCK_SMTP_FASTLANE && conc === 1) await redis.expire(concKey, 30)
    if (!MOCK_SMTP_FASTLANE && conc > maxConcurrency) {
      await recordMetric(job.clientId, 'deferral_rate', 1, { scope: 'worker', reason: 'domain_concurrency_cap', maxConcurrency })
      throw new Error('retry_later:domain_concurrency_cap')
    }

    mutationResult = await contentMutations.mutateForSend({
      clientId: job.clientId,
      campaignId: job.campaignId ?? null,
      sequenceStep: job.sequenceStep ?? 0,
      queueJobId: job.queueJobId ?? null,
      recipientEmail: job.toEmail,
      subject: job.subject,
      text: job.text,
      html: job.html,
    })
    outboundSubject = mutationResult.subject
    outboundText = mutationResult.text
    outboundHtml = mutationResult.html
    if (mutationResult.safetyWarnings?.length) {
      await recordMetric(job.clientId, 'content_mutation_safety_fallback', 1, {
        source: mutationResult.source,
        warnings: mutationResult.safetyWarnings,
      })
    }

    let messageId = ''
    let smtpAttempted = false
    try {
      smtpAttempted = true

      const sent = MOCK_SMTP
        ? await (async () => {
            fromAddress = String(selection.identity.email ?? `mock@${selection.domain.domain}`).toLowerCase()
            if (!MOCK_SMTP_FASTLANE) {
              console.log('[sender-worker] mock smtp send start', {
                from: maskEmail(fromAddress),
                to: maskEmail(job.toEmail),
                queueJobId: job.queueJobId,
              })
            }
            if (!MOCK_SMTP_FASTLANE) await sleep(jitterMs(5, 0.5))
            return {
              messageId: `<mock-${idemKey}-${Date.now()}@${selection.domain.domain}>`,
            }
          })()
        : await (async () => {
            const account = selectSenderAccount(idemKey)
            fromAddress = String(account.user).toLowerCase()

            console.log('[sender-worker] smtp send start', {
              from: maskEmail(account.user),
              to: maskEmail(job.toEmail),
              host: SMTP_HOST,
              port: SMTP_PORT,
              secure: SMTP_SECURE,
            })

            return Promise.race([
              sendSmtp(
                { host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE, user: account.user, pass: account.pass },
                {
                  from: account.user,
                  to: job.toEmail,
                  subject: outboundSubject,
                  html: outboundHtml,
                  text: outboundText,
                  headerContext: {
                    clientId: job.clientId,
                    campaignId: job.campaignId ?? null,
                    queueJobId: job.queueJobId ?? null,
                    idempotencyKey: idemKey,
                    sendingDomain: String(account.user).split('@')[1] || selection.domain.domain,
                    provider: recipientProvider,
                  },
                  headers:
                    process.env.SMTP_DEBUG_HEADERS === 'true'
                      ? {
                          'X-Sovereign-Engine-Lane': lane,
                          'X-Sovereign-Engine-Adaptive': adaptive.reasons.join(','),
                          'X-Sovereign-Engine-QueueJobId': String(job.queueJobId ?? ''),
                          'X-Sovereign-Engine-CampaignId': String(job.campaignId ?? ''),
                        }
                      : undefined,
                }
              ),
              sleep(75_000).then(() => {
                throw new Error('smtp_timeout')
              }),
            ])
          })()
      messageId = sent.messageId
      if (!MOCK_SMTP_FASTLANE) {
        console.log('[sender-worker] smtp send completed', { messageId, to: maskEmail(job.toEmail) })
      }
    } finally {
      // Best-effort release: if process crashes, TTL expires.
      if (!MOCK_SMTP_FASTLANE) await redis.decr(concKey).catch(() => {})
    }

    if (!MOCK_SMTP_FASTLANE) {
      await db(
        `UPDATE identities
         SET sent_today = sent_today + 1,
             sent_count = sent_count + 1,
             last_sent_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE client_id = $1 AND id = $2`,
        [job.clientId, selection.identity.id]
      )
      await db(
        `UPDATE domains
         SET sent_today = sent_today + 1,
             sent_count = sent_count + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE client_id = $1 AND id = $2`,
        [job.clientId, selection.domain.id]
      )
    }

    await handleTracking({
      type: 'SENT',
      clientId: job.clientId,
      campaignId: job.campaignId ?? null,
      contactId: job.contactId ?? null,
      identityId: selection.identity.id,
      domainId: selection.domain.id,
      queueJobId: job.queueJobId ?? null,
      providerMessageId: messageId,
      metadata: {
        event_code: 'EMAIL_SENT',
        to_email: normalizedTo,
        from_email: fromAddress,
        subject: outboundSubject,
        body_text: truncateText(outboundText, 20_000),
        body_html: truncateText(outboundHtml, 40_000),
        idempotency_key: idemKey,
        provider: recipientProvider,
        content_mutation: mutationResult
          ? {
              mutated: mutationResult.mutated,
              source: mutationResult.source,
              variant_hash: mutationResult.variantHash ?? null,
              pool_key: mutationResult.poolKey ?? null,
              safety_warnings: mutationResult.safetyWarnings ?? [],
            }
          : null,
        adaptive: {
          throughput_current: effectiveMaxPerMinute,
          reasons: adaptive.reasons,
          next_window_action: adaptive.nextWindowAction,
          provider: recipientProvider,
          best_hours_utc: bestHours ?? null,
          in_best_window: timeWindowOk,
        },
        adaptive_config: {
          global_rate: GLOBAL_SHAPER_RATE_PER_SEC,
          global_burst: GLOBAL_SHAPER_BURST,
          global_cap_per_min: GLOBAL_SENDS_PER_MINUTE,
          domain_rate: effectiveMaxPerMinute,
          provider_bias: providerRisk,
          pressure_slow_factor: pressureSlowFactor,
          cooldown_active: (nextState.cooldownUntil ?? 0) > Date.now(),
          canary: ADAPTIVE_CANARY ? useCanary : null,
        },
        adaptive_experiment: expGroup,
      },
    })

    if (job.queueJobId) {
      await db(
        `UPDATE queue_jobs
         SET provider_message_id = $3,
             status = CASE WHEN status IN ('pending','processing','retry') THEN 'completed' ELSE status END,
             completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE client_id = $1 AND id = $2`,
        [job.clientId, job.queueJobId, messageId]
      ).catch(() => {})
    }

    // Mark idempotency as completed after we successfully sent and tracked.
    await redis.set(doneKey, '1', 'EX', 60 * 60 * 24 * 7)
    await redis.set(legacyDoneKey, '1', 'EX', 60 * 60 * 24 * 7)
    await redis.del(inflightKey)
    await redis.del(failedKey)
    workerProcessedSends += 1
    checkWorkerRotation()
    if (!MOCK_SMTP_FASTLANE) {
      await recordMetric(job.clientId, 'send_success_rate', 1, { scope: 'worker' })
      await recordMetric(job.clientId, 'duplicate_send_prevented', 0, { scope: 'worker' })
    }
  } catch (err) {
    console.error('[sender-worker] send attempt error', {
      bullJobId,
      queueJobId: job.queueJobId,
      idemKey,
      err: sanitizeLogValue((err as any)?.message ?? String(err)),
    })
    const rawErrorMessage = (err as any)?.message ?? String(err)
    if (isDbCapacityError(rawErrorMessage)) {
      ;(err as any).smartRetry = {
        backoffMs: jitterMs(20_000, 0.75),
        reason: 'retry_later:db_capacity',
        laneState: null,
      }
      await redis.del(inflightKey)
      await recordMetric(job.clientId, 'retry_count', 1, { scope: 'worker', reason: 'db_capacity' }).catch(() => {})
      throw err
    }
    // DLQ handling: after N attempts, stop retrying and move to DLQ with reason.
    const attemptsMade = bull?.attemptsMade ?? 0
    if (attemptsMade >= MAX_SEND_ATTEMPTS) {
      const { smtpClass, responseCode } = classifySmtpFailure(err)
      await recordMetric(job.clientId, 'dlq_moved_count', 1, { smtpClass })
      await dlq.add(
        'send_dlq',
        {
          ...job,
          toEmail: maskEmail(job.toEmail),
          dlq: {
            reason: smtpClass,
            last_error: String(sanitizeLogValue((err as any)?.message ?? String(err))),
            smtp_response_code: responseCode,
          },
        } as any,
        { removeOnComplete: true, removeOnFail: true }
      )
      await handleTracking({
        type: 'FAILED',
        clientId: job.clientId,
        campaignId: job.campaignId ?? null,
        contactId: job.contactId ?? null,
        queueJobId: job.queueJobId ?? null,
        metadata: {
          event_code: 'EMAIL_FAILED',
          reason: 'dlq',
          smtp_class: smtpClass,
          smtp_response_code: responseCode,
          error: String(sanitizeLogValue((err as any)?.message ?? String(err))),
          idempotency_key: idemKey,
          adaptive_experiment: expGroup,
        },
      }).catch(() => {})

      await redis.set(doneKey, '1', 'EX', 60 * 60 * 24 * 7)
      await redis.set(legacyDoneKey, '1', 'EX', 60 * 60 * 24 * 7)
      await redis.del(inflightKey)
      await redis.del(failedKey)
      return
    }

    const msg = (err as any)?.message ?? String(err)
    const isCapacityPressure = isDbCapacityError(msg)
    if (isCapacityPressure) {
      ;(err as any).smartRetry = {
        backoffMs: jitterMs(20_000, 0.75),
        reason: 'retry_later:db_capacity',
        laneState: null,
      }
    }

    // Only emit FAILED tracking for real SMTP execution failures (not our own throttles).
    const isInternalThrottle = isCapacityPressure || msg.startsWith('retry_later:')

    if (!isInternalThrottle) {
      const { smtpClass, responseCode } = classifySmtpFailure(err)
      const smartRetry = await computeSmartSmtpRetry({
        clientId: job.clientId,
        domainId: selectedDomainId,
        provider: recipientProviderForRun,
        retryCount: bull?.attemptsMade ?? 0,
        smtpClass,
        responseCode,
      })
      if (smartRetry) {
        ;(err as any).smartRetry = smartRetry
      }

      // Recipient-provider memory update: elevate risk and auto-decay.
      if (smtpClass === 'block' || smtpClass === 'deferral' || smtpClass === 'bounce') {
        const pk = `xv:${REGION}:adaptive:provider_risk:${job.clientId}:${detectProvider(job.toEmail)}`
        const cur = Number((await redis.get(pk)) ?? 0)
        const next = Math.min(0.5, Math.max(cur, smtpClass === 'block' ? 0.3 : smtpClass === 'deferral' ? 0.15 : 0.1))
        await redis.set(pk, String(next), 'EX', 60 * 60) // 1h TTL
        await recordMetric(job.clientId, smtpClass === 'block' ? 'block_rate' : smtpClass === 'deferral' ? 'deferral_rate' : 'bounce_rate', 1, {
          provider: detectProvider(job.toEmail),
        })
      }

      await handleTracking({
        type: smtpClass === 'bounce' ? 'BOUNCED' : 'FAILED',
        clientId: job.clientId,
        campaignId: job.campaignId ?? null,
        contactId: job.contactId ?? null,
        queueJobId: job.queueJobId ?? null,
        metadata: {
          event_code: smtpClass === 'bounce' ? 'EMAIL_BOUNCED' : 'EMAIL_FAILED',
          idempotency_key: idemKey,
          to_email: String(job.toEmail || '').trim().toLowerCase(),
          from_email: fromAddress || cleanEmail(selectSenderAccount(idemKey).user),
          subject: outboundSubject,
          body_text: truncateText(outboundText, 20_000),
          body_html: truncateText(outboundHtml, 40_000),
          provider: detectProvider(job.toEmail),
          smtp_response_code: responseCode,
          smtp_class: smtpClass,
          error: String(sanitizeLogValue(msg)),
          content_mutation: mutationResult
            ? {
                mutated: mutationResult.mutated,
                source: mutationResult.source,
                variant_hash: mutationResult.variantHash ?? null,
                pool_key: mutationResult.poolKey ?? null,
                safety_warnings: mutationResult.safetyWarnings ?? [],
              }
            : null,
          adaptive_experiment: expGroup,
        },
      } as any).catch(() => {})

      if (job.queueJobId) {
        await db(
          `UPDATE queue_jobs
           SET status = CASE
               WHEN attempts + 1 >= max_attempts THEN 'failed'
               ELSE 'retry'
             END,
             attempts = attempts + 1,
             last_error = $3,
             updated_at = CURRENT_TIMESTAMP
           WHERE client_id = $1 AND id = $2`,
          [job.clientId, job.queueJobId, String(sanitizeLogValue(msg))]
        ).catch(() => {})
      }
    }

    // Failure state: allow retry with backoff; do not deadlock.
    // For internal throttles, do not poison retries with "recent_failure".
    if (!isInternalThrottle) {
      await redis.set(failedKey, String(sanitizeLogValue((err as any)?.message ?? 'failed')), 'EX', 5 * 60)
    }
    await redis.del(inflightKey)
    await recordMetric(job.clientId, 'retry_count', 1, { scope: 'worker', reason: sanitizeLogValue((err as any)?.message ?? String(err)) as string })
    throw err
  }
}

async function main() {
  console.log('[sender-worker] starting', { queue: SEND_QUEUE, workerId: WORKER_ID })
  console.log('[sender-worker] config', {
    SEND_ALLOW_UNKNOWN_VALIDATION,
    MOCK_SMTP,
    MOCK_SMTP_FASTLANE,
    WORKER_CONCURRENCY,
    LEGACY_LOOP_BATCH_SIZE,
    PG_POOL_MAX,
    WORKER_ROTATION_SEND_LIMIT,
    WORKER_ROTATION_MAX_AGE_MS,
    licensing: LICENSING_CONTROL_URL ? 'enabled' : 'not_configured',
  })

  // Auto-safe deploy: after restart, be conservative for 10 minutes to avoid burst-on-deploy.
  await redis.set(`xv:${REGION}:deploy:conservative`, '0.7', 'EX', 10 * 60)

  await bootstrapFromSnapshots()
  startLicenseHeartbeat()
  startWorkerHeartbeat()

  void runLegacyQueueLoop()

  bullWorker = new BullWorker<SendJob>(
    SEND_QUEUE,
    async (job) => {
      try {
        await runSend(job.data, job)
      } catch (err) {
        const msg = (err as any)?.message ?? String(err)
        const retry = parseRetryLater(msg)
        const smartRetry = (err as any)?.smartRetry as { backoffMs: number; reason: string; laneState: string | null } | undefined
        if (retry || smartRetry) {
          const backoffMs = retry?.backoffMs ?? smartRetry!.backoffMs
          const reason = retry ? msg : smartRetry!.reason
          // Don't burn attempts on internal throttles; re-enqueue a delayed clone.
          // Avoid BullMQ lock edge cases by not moving the current job state.
          if ((job.data as any)?.queueJobId) {
            await db(
              `UPDATE queue_jobs
               SET status = 'retry',
                   scheduled_at = CURRENT_TIMESTAMP + ($3::int * INTERVAL '1 millisecond'),
                   last_error = $4,
                   updated_at = CURRENT_TIMESTAMP
               WHERE client_id = $1 AND id = $2`,
              [(job.data as any).clientId, (job.data as any).queueJobId, backoffMs, String(sanitizeLogValue(reason))]
            ).catch(() => {})
          }
          await sendQueue.add('__internal_retry__', job.data as any, {
            delay: backoffMs,
            removeOnComplete: true,
            removeOnFail: false,
            attempts: 3,
            backoff: { type: 'exponential', delay: 10_000 },
          })
          console.warn('[sender-worker] bull job re-enqueued', {
            id: job.id,
            reason,
            backoffMs,
            laneState: smartRetry?.laneState ?? null,
          })
          return
        }
        throw err
      }
    },
    {
      connection: { url: reqEnv('REDIS_URL') },
      concurrency: WORKER_CONCURRENCY,
      lockDuration: 30_000,
    }
  )

  bullWorker.on('failed', (job, err) => {
    console.error('[sender-worker] job failed', { id: job?.id, err: sanitizeLogValue(err?.message) })
  })

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

async function shutdown(signal: string) {
  console.log('[sender-worker] shutting down', { signal })
  if (workerRetirementTimer) clearTimeout(workerRetirementTimer)
  await Promise.allSettled(Array.from(fastlaneCompletionBatches.keys()).map((clientId) => flushFastlaneCompletionBatch(clientId)))
  await stopLicenseHeartbeat()
  await stopWorkerHeartbeat()
  await Promise.allSettled([bullWorker?.close(), sendQueue.close(), dlq.close(), redis.quit(), pool.end()])
  process.exit(0)
}

main().catch((err) => {
  console.error('[sender-worker] fatal', err)
  process.exit(1)
})
