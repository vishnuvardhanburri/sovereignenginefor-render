#!/usr/bin/env node
/**
 * Sovereign Engine — Autonomous Outbound Brain Cron
 *
 * Calls the daily-outbound API route which runs all stages:
 *   lead_scout → maps_import → sheet_import → research_approval → queue_outbound
 *
 * Set OUTBOUND_CRON_ENABLED=true in Render to activate.
 * All behaviour (volume, mode, limits) is controlled by env vars on the API service.
 */

const MAX_RETRIES = 2
const RETRY_DELAY_MS = 8_000
const REQUEST_TIMEOUT_MS = 270_000 // 4.5 min — Render cron timeout is 300s

function isEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function buildCronUrl() {
  // Prefer explicit API URL over guessing from APP_DOMAIN.
  const base =
    process.env.OUTBOUND_CRON_API_URL ||
    process.env.SOVEREIGN_API_URL ||
    (() => {
      const protocol = process.env.APP_PROTOCOL || 'https'
      const domain = process.env.APP_DOMAIN || 'sovereign-engine-api.onrender.com'
      return `${protocol}://${domain}`
    })()

  const url = new URL('/api/cron/daily-outbound', base)

  // Growth mode — drives high-confidence lead throughput
  url.searchParams.set('mode', process.env.DAILY_OUTBOUND_MODE || 'growth')

  // Recovery mode — allows trickle sends on recovering domains
  if (isEnabled(process.env.DAILY_OUTBOUND_RECOVERY_MODE)) {
    url.searchParams.set('recoveryMode', 'true')
  }

  // Lead sources
  if (isEnabled(process.env.LEAD_SCOUT_ENABLED)) {
    url.searchParams.set('leadScout', 'true')
    if (isEnabled(process.env.DAILY_OUTBOUND_SKIP_LEAD_EVIDENCE_VERIFICATION)) {
      url.searchParams.set('skipLeadEvidence', 'true')
    }
    if (process.env.LEAD_SCOUT_DAILY_LIMIT) {
      url.searchParams.set('leadScoutLimit', process.env.LEAD_SCOUT_DAILY_LIMIT)
    }
  }

  if (
    isEnabled(process.env.DAILY_OUTBOUND_RUN_MAPS) ||
    isEnabled(process.env.GOOGLE_MAPS_SOURCE_ENABLED) ||
    isEnabled(process.env.GOOGLE_MAPS_SOURCE_ENABLE)
  ) {
    url.searchParams.set('mapsImport', 'true')
  }

  if (
    isEnabled(process.env.DAILY_OUTBOUND_RUN_PUBLIC_SEARCH) ||
    isEnabled(process.env.PUBLIC_SEARCH_SOURCE_ENABLED)
  ) {
    url.searchParams.set('publicSearch', 'true')
  }

  if (isEnabled(process.env.DAILY_OUTBOUND_RUN_HUNTER) || isEnabled(process.env.HUNTER_DOMAIN_SEARCH_ENABLED)) {
    url.searchParams.set('hunterSearch', 'true')
  }

  // Volume targets (safety: capped by reputation health on the server side)
  if (process.env.DAILY_OUTBOUND_SEND_LIMIT) {
    url.searchParams.set('sendLimit', process.env.DAILY_OUTBOUND_SEND_LIMIT)
  }
  if (process.env.DAILY_OUTBOUND_APPROVE_LIMIT) {
    url.searchParams.set('approveLimit', process.env.DAILY_OUTBOUND_APPROVE_LIMIT)
  }
  if (process.env.DAILY_OUTBOUND_TARGET_DAILY_VOLUME) {
    url.searchParams.set('targetDailyVolume', process.env.DAILY_OUTBOUND_TARGET_DAILY_VOLUME)
  }

  // Apify Google Maps parameters
  if (process.env.APIFY_GOOGLE_MAPS_ACTOR_ID) {
    url.searchParams.set('mapsActorId', process.env.APIFY_GOOGLE_MAPS_ACTOR_ID)
  }
  if (process.env.APIFY_GOOGLE_MAPS_SEARCHES) {
    url.searchParams.set('mapsSearches', process.env.APIFY_GOOGLE_MAPS_SEARCHES)
  }
  if (process.env.APIFY_GOOGLE_MAPS_LOCATION) {
    url.searchParams.set('mapsLocation', process.env.APIFY_GOOGLE_MAPS_LOCATION)
  }

  // Lead scout targeting
  if (process.env.LEAD_SCOUT_INDUSTRIES) {
    // Rotate industries — pick one per cron call
    const industries = process.env.LEAD_SCOUT_INDUSTRIES.split(',').map((s) => s.trim()).filter(Boolean)
    if (industries.length > 0) {
      const hour = new Date().getUTCHours()
      url.searchParams.set('industry', industries[hour % industries.length])
    }
  }
  if (process.env.LEAD_SCOUT_PERSONA) {
    url.searchParams.set('persona', process.env.LEAD_SCOUT_PERSONA)
  }
  if (process.env.LEAD_SCOUT_REGION) {
    url.searchParams.set('region', process.env.LEAD_SCOUT_REGION)
  }

  // Provider validation
  if (process.env.DAILY_OUTBOUND_PROVIDER_VALIDATION_LIMIT) {
    url.searchParams.set('providerValidationLimit', process.env.DAILY_OUTBOUND_PROVIDER_VALIDATION_LIMIT)
  }

  return url.toString()
}

async function callDailyOutbound(cronUrl, cronSecret, attempt) {
  console.log(`[cloud-outbound-cron] calling daily-outbound API (attempt ${attempt})`, { url: cronUrl })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(cronUrl, {
      method: 'POST',
      headers: {
        'x-cron-secret': cronSecret,
        'Content-Type': 'application/json',
        'User-Agent': 'SovereignEngineCron/2.0',
      },
      signal: controller.signal,
    })

    clearTimeout(timeout)

    const body = await response.json().catch(() => ({ ok: false, error: 'non-json-response' }))

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(body).slice(0, 300)}`)
    }

    return body
  } finally {
    clearTimeout(timeout)
  }
}

function summarise(result) {
  if (!result || typeof result !== 'object') return 'no result'
  const s = result.summary ?? {}
  const parts = []
  if (s.queued !== undefined) parts.push(`queued=${s.queued}`)
  if (s.approved !== undefined) parts.push(`approved=${s.approved}`)
  if (s.imported !== undefined) parts.push(`imported=${s.imported}`)
  if (s.estimatedPipelineValueUsd) parts.push(`pipeline=$${s.estimatedPipelineValueUsd}`)
  if (s.hardFailures) parts.push(`failures=${s.hardFailures}`)
  if (s.capacityBlocker) parts.push(`blocker=${String(s.capacityBlocker).slice(0, 60)}`)
  return parts.join(' | ') || 'ok'
}

async function main() {
  if (!isEnabled(process.env.OUTBOUND_CRON_ENABLED)) {
    console.log(
      '[cloud-outbound-cron] OUTBOUND_CRON_ENABLED is not set to true. ' +
      'Set it in Render env vars after DNS authentication, SMTP credentials, ' +
      'and lead approval are ready.'
    )
    return
  }

  const cronSecret = process.env.CRON_SECRET || ''
  if (!cronSecret) {
    console.error('[cloud-outbound-cron] CRON_SECRET is not set. Cannot authenticate cron call.')
    process.exit(1)
  }

  const cronUrl = buildCronUrl()
  let lastError = null

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const result = await callDailyOutbound(cronUrl, cronSecret, attempt)

      const summary = summarise(result)
      console.log('[cloud-outbound-cron] completed successfully', {
        ok: result.ok,
        dryRun: result.dryRun,
        summary,
        generatedAt: result.generatedAt,
      })

      if (!result.ok) {
        // Soft failure — stages had errors but the cron itself ran. Log and exit 0
        // (Render cron treats non-zero exit as a hard failure requiring manual review).
        console.warn('[cloud-outbound-cron] one or more stages reported errors', {
          hardFailures: result.summary?.hardFailures,
          stages: result.stages?.filter((s) => !s.ok).map((s) => ({ stage: s.stage, error: s.error })),
        })
      }

      return // success
    } catch (error) {
      lastError = error
      const isLastAttempt = attempt > MAX_RETRIES
      console.error(`[cloud-outbound-cron] attempt ${attempt} failed`, {
        error: error?.message ?? String(error),
        willRetry: !isLastAttempt,
      })
      if (!isLastAttempt) {
        await sleep(RETRY_DELAY_MS * attempt)
      }
    }
  }

  // All retries exhausted — exit non-zero so Render marks the cron as failed
  console.error('[cloud-outbound-cron] all attempts failed', { error: lastError?.message ?? String(lastError) })
  process.exit(1)
}

main().catch((error) => {
  console.error('[cloud-outbound-cron] unexpected fatal error', error)
  process.exit(1)
})
