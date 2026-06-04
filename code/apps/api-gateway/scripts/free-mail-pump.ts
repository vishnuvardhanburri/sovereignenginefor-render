import 'dotenv/config'

type CycleKind = 'queue' | 'discovery'

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw === null || raw === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase())
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(process.env[name] ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(Math.trunc(parsed), max))
}

function localBaseUrl(): string {
  const explicit = String(process.env.FREE_MAIL_PUMP_BASE_URL || '').trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  return `http://127.0.0.1:${process.env.PORT || '10000'}`
}

function appendCommonParams(url: URL, kind: CycleKind) {
  const clientId = envInt('DEFAULT_CLIENT_ID', 1, 1, 1_000_000)
  const sendLimit = envInt('FREE_MAIL_PUMP_SEND_LIMIT', 1, 0, 5)
  const approveLimit = envInt('FREE_MAIL_PUMP_APPROVE_LIMIT', 5, 1, 25)
  const maxDailyVolume = envInt('FREE_MAIL_PUMP_MAX_DAILY_VOLUME', 30, 1, 200)
  const targetDailyVolume = envInt(
    'DAILY_OUTBOUND_TARGET_DAILY_VOLUME',
    envInt('DAILY_OUTBOUND_PROVIDER_MAX_SEND_LIMIT', 800, 1, 1_000_000),
    1,
    1_000_000
  )

  url.searchParams.set('client_id', String(clientId))
  url.searchParams.set('compact', '1')
  url.searchParams.set('cronCompact', '1')
  url.searchParams.set('mode', process.env.DAILY_OUTBOUND_MODE || 'growth')
  url.searchParams.set('targetDailyVolume', String(targetDailyVolume))
  url.searchParams.set('minDailyVolume', '1')
  url.searchParams.set('maxDailyVolume', String(maxDailyVolume))
  url.searchParams.set('sendLimit', String(sendLimit))
  url.searchParams.set('approveLimit', String(approveLimit))
  url.searchParams.set('providerValidationLimit', '0')
  url.searchParams.set('evidenceFetchLimit', '0')
  url.searchParams.set('mapsImport', '0')
  url.searchParams.set('hunterSearch', '0')

  if (kind === 'queue') {
    url.searchParams.set('queueOnly', '1')
    url.searchParams.set('leadScout', '0')
    url.searchParams.set('publicSearch', '0')
    return
  }

  url.searchParams.set('queueOnly', '0')
  url.searchParams.set('leadScout', envBool('LEAD_SCOUT_ENABLED', true) ? '1' : '0')
  url.searchParams.set('leadScoutLimit', String(envInt('FREE_MAIL_PUMP_LEAD_SCOUT_LIMIT', 3, 0, 10)))
  url.searchParams.set('publicSearch', envBool('PUBLIC_SEARCH_SOURCE_ENABLED', true) ? '1' : '0')
  url.searchParams.set('publicSearchLimit', String(envInt('FREE_MAIL_PUMP_PUBLIC_SEARCH_LIMIT', 3, 0, 10)))
  url.searchParams.set('evidenceDeadlineMs', String(envInt('FREE_MAIL_PUMP_EVIDENCE_DEADLINE_MS', 8000, 1000, 15000)))
  url.searchParams.set('evidenceMaxPages', String(envInt('FREE_MAIL_PUMP_EVIDENCE_MAX_PAGES', 3, 1, 4)))
  url.searchParams.set('evidenceRequestTimeoutMs', String(envInt('FREE_MAIL_PUMP_EVIDENCE_REQUEST_TIMEOUT_MS', 1200, 500, 2500)))
}

function summarize(body: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(body)
    return {
      ok: parsed.ok,
      queued: parsed.summary?.queued,
      sentToday: parsed.summary?.sentToday,
      imported: parsed.summary?.imported,
      approved: parsed.summary?.approved,
      mode: parsed.plan?.mode,
      sendLimit: parsed.plan?.sendLimit,
      runQueue: parsed.plan?.runQueue,
      leadScout: parsed.plan?.runLeadScout,
      publicSearch: parsed.plan?.runPublicSearch,
    }
  } catch {
    return { body: body.slice(0, 280) }
  }
}

async function runCycle(kind: CycleKind): Promise<void> {
  const secret = process.env.CRON_SECRET || ''
  if (!secret) {
    console.warn('[free-mail-pump] skipped; CRON_SECRET is missing')
    return
  }

  const url = new URL('/api/cron/daily-outbound', localBaseUrl())
  appendCommonParams(url, kind)

  const startedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    envInt('FREE_MAIL_PUMP_TIMEOUT_MS', kind === 'queue' ? 45000 : 90000, 5000, 120000)
  )

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-cron-secret': secret,
        'user-agent': `Sovereign-Free-Mail-Pump/${kind}`,
      },
      cache: 'no-store',
      signal: controller.signal,
    })
    const body = await response.text()
    console.log('[free-mail-pump] cycle completed', {
      kind,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      ...summarize(body),
    })
  } catch (error) {
    console.error('[free-mail-pump] cycle failed', {
      kind,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function main() {
  const enabled = envBool('FREE_MAIL_PUMP_ENABLED', true)
  if (!enabled) {
    console.log('[free-mail-pump] disabled')
    return
  }

  const intervalMs = envInt('FREE_MAIL_PUMP_INTERVAL_MS', 15 * 60_000, 60_000, 60 * 60_000)
  const discoveryEveryMs = envInt('FREE_MAIL_PUMP_DISCOVERY_INTERVAL_MS', 60 * 60_000, 5 * 60_000, 24 * 60 * 60_000)
  const initialDelayMs = envInt('FREE_MAIL_PUMP_INITIAL_DELAY_MS', 45_000, 1_000, 10 * 60_000)
  let running = false
  let lastDiscoveryAt = 0

  console.log('[free-mail-pump] started', {
    intervalMs,
    discoveryEveryMs,
    initialDelayMs,
    baseUrl: localBaseUrl(),
  })

  const tick = async () => {
    if (running) {
      console.warn('[free-mail-pump] previous cycle still running; skipping tick')
      return
    }
    running = true
    try {
      await runCycle('queue')
      const discoveryDue = Date.now() - lastDiscoveryAt >= discoveryEveryMs
      if (discoveryDue) {
        lastDiscoveryAt = Date.now()
        await runCycle('discovery')
      }
    } finally {
      running = false
    }
  }

  setTimeout(() => void tick(), initialDelayMs)
  setInterval(() => void tick(), intervalMs)
}

void main()
