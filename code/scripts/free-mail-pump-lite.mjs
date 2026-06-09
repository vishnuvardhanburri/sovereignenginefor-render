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

function summarizeParsed(parsed) {
  const stages = Array.isArray(parsed.stages) ? parsed.stages : []
  const queueStage = stages.find((stage) => stage?.stage === 'queue_outbound')
  const failedStages = stages
    .filter((stage) => stage && stage.ok === false)
    .map((stage) => `${stage.stage}:${String(stage.error || stage.skipped || 'failed').slice(0, 80)}`)

  const s = parsed.summary ?? {}
  return {
    ok: parsed.ok,
    queued: s.queued,
    imported: s.imported,
    approved: s.approved,
    sentToday: s.sentToday ?? s.dailySentBeforeCycle,
    terminalDuplicateContactsRepaired: s.terminalDuplicateContactsRepaired,
    mode: parsed.plan?.mode,
    sendLimit: parsed.plan?.sendLimit,
    leadScout: parsed.plan?.runLeadScout,
    publicSearch: parsed.plan?.runPublicSearch,
    researchUnlimited: parsed.plan?.researchUnlimited,
    readyInventoryTarget: parsed.plan?.readyInventoryTarget,
    queueSkipped: queueStage?.data?.skipped,
    failedStages: failedStages.length ? failedStages : undefined,
  }
}

function parseCompactValue(value) {
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value)
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}

function parseCompactBody(body) {
  const fields = {}
  for (const token of body.trim().split(/\s+/)) {
    const [rawKey, ...rest] = token.split('=')
    if (!rawKey || rest.length === 0) continue
    fields[rawKey] = parseCompactValue(rest.join('='))
  }
  if (!Object.keys(fields).length) return null

  return {
    ok: fields.ok === 1 || fields.ok === '1' || fields.ok === true,
    queued: fields.queued,
    imported: fields.imported,
    approved: fields.approved,
    sentToday: fields.sentBefore,
    mode: fields.mode,
    sendLimit: fields.sendLimit,
    researchUnlimited: fields.researchUnlimited === 1 || fields.researchUnlimited === '1',
    readyInventoryTarget: fields.readyTarget,
    capacity: fields.capacity,
    blocker: fields.blocker,
    raw: fields,
  }
}

function parseCycleBody(body) {
  try {
    const parsed = JSON.parse(body)
    return {
      parsed,
      summary: summarizeParsed(parsed),
    }
  } catch {
    const summary = parseCompactBody(body)
    if (summary) {
      return {
        parsed: null,
        summary,
      }
    }
    return {
      parsed: null,
      summary: { body: body.slice(0, 280) },
    }
  }
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function resultQueued(result) {
  return numberValue(result?.queued, 0)
}

function resultImportedOrApproved(result) {
  return numberValue(result?.imported, 0) + numberValue(result?.approved, 0)
}

function resultSentToday(result) {
  return numberValue(result?.sentToday, 0)
}

function appendCommonParams(url, kind, discoverySource = 'both') {
  const safeMode = freeTierSafeMode()
  const clientId = envInt('DEFAULT_CLIENT_ID', 1, 1, 1_000_000)
  const sendLimit = envInt('FREE_MAIL_PUMP_SEND_LIMIT', safeMode ? 5 : 5, 0, safeMode ? 10 : 25)
  const queueApproveLimit = envInt('FREE_MAIL_PUMP_APPROVE_LIMIT', safeMode ? 25 : 25, 1, safeMode ? 50 : 250)
  const researchApproveLimit = envInt(
    'FREE_MAIL_PUMP_RESEARCH_APPROVE_LIMIT',
    safeMode ? 100 : 250,
    1,
    safeMode ? 250 : 1_000
  )
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
  url.searchParams.set(
    'approveLimit',
    String(kind === 'queue' ? queueApproveLimit : Math.max(queueApproveLimit, researchApproveLimit))
  )
  url.searchParams.set('mapsImport', '0')
  url.searchParams.set('hunterSearch', '0')

  if (kind === 'queue') {
    url.searchParams.set('providerValidationLimit', '0')
    url.searchParams.set('evidenceFetchLimit', '0')
    url.searchParams.set('queueOnly', '1')
    url.searchParams.set('leadScout', '0')
    url.searchParams.set('publicSearch', '0')
    return
  }

  url.searchParams.set('queueOnly', '0')
  url.searchParams.set('researchUnlimited', envBool('FREE_MAIL_PUMP_RESEARCH_UNLIMITED', true) ? '1' : '0')
  url.searchParams.set(
    'readyInventoryTarget',
    String(envInt('FREE_MAIL_PUMP_READY_INVENTORY_TARGET', safeMode ? 800 : 2_000, 1, 100_000))
  )
  url.searchParams.set(
    'providerValidationLimit',
    String(envInt('FREE_MAIL_PUMP_PROVIDER_VALIDATION_LIMIT', safeMode ? 80 : 250, 0, safeMode ? 250 : 1_000))
  )
  url.searchParams.set(
    'evidenceFetchLimit',
    String(envInt('FREE_MAIL_PUMP_EVIDENCE_FETCH_LIMIT', safeMode ? 8 : 20, 0, safeMode ? 20 : 100))
  )
  const runLeadScout =
    discoverySource !== 'public_search' && envBool('LEAD_SCOUT_ENABLED', true)
  const runPublicSearch =
    discoverySource !== 'lead_scout' && envBool('PUBLIC_SEARCH_SOURCE_ENABLED', true)

  url.searchParams.set('leadScout', runLeadScout ? '1' : '0')
  url.searchParams.set('leadScoutLimit', String(envInt('FREE_MAIL_PUMP_LEAD_SCOUT_LIMIT', safeMode ? 40 : 100, 0, safeMode ? 120 : 1_000)))
  url.searchParams.set('publicSearch', runPublicSearch ? '1' : '0')
  url.searchParams.set('publicSearchLimit', String(envInt('FREE_MAIL_PUMP_PUBLIC_SEARCH_LIMIT', safeMode ? 20 : 100, 0, safeMode ? 120 : 1_000)))
  url.searchParams.set('evidenceDeadlineMs', String(envInt('FREE_MAIL_PUMP_EVIDENCE_DEADLINE_MS', safeMode ? 6000 : 8000, 800, safeMode ? 10000 : 15000)))
  url.searchParams.set('evidenceMaxPages', String(envInt('FREE_MAIL_PUMP_EVIDENCE_MAX_PAGES', safeMode ? 2 : 3, 1, safeMode ? 3 : 4)))
  url.searchParams.set('evidenceRequestTimeoutMs', String(envInt('FREE_MAIL_PUMP_EVIDENCE_REQUEST_TIMEOUT_MS', safeMode ? 1200 : 1200, 400, safeMode ? 2000 : 2500)))
}

async function runCycle(kind, discoverySource = 'both') {
  const secret = process.env.CRON_SECRET || ''
  if (!secret) {
    console.warn('[free-mail-pump-lite] skipped; CRON_SECRET is missing')
    return { ok: false, skipped: 'missing_cron_secret' }
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
    const { summary } = parseCycleBody(body)
    console.log('[free-mail-pump-lite] cycle completed', {
      kind,
      discoverySource: kind === 'discovery' ? discoverySource : undefined,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      ...summary,
    })
    return {
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      responseOk: response.ok,
      ...summary,
    }
  } catch (error) {
    const result = {
      kind,
      discoverySource: kind === 'discovery' ? discoverySource : undefined,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }
    console.error('[free-mail-pump-lite] cycle failed', result)
    return { ok: false, ...result }
  } finally {
    clearTimeout(timeout)
  }
}

function discoverySourceSequence(sourceMode, discoveryRuns, allowFallback) {
  const normalized = String(sourceMode || '').trim().toLowerCase()
  if (normalized === 'lead_scout') return allowFallback ? ['lead_scout', 'public_search'] : ['lead_scout']
  if (normalized === 'public_search') return allowFallback ? ['public_search', 'lead_scout'] : ['public_search']
  if (normalized === 'both') return ['both']
  return discoveryRuns % 2 === 0
    ? (allowFallback ? ['public_search', 'lead_scout'] : ['public_search'])
    : (allowFallback ? ['lead_scout', 'public_search'] : ['lead_scout'])
}

async function runDiscoverySequence(sourceMode, discoveryRuns, allowFallback) {
  const sources = discoverySourceSequence(sourceMode, discoveryRuns, allowFallback)
  const results = []
  for (const source of sources) {
    const result = await runCycle('discovery', source)
    results.push(result)
    if (resultQueued(result) > 0 || resultImportedOrApproved(result) > 0) break
  }
  return results
}

function shouldRecoverStarvedQueue(queueResult, safeMode) {
  if (!envBool('FREE_MAIL_PUMP_STARVATION_RECOVERY_ENABLED', true)) return false
  const queued = resultQueued(queueResult)
  const sentToday = resultSentToday(queueResult)
  const minSentToday = envInt('FREE_MAIL_PUMP_STARVATION_MIN_SENT_TODAY', safeMode ? 1 : 1, 0, 800)
  return queued === 0 && sentToday <= minSentToday
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
  const starvationCooldownMs = envInt(
    'FREE_MAIL_PUMP_STARVATION_RECOVERY_COOLDOWN_MS',
    safeMode ? 30 * 60_000 : 15 * 60_000,
    5 * 60_000,
    6 * 60 * 60_000
  )

  let running = false
  let lastDiscoveryAt = discoveryOnStart ? 0 : Date.now()
  let lastStarvationRecoveryAt = 0
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
      const queueResult = await runCycle('queue')
      const discoveryDue = discoveryEnabled && Date.now() - lastDiscoveryAt >= discoveryEveryMs
      const starvationDue =
        discoveryEnabled &&
        shouldRecoverStarvedQueue(queueResult, safeMode) &&
        Date.now() - lastStarvationRecoveryAt >= starvationCooldownMs
      if (discoveryDue || starvationDue) {
        lastDiscoveryAt = Date.now()
        if (starvationDue) lastStarvationRecoveryAt = Date.now()
        const sourceMode = String(process.env.FREE_MAIL_PUMP_DISCOVERY_SOURCE_MODE || (safeMode ? 'lead_scout' : 'both'))
          .trim()
          .toLowerCase()
        const allowFallback = starvationDue || envBool('FREE_MAIL_PUMP_DISCOVERY_FALLBACK_ENABLED', true)
        discoveryRuns += 1
        console.log('[free-mail-pump-lite] discovery requested', {
          reason: starvationDue ? 'queue_starvation' : 'scheduled',
          sourceMode,
          allowFallback,
          queueResult: {
            queued: queueResult?.queued,
            sentToday: queueResult?.sentToday,
            queueSkipped: queueResult?.queueSkipped,
          },
        })
        const discoveryResults = await runDiscoverySequence(sourceMode, discoveryRuns, allowFallback)
        const foundInventory = discoveryResults.some(
          (result) => resultQueued(result) > 0 || resultImportedOrApproved(result) > 0
        )
        if (starvationDue || foundInventory) {
          await runCycle('queue')
        }
      }
    } finally {
      running = false
    }
  }

  setTimeout(() => void tick(), initialDelayMs)
  setInterval(() => void tick(), intervalMs)
}

void main()
