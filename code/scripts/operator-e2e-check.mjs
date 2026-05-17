#!/usr/bin/env node

const DEFAULT_BASE_URL = 'https://sovereignenginefor-render.onrender.com'
const args = new Map()

for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--([^=]+)=(.*)$/)
  if (match) args.set(match[1], match[2])
}

const baseUrl = String(args.get('base-url') || process.env.SOVEREIGN_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
const sheetUrl = String(args.get('sheet-url') || process.env.SHEET_URL || '').trim()
const githubRepo = String(args.get('github-repo') || process.env.GITHUB_REPO || 'vishnuvardhanburri/sovereignenginefor-render')
const runTelegramLiveTest = ['1', 'true', 'yes'].includes(String(process.env.TELEGRAM_LIVE_TEST || '').toLowerCase())

const results = []
const warnings = []

function record(ok, name, detail = '') {
  results.push({ ok, name, detail })
  const status = ok ? 'PASS' : 'FAIL'
  console.log(`[${status}] ${name}${detail ? ` - ${detail}` : ''}`)
}

function warn(name, detail = '') {
  warnings.push({ name, detail })
  console.log(`[WARN] ${name}${detail ? ` - ${detail}` : ''}`)
}

async function fetchText(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init)
  return { response, text: await response.text() }
}

async function fetchJson(path, init) {
  const { response, text } = await fetchText(path, init)
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // Keep text for diagnostics.
  }
  return { response, json, text }
}

async function checkRoutes() {
  const publicRoutes = ['/login', '/pricing', '/sent']
  const protectedRoutes = ['/contacts', '/campaigns', '/dashboard']

  for (const route of publicRoutes) {
    const { response } = await fetchText(route)
    record(response.status === 200, `route ${route}`, `HTTP ${response.status}`)
  }

  for (const route of protectedRoutes) {
    const { response } = await fetchText(route, { redirect: 'manual' })
    record([200, 302, 307, 308].includes(response.status), `protected route ${route}`, `HTTP ${response.status}`)
  }
}

async function checkPricingCopy() {
  const { response, text } = await fetchText('/pricing')
  const ok =
    response.ok &&
    text.includes('Sovereign Stack') &&
    text.includes('25,000') &&
    text.includes('Agency Master')
  record(ok, 'pricing positioning', ok ? 'Sovereign Stack $25K/$100K copy visible' : `HTTP ${response.status}`)
}

async function checkHealth() {
  const { response, json, text } = await fetchJson('/api/health/stats?client_id=1')
  if (!response.ok || !json?.ok) {
    record(false, 'health oracle', text.slice(0, 160))
    return
  }

  const redisOk = Boolean(json.redis?.set_ok && json.redis?.get_ok)
  const workerActive = Number(json.workers?.sender?.active || 0)
  const failedJobs = Number(json.bullmq?.failed || 0) + Number(json.db_queue?.failed || 0)
  const emailConfigured = Boolean(
    json.email_delivery?.has_resend_key ||
    json.email_delivery?.has_brevo_key ||
    json.email_delivery?.smtp_from_email_configured
  )

  record(redisOk, 'redis connectivity', redisOk ? 'set/get ok' : 'set/get failed')
  record(Boolean(json.postgres), 'postgres connectivity', `reputation rows ${json.postgres?.reputation_state_count ?? 0}`)
  record(workerActive > 0, 'sender worker heartbeat', `${workerActive} active`)
  record(failedJobs === 0, 'queue failure state', `${failedJobs} failed jobs`)
  record(emailConfigured, 'email provider configured', json.email_delivery?.selected_provider || 'not configured')

  const redisMs = Math.max(
    Number(json.infrastructure_latency?.redis_set_ms || 0),
    Number(json.infrastructure_latency?.redis_get_ms || 0)
  )
  if (redisMs > 200) warn('redis latency elevated', `${redisMs.toFixed(1)}ms`)
}

async function checkTelegramGuard() {
  const unauthorized = await fetchJson('/api/telegram/test')
  record(unauthorized.response.status === 401, 'telegram secret guard', `HTTP ${unauthorized.response.status}`)

  if (!runTelegramLiveTest) {
    warn('telegram live send skipped', 'Set TELEGRAM_LIVE_TEST=1 and CRON_SECRET in your local shell to send a test notification.')
    return
  }

  const secret = process.env.CRON_SECRET
  if (!secret) {
    record(false, 'telegram live test', 'CRON_SECRET missing locally')
    return
  }

  const live = await fetchJson('/api/telegram/test', {
    headers: { 'x-cron-secret': secret },
  })
  record(Boolean(live.response.ok && live.json?.ok), 'telegram live test', live.json?.telegram?.ok ? 'message accepted' : live.text.slice(0, 160))
}

async function checkDailyAutopilotGuard() {
  const unauthorized = await fetchJson('/api/cron/daily-outbound?client_id=1&dryRun=1')
  record(unauthorized.response.status === 401, 'daily autopilot secret guard', `HTTP ${unauthorized.response.status}`)

  const secret = process.env.CRON_SECRET
  if (!secret) {
    warn('daily autopilot dry-run skipped', 'Set CRON_SECRET locally to validate the protected dry-run endpoint.')
    return
  }

  const params = new URLSearchParams({
    client_id: '1',
    dryRun: '1',
  })
  if (sheetUrl) params.set('sheetUrl', sheetUrl)

  const dryRun = await fetchJson(`/api/cron/daily-outbound?${params.toString()}`, {
    headers: { 'x-cron-secret': secret },
  })
  record(
    Boolean(dryRun.response.ok && dryRun.json?.ok && dryRun.json?.dryRun),
    'daily autopilot dry-run',
    dryRun.json?.summary
      ? `import ${dryRun.json.summary.imported}, approve ${dryRun.json.summary.approved}, queue ${dryRun.json.summary.queued}`
      : dryRun.text.slice(0, 180)
  )
}

async function checkSheet() {
  if (!sheetUrl) {
    warn('google sheet preview skipped', 'Pass --sheet-url=... or SHEET_URL=...')
    return
  }

  const params = new URLSearchParams({
    sheetUrl,
    limit: '100',
    dedupeByDomain: 'true',
  })
  const { response, json, text } = await fetchJson(`/api/contacts/import/google-sheet?${params.toString()}`)
  if (!response.ok || !json?.ok) {
    record(false, 'google sheet preview', text.slice(0, 180))
    return
  }

  record(true, 'google sheet preview', `${json.summary?.rows ?? 0} rows scanned`)
  const valid = Number(json.summary?.valid || 0)
  const rejected = Number(json.summary?.rejected || 0)
  const evidence = Number(json.summary?.evidenceBacked || 0)
  if (valid === 0) {
    const counts = {}
    for (const item of json.rejected || []) counts[item.reason] = (counts[item.reason] || 0) + 1
    warn('sheet has no send-ready leads', `valid ${valid}, rejected ${rejected}, reasons ${JSON.stringify(counts)}`)
  } else {
    record(true, 'sheet send-ready filter', `${valid} usable, ${evidence} evidence-backed, ${rejected} filtered`)
  }
}

async function checkGithubCi() {
  const url = `https://api.github.com/repos/${githubRepo}/actions/runs?per_page=1`
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } })
  if (!response.ok) {
    warn('github ci check skipped', `HTTP ${response.status}`)
    return
  }
  const data = await response.json()
  const run = data.workflow_runs?.[0]
  if (!run) {
    warn('github ci check skipped', 'no workflow runs returned')
    return
  }
  record(run.status === 'completed' && run.conclusion === 'success', 'latest github ci', `${run.head_sha.slice(0, 7)} ${run.status}/${run.conclusion}`)
}

async function main() {
  console.log(`Sovereign operator E2E check`)
  console.log(`Base URL: ${baseUrl}`)
  console.log(`Mode: safe validation only. No real emails are sent.\n`)

  await checkGithubCi()
  await checkRoutes()
  await checkPricingCopy()
  await checkHealth()
  await checkTelegramGuard()
  await checkDailyAutopilotGuard()
  await checkSheet()

  const failures = results.filter((result) => !result.ok)
  console.log(`\nSummary: ${failures.length ? 'BLOCKED' : 'READY'} (${results.length - failures.length}/${results.length} checks passed, ${warnings.length} warning${warnings.length === 1 ? '' : 's'})`)

  if (failures.length > 0) {
    console.log('Blockers:')
    for (const failure of failures) console.log(`- ${failure.name}: ${failure.detail}`)
    process.exit(1)
  }

  if (warnings.length > 0) {
    console.log('Warnings:')
    for (const item of warnings) console.log(`- ${item.name}: ${item.detail}`)
  }
}

main().catch((error) => {
  console.error('[operator:e2e] failed', error instanceof Error ? error.message : error)
  process.exit(1)
})
