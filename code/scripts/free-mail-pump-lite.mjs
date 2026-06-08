#!/usr/bin/env node

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'on'])
const FALSE_VALUES = new Set(['0', 'false', 'no', 'n', 'off'])

function envBool(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === null || raw === '') return fallback
  const normalized = String(raw).trim().toLowerCase()
  if (TRUE_VALUES.has(normalized)) return true
  if (FALSE_VALUES.has(normalized)) return false
  return fallback
}

function envInt(name, fallback, min, max) {
  const parsed = Number.parseInt(String(process.env[name] ?? ''), 10)
  const value = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
  return Math.max(min, Math.min(value, max))
}

function freeTierSafeMode() {
  const profile = String(process.env.WEB_MEMORY_PROFILE || '').trim().toLowerCase()
  return profile === 'free' || profile === 'small' || envBool('WEB_FREE_TIER_SAFE_MODE', false)
}

function localBaseUrl() {
  const explicit = String(process.env.FREE_MAIL_PUMP_BASE_URL || '').trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  return `http://127.0.0.1:${process.env.PORT || '10000'}`
}

function summarize(body) {
  try {
    const parsed = JSON.parse(body)
    return {
      ok: parsed.ok,
      queued: parsed.summary?.queued,
      imported: parsed.summary?.imported,
      approved: parsed.summary?.approved,
      sentToday: parsed.summary?.sentToday,
      terminalDuplicateContactsRepaired: parsed.summary?.terminalDuplicateContactsRepaired,
      mode: parsed.plan?.mode,
      sendLimit: parsed.plan?.sendLimit,
      leadScout: parsed.plan?.runLeadScout,
      publicSearch: parsed.plan?.runPublicSearch,
    }
  } catch {
    return { body: body.slice(0, 280) }
  }
}

function appendCommonParams(url, kind, discoverySource = 'both') {
  const safeMode = freeTierSafeMode()
  const clientId = envInt('DEFAULT_CLIENT_ID', 1, 1, 1_000_000)
  const sendLimit = envInt('FREE_MAIL_PUMP_SEND_LIMIT', safeMode ? 5 : 5, 0, safeMode ? 10 : 25)
  const approveLimit = envInt('FREE_MAIL_PUMP_APPROVE_LIMIT', safeMode ? 25 : 25, 1, safeMode ? 50 : 250)
  const maxDailyVolume = envInt('FREE_MAIL_PUMP_MAX_DAILY_VOLUME', safeMode ? 80 : 120, 1, 800)
  const configuredTargetDailyVolume = envInt(
    'DAILY_OUTBOUND_TARGET_DAILY_VOLUME',
    envInt('DAILY_OUTBOUND_PROVIDER_MAX_SEND_LIMIT', 800, 1, 1_000_000),
    1,
    1_000_000
  )
  const providerMaxDailyVolume = envInt(
    'DAILY_OUTBOUND_PROVIDER_MAX_SEND_LIMIT',
    envInt('DAILY_OUTBOUND_GROWTH_MAX_SEND_LIMIT', 800, 1, 1_000_000),
    1,
    1_000_000
  )
  const targetDailyVolume = Math.max(configuredTargetDailyVolume, providerMaxDailyVolume)

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
  const runLeadScout =
    discoverySource !== 'public_search' && envBool('LEAD_SCOUT_ENABLED', true)
  const runPublicSearch =
    discoverySource !== 'lead_scout' && envBool('PUBLIC_SEARCH_SOURCE_ENABLED', true)

  url.searchParams.set('leadScout', runLeadScout ? '1' : '0')
  url.searchParams.set('leadScoutLimit', String(envInt('FREE_MAIL_PUMP_LEAD_SCOUT_LIMIT', safeMode ? 20 : 25, 0, safeMode ? 40 : 250)))
  url.searchParams.set('publicSearch', runPublicSearch ? '1' : '0')
  url.searchParams.set('publicSearchLimit', String(envInt('FREE_MAIL_PUMP_PUBLIC_SEARCH_LIMIT', safeMode ? 5 : 10, 0, safeMode ? 10 : 250)))
  url.searchParams.set('evidenceDeadlineMs', String(envInt('FREE_MAIL_PUMP_EVIDENCE_DEADLINE_MS', safeMode ? 6000 : 8000, 800, safeMode ? 10000 : 15000)))
  url.searchParams.set('evidenceMaxPages', String(envInt('FREE_MAIL_PUMP_EVIDENCE_MAX_PAGES', safeMode ? 2 : 3, 1, safeMode ? 3 : 4)))
  url.searchParams.set('evidenceRequestTimeoutMs', String(envInt('FREE_MAIL_PUMP_EVIDENCE_REQUEST_TIMEOUT_MS', safeMode ? 1200 : 1200, 400, safeMode ? 2000 : 2500)))
}

async function runCycle(kind, discoverySource = 'both') {
  const secret = process.env.CRON_SECRET || ''
  if (!secret) {
    console.warn('[free-mail-pump-lite] skipped; CRON_SECRET is missing')
    return
  }

  const url = new URL('/api/cron/daily-outbound', localBaseUrl())
  appendCommonParams(url, kind, discoverySource)

  const safeMode = freeTierSafeMode()
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    envInt('FREE_MAIL_PUMP_TIMEOUT_MS', kind === 'queue' ? 35000 : safeMode ? 18000 : 90000, 5000, safeMode ? 45000 : 120000)
  )
  const startedAt = Date.now()

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-cron-secret': secret,
        'user-agent': `Sovereign-Free-Mail-Pump-Lite/${kind}`,
      },
      cache: 'no-store',
      signal: controller.signal,
    })
    const body = await response.text()
    console.log('[free-mail-pump-lite] cycle completed', {
      kind,
      discoverySource: kind === 'discovery' ? discoverySource : undefined,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      ...summarize(body),
    })
  } catch (error) {
    console.error('[free-mail-pump-lite] cycle failed', {
      kind,
      discoverySource: kind === 'discovery' ? discoverySource : undefined,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function main() {
  if (!envBool('FREE_MAIL_PUMP_ENABLED', true)) {
    console.log('[free-mail-pump-lite] disabled')
    return
  }

  const safeMode = freeTierSafeMode()
  const intervalMs = envInt(
    'FREE_MAIL_PUMP_INTERVAL_MS',
    safeMode ? 15 * 60_000 : 15 * 60_000,
    safeMode ? 10 * 60_000 : 60_000,
    60 * 60_000
  )
  const discoveryEveryMs = envInt(
    'FREE_MAIL_PUMP_DISCOVERY_INTERVAL_MS',
    safeMode ? 60 * 60_000 : 60 * 60_000,
    safeMode ? 30 * 60_000 : 5 * 60_000,
    24 * 60 * 60_000
  )
  const initialDelayMs = envInt('FREE_MAIL_PUMP_INITIAL_DELAY_MS', safeMode ? 60_000 : 45_000, 5_000, 10 * 60_000)
  const discoveryEnabled = envBool('FREE_MAIL_PUMP_DISCOVERY_ENABLED', true)
  const discoveryOnStart = envBool('FREE_MAIL_PUMP_DISCOVERY_ON_START', true)

  let running = false
  let lastDiscoveryAt = discoveryOnStart ? 0 : Date.now()
  let discoveryRuns = 0

  console.log('[free-mail-pump-lite] started', {
    intervalMs,
    discoveryEveryMs,
    initialDelayMs,
    discoveryEnabled,
    discoveryOnStart,
    safeMode,
    baseUrl: localBaseUrl(),
  })

  const tick = async () => {
    if (running) {
      console.warn('[free-mail-pump-lite] previous cycle still running; skipping tick')
      return
    }
    running = true
    try {
      await runCycle('queue')
      const discoveryDue = discoveryEnabled && Date.now() - lastDiscoveryAt >= discoveryEveryMs
      if (discoveryDue) {
        lastDiscoveryAt = Date.now()
        const sourceMode = String(process.env.FREE_MAIL_PUMP_DISCOVERY_SOURCE_MODE || (safeMode ? 'lead_scout' : 'both'))
          .trim()
          .toLowerCase()
        const discoverySource =
          sourceMode === 'lead_scout'
            ? 'lead_scout'
            : sourceMode === 'public_search'
              ? 'public_search'
              : sourceMode === 'both'
                ? 'both'
                : discoveryRuns % 2 === 0
                  ? 'public_search'
                  : 'lead_scout'
        discoveryRuns += 1
        await runCycle('discovery', discoverySource)
      }
    } finally {
      running = false
    }
  }

  setTimeout(() => void tick(), initialDelayMs)
  setInterval(() => void tick(), intervalMs)
}

void main()
