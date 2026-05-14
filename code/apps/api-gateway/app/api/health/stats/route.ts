import { NextRequest, NextResponse } from 'next/server'
import IORedis from 'ioredis'
import { Queue } from 'bullmq'
import crypto from 'node:crypto'
import { query } from '@/lib/db'
import { resolveClientId } from '@/lib/client-context'
import { evaluateTlsPolicy } from '@/lib/security/tls-policy'

function reqEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

const WORKER_HEALTH_FRESH_MS = Number(process.env.WORKER_HEALTH_FRESH_MS ?? 45_000)

function safeError(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function redisUrlDiagnostic(raw = process.env.REDIS_URL || '') {
  try {
    const url = new URL(raw)
    const password = url.password ? decodeURIComponent(url.password) : ''
    return {
      scheme: url.protocol.replace(':', ''),
      username: decodeURIComponent(url.username || ''),
      host: url.hostname,
      port: url.port,
      passwordLength: password.length,
      passwordSha256Prefix: password
        ? crypto.createHash('sha256').update(password).digest('hex').slice(0, 12)
        : null,
    }
  } catch {
    return {
      scheme: raw.split('://')[0] || null,
      username: null,
      host: null,
      port: null,
      passwordLength: 0,
      passwordSha256Prefix: null,
    }
  }
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; latencyMs: number }> {
  const started = performance.now()
  const value = await fn()
  return { value, latencyMs: Math.round((performance.now() - started) * 100) / 100 }
}

async function scanSenderHeartbeats(redis: IORedis, region: string) {
  const pattern = `xv:${region}:workers:sender:*`
  let cursor = '0'
  const keys: string[] = []

  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
    cursor = nextCursor
    keys.push(...batch)
  } while (cursor !== '0')

  if (!keys.length) return []

  const raw = await redis.mget(...keys)
  return raw
    .map((value, index) => {
      if (!value) return null
      try {
        return { key: keys[index], ...(JSON.parse(value) as Record<string, unknown>) }
      } catch {
        return { key: keys[index], parseError: true }
      }
    })
    .filter(Boolean)
}

export async function GET(request: NextRequest) {
  let redis: IORedis | null = null
  let queue: Queue | null = null

  try {
    const clientId = await resolveClientId({
      searchParams: request.nextUrl.searchParams,
      headers: request.headers,
    })
    const redisUrl = reqEnv('REDIS_URL')
    const queueName = process.env.SEND_QUEUE ?? 'xv-send-queue'
    const region = process.env.XV_REGION ?? 'local'
    redis = new IORedis(redisUrl, { maxRetriesPerRequest: 1 })
    queue = new Queue(queueName, { connection: { url: redisUrl } })

    const redisKey = `xv:health:${clientId}:${Date.now()}`
    const [redisSet, redisGet, dbState, bullCounts, queueRows, workerHeartbeats, deliveryLatency] = await Promise.all([
      timed(async () => redis!.set(redisKey, '1', 'EX', 30)),
      timed(async () => {
        await redis!.set(redisKey, '1', 'EX', 30)
        return redis!.get(redisKey)
      }),
      timed(async () =>
        query<{ state_count: string; max_updated_at: string | null }>(
          `SELECT COUNT(*)::text AS state_count, MAX(updated_at)::text AS max_updated_at
           FROM reputation_state
           WHERE client_id = $1`,
          [clientId]
        )
      ),
      timed(async () => queue!.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed')),
      timed(async () =>
        query<{ waiting: string; active: string; retry: string; failed: string }>(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'pending')::text AS waiting,
             COUNT(*) FILTER (WHERE status = 'processing')::text AS active,
             COUNT(*) FILTER (WHERE status = 'retry')::text AS retry,
             COUNT(*) FILTER (WHERE status = 'failed')::text AS failed
           FROM queue_jobs
           WHERE client_id = $1`,
          [clientId]
        )
      ),
      timed(async () => scanSenderHeartbeats(redis!, region)),
      timed(async () =>
        query<{
          sample: string
          p50_ms: string | number | null
          p95_ms: string | number | null
          p99_ms: string | number | null
        }>(
          `WITH sent AS (
             SELECT queue_job_id, MIN(created_at) AS sent_at
             FROM events
             WHERE client_id = $1
               AND event_type = 'sent'
               AND queue_job_id IS NOT NULL
               AND created_at >= now() - INTERVAL '24 hours'
             GROUP BY queue_job_id
           ),
           delivered AS (
             SELECT queue_job_id, MIN(COALESCE(delivered_at, created_at)) AS delivered_at
             FROM events
             WHERE client_id = $1
               AND event_type = 'delivered'
               AND queue_job_id IS NOT NULL
               AND created_at >= now() - INTERVAL '24 hours'
             GROUP BY queue_job_id
           ),
           latencies AS (
             SELECT EXTRACT(EPOCH FROM (d.delivered_at - s.sent_at)) * 1000 AS latency_ms
             FROM sent s
             JOIN delivered d ON d.queue_job_id = s.queue_job_id
             WHERE d.delivered_at >= s.sent_at
           )
           SELECT
             COUNT(*)::text AS sample,
             percentile_cont(0.50) WITHIN GROUP (ORDER BY latency_ms) AS p50_ms,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_ms,
             percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms) AS p99_ms
           FROM latencies`,
          [clientId]
        )
      ),
    ])

    const dbRow = dbState.value.rows[0]
    const queueRow = queueRows.value.rows[0]
    const latencyRow = deliveryLatency.value.rows[0]
    const nowMs = Date.now()
    const allSenderNodes = workerHeartbeats.value as Array<Record<string, any>>
    const senderNodes = allSenderNodes.filter((node) => {
      if (node.parseError) return false
      const lastSeenMs = Date.parse(String(node.lastSeenAt ?? ''))
      return Number.isFinite(lastSeenMs) && nowMs - lastSeenMs <= WORKER_HEALTH_FRESH_MS
    })
    const staleSenderNodes = allSenderNodes.length - senderNodes.length
    const totalProcessedSends = senderNodes.reduce((sum, node) => sum + Number(node.processedSends ?? 0), 0)
    const totalConcurrency = senderNodes.reduce((sum, node) => sum + Number(node.concurrency ?? 0), 0)
    const resourceNodes = senderNodes.map((node) => node.resources ?? {})
    const avgCpuPercent =
      resourceNodes.length > 0
        ? resourceNodes.reduce((sum, node) => sum + Number(node.cpuPercent ?? 0), 0) / resourceNodes.length
        : 0
    const totalRssMb = resourceNodes.reduce((sum, node) => sum + Number(node.rssMb ?? 0), 0)
    const maxRssMb = resourceNodes.reduce((max, node) => Math.max(max, Number(node.rssMb ?? 0)), 0)
    const sendsPer10kDivisor = Math.max(totalProcessedSends / 10_000, 1)
    const tlsPolicy = evaluateTlsPolicy()

    return NextResponse.json({
      ok: true,
      clientId,
      generatedAt: new Date().toISOString(),
      infrastructure_latency: {
        redis_set_ms: redisSet.latencyMs,
        redis_get_ms: redisGet.latencyMs,
        db_reputation_state_ms: dbState.latencyMs,
        bullmq_counts_ms: bullCounts.latencyMs,
        db_queue_counts_ms: queueRows.latencyMs,
        worker_heartbeat_scan_ms: workerHeartbeats.latencyMs,
        delivery_latency_query_ms: deliveryLatency.latencyMs,
      },
      redis: {
        set_ok: redisSet.value === 'OK',
        get_ok: redisGet.value === '1',
      },
      postgres: {
        reputation_state_count: Number(dbRow?.state_count ?? 0),
        reputation_state_last_updated_at: dbRow?.max_updated_at ?? null,
      },
      bullmq: {
        queue: queueName,
        waiting: Number((bullCounts.value as any).waiting ?? 0),
        active: Number((bullCounts.value as any).active ?? 0),
        delayed: Number((bullCounts.value as any).delayed ?? 0),
        completed: Number((bullCounts.value as any).completed ?? 0),
        failed: Number((bullCounts.value as any).failed ?? 0),
      },
      db_queue: {
        waiting: Number(queueRow?.waiting ?? 0),
        active: Number(queueRow?.active ?? 0),
        retry: Number(queueRow?.retry ?? 0),
        failed: Number(queueRow?.failed ?? 0),
      },
      workers: {
        sender: {
          active: senderNodes.length,
          stale: staleSenderNodes,
          heartbeatFreshMs: WORKER_HEALTH_FRESH_MS,
          totalConcurrency,
          totalProcessedSends,
          nodes: senderNodes,
        },
      },
      delivery_latency: {
        window: '24h',
        sample: Number(latencyRow?.sample ?? 0),
        p50_ms: latencyRow?.p50_ms == null ? null : Number(latencyRow.p50_ms),
        p95_ms: latencyRow?.p95_ms == null ? null : Number(latencyRow.p95_ms),
        p99_ms: latencyRow?.p99_ms == null ? null : Number(latencyRow.p99_ms),
      },
      resource_usage: {
        window: 'heartbeat',
        avg_cpu_percent: Math.round(avgCpuPercent * 100) / 100,
        total_rss_mb: Math.round(totalRssMb * 100) / 100,
        max_worker_rss_mb: Math.round(maxRssMb * 100) / 100,
        memory_mb_per_10k_sends: Math.round((totalRssMb / sendsPer10kDivisor) * 100) / 100,
      },
      security: {
        tls_policy: tlsPolicy,
      },
    })
  } catch (error) {
    console.error('[api/health/stats] failed', error)
    return NextResponse.json(
      {
        ok: false,
        error: 'failed',
        detail: safeError(error),
        diagnostics: {
          hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
          redisUrlScheme: process.env.REDIS_URL?.split('://')[0] ?? null,
          redisUrl: redisUrlDiagnostic(),
          nodeEnv: process.env.NODE_ENV ?? null,
          sendQueue: process.env.SEND_QUEUE ?? 'xv-send-queue',
        },
      },
      { status: 500 }
    )
  } finally {
    await Promise.allSettled([queue?.close(), redis?.quit()])
  }
}
