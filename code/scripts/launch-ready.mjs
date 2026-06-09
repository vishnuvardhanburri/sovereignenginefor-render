#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const flags = new Set(args)
const argValue = (name, fallback = '') => {
  const prefix = `${name}=`
  const found = args.find((arg) => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : fallback
}

const port = Number(argValue('--port', '3400'))
const baseUrl = `http://127.0.0.1:${port}`
const withBrowser = flags.has('--with-browser')
const skipBrowser = flags.has('--skip-browser') || flags.has('--quick') || !withBrowser
const skipPack = flags.has('--skip-pack') || flags.has('--quick')
const stopAfter = flags.has('--stop-after')
const withTypecheck = flags.has('--with-typecheck')
const withBuild = flags.has('--with-build')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const runDir = path.join(root, 'output', 'launch-ready', stamp)
const latestDir = path.join(root, 'output', 'launch-ready', 'latest')
const demoEnvFile = path.join(runDir, 'launch.env')

const demoEnv = {
  DATABASE_URL: 'postgresql://postgres:password@127.0.0.1:5432/sovereign_engine?sslmode=disable',
  REDIS_URL: 'redis://127.0.0.1:6379',
  CONTAINER_DATABASE_URL: 'postgresql://postgres:password@postgres:5432/sovereign_engine?sslmode=disable',
  CONTAINER_REDIS_URL: 'redis://redis:6379',
  APP_DOMAIN: `localhost:${port}`,
  APP_PROTOCOL: 'http',
  MOCK_SMTP: 'true',
  MOCK_SMTP_FASTLANE: 'true',
  ZEROBOUNCE_API_KEY: 'mock',
  SMTP_HOST: 'mock.local',
  SMTP_PORT: '587',
  SMTP_USER: 'mock@localhost',
  SMTP_PASS: 'mock',
  SMTP_SECURE: 'false',
  AUTH_SECRET: 'launch_ready_auth_secret_01234567890123456789',
  CRON_SECRET: 'launch_ready_cron_secret_01234567890123456789',
  SECURITY_KILL_SWITCH_TOKEN: 'launch_ready_kill_switch_01234567890123456789',
  SECRET_MASTER_KEY_ID: 'launch-ready-v1',
  SECRET_MASTER_KEY: 'launch_ready_master_key_01234567890123456789',
  SEND_ALLOW_UNKNOWN_VALIDATION: 'true',
  SENDER_WORKER_CONCURRENCY: '50',
  STRESS_TIMEOUT_MS: '60000',
  NEXT_TELEMETRY_DISABLED: '1',
  DEMO_BASE_URL: baseUrl,
  API_PORT: String(port),
  POSTGRES_PORT: '0',
  REDIS_PORT: '0',
  COMPOSE_PROJECT_NAME: 'sovereign-engine',
}

const results = []

fs.mkdirSync(runDir, { recursive: true })
fs.rmSync(latestDir, { recursive: true, force: true })
fs.mkdirSync(path.dirname(latestDir), { recursive: true })
fs.cpSync(runDir, latestDir, { recursive: true })
fs.writeFileSync(
  demoEnvFile,
  Object.entries(demoEnv)
    .map(([key, value]) => `${key}=${String(value).replace(/\n/g, '')}`)
    .join('\n') + '\n'
)
fs.copyFileSync(demoEnvFile, path.join(latestDir, 'launch.env'))

function log(message = '') {
  console.log(message)
}

function commandText(command, commandArgs) {
  return [command, ...commandArgs].join(' ')
}

function writeLog(name, output) {
  fs.writeFileSync(path.join(runDir, `${name}.log`), output || '')
  fs.writeFileSync(path.join(latestDir, `${name}.log`), output || '')
}

function runStep(name, command, commandArgs, options = {}) {
  const started = Date.now()
  log(`\n[RUN] ${name}`)
  log(`$ ${commandText(command, commandArgs)}`)
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: { ...process.env, ...demoEnv, ...(options.env || {}) },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 30 * 1024 * 1024,
    timeout: options.timeoutMs || 10 * 60 * 1000,
  })
  const output = `${result.stdout || ''}${result.stderr || ''}${result.error ? `\n${result.error.message}` : ''}`
  const durationMs = Date.now() - started
  const rawOk = result.status === 0
  const ok = rawOk || Boolean(options.allowFailure)
  writeLog(name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase(), output)
  results.push({
    name,
    command: commandText(command, commandArgs),
    ok,
    status: result.status ?? 1,
    durationMs,
    log: `${name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}.log`,
  })

  if (rawOk) {
    log(`[PASS] ${name} (${Math.round(durationMs / 1000)}s)`)
    return
  }

  const tail = output.trim().split('\n').slice(-28).join('\n')
  if (options.allowFailure) {
    log(`[WARN] ${name} (${Math.round(durationMs / 1000)}s)`)
    if (tail) log(tail)
    return
  }

  log(`[FAIL] ${name} (${Math.round(durationMs / 1000)}s)`)
  if (tail) log(tail)
  throw new Error(`${name} failed. See output/launch-ready/latest/${results.at(-1).log}`)
}

async function ensureDocker() {
  const name = 'Docker daemon'
  const logName = 'docker-daemon'
  const started = Date.now()
  log(`\n[RUN] ${name}`)

  const check = () =>
    spawnSync('docker', ['info'], {
      cwd: root,
      env: { ...process.env, ...demoEnv },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 5 * 1024 * 1024,
    })

  let result = check()
  let output = `${result.stdout || ''}${result.stderr || ''}`
  if (result.status !== 0 && process.platform === 'darwin') {
    if (/manually paused/i.test(output)) {
      log('Docker Desktop is paused. Restarting Docker Desktop to unpause...')
      spawnSync('docker', ['desktop', 'restart'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
      await new Promise((resolve) => setTimeout(resolve, 5_000))
      result = check()
      output = `${result.stdout || ''}${result.stderr || ''}`
    }
    log('Docker is not running. Opening Docker Desktop and waiting...')
    spawnSync('open', ['-a', 'Docker'], { stdio: 'ignore' })
    // Docker Desktop can take several minutes after a cold boot or upgrade.
    // We wait longer here so "pnpm launch:ready" behaves like a single-command
    // buyer proof instead of failing spuriously.
    const deadline = Date.now() + 600_000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 3_000))
      result = check()
      output = `${result.stdout || ''}${result.stderr || ''}`
      if (result.status === 0) break
      process.stdout.write('.')
    }
    process.stdout.write('\n')
  }

  const ok = result.status === 0
  const durationMs = Date.now() - started
  writeLog(logName, output)
  results.push({
    name,
    command: 'docker info',
    ok,
    status: result.status ?? 1,
    durationMs,
    log: `${logName}.log`,
  })
  if (!ok) {
    log(`[FAIL] ${name} (${Math.round(durationMs / 1000)}s)`)
    throw new Error(
      'Docker daemon is not running. Start Docker Desktop (approve any first-run prompts), then run pnpm launch:ready again.'
    )
  }
  log(`[PASS] ${name} (${Math.round(durationMs / 1000)}s)`)
}

async function waitForHttp(name, pathname, timeoutMs = 180_000) {
  const started = Date.now()
  const deadline = started + timeoutMs
  log(`\n[RUN] ${name}`)
  log(`Waiting for ${baseUrl}${pathname}`)
  let lastError = ''
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}${pathname}`)
      if (response.ok) {
        const durationMs = Date.now() - started
        const body = await response.text()
        writeLog(name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase(), `HTTP ${response.status}\n\n${body}`)
        results.push({
          name,
          command: `GET ${baseUrl}${pathname}`,
          ok: true,
          status: response.status,
          durationMs,
          log: `${name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}.log`,
        })
        log(`[PASS] ${name} (${Math.round(durationMs / 1000)}s)`)
        return
      }
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    process.stdout.write('.')
    await new Promise((resolve) => setTimeout(resolve, 3_000))
  }
  process.stdout.write('\n')
  const durationMs = Date.now() - started
  writeLog(name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase(), lastError)
  results.push({
    name,
    command: `GET ${baseUrl}${pathname}`,
    ok: false,
    status: 1,
    durationMs,
    log: `${name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}.log`,
  })
  throw new Error(`${name} timed out: ${lastError}`)
}

async function fetchStep(name, pathname, validate) {
  const started = Date.now()
  log(`\n[RUN] ${name}`)
  const url = `${baseUrl}${pathname}`
  log(`GET ${url}`)
  let output = ''
  try {
    const response = await fetch(url)
    const contentType = response.headers.get('content-type') || ''
    const body = await response.text()
    output = `HTTP ${response.status}\ncontent-type: ${contentType}\n\n${body}`
    let json = null
    try {
      json = body ? JSON.parse(body) : null
    } catch {
      // Non-JSON endpoint.
    }
    const ok = response.ok && (!validate || validate({ response, json, body }))
    const durationMs = Date.now() - started
    writeLog(name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase(), output)
    results.push({
      name,
      command: `GET ${url}`,
      ok,
      status: response.status,
      durationMs,
      log: `${name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}.log`,
    })
    if (!ok) throw new Error(`${name} returned HTTP ${response.status}`)
    log(`[PASS] ${name} (${Math.round(durationMs / 1000)}s)`)
  } catch (error) {
    const durationMs = Date.now() - started
    output ||= error instanceof Error ? error.stack || error.message : String(error)
    writeLog(name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase(), output)
    results.push({
      name,
      command: `GET ${url}`,
      ok: false,
      status: 1,
      durationMs,
      log: `${name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}.log`,
    })
    log(`[FAIL] ${name} (${Math.round(durationMs / 1000)}s)`)
    throw error
  }
}

function latestSubmitPack() {
  const dir = path.join(root, 'output', 'submit-pack')
  if (!fs.existsSync(dir)) return null
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const fullPath = path.join(dir, entry.name)
      return { name: entry.name, fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  return entries[0]?.fullPath || null
}

function writeSummary(ok, errorMessage = '') {
  const submitPack = latestSubmitPack()
  const summary = {
    ok,
    generatedAt: new Date().toISOString(),
    mode: skipBrowser || skipPack ? 'launch-proof' : 'launch-proof-with-browser',
    baseUrl,
    login: {
      email: 'demo@sovereign.local',
      password: 'Demo1234!',
    },
    evidenceDir: path.relative(root, latestDir),
    submitPack: submitPack ? path.relative(root, submitPack) : null,
    stopCommand: 'pnpm launch:stop',
    error: errorMessage,
    results,
  }
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2))
  fs.writeFileSync(path.join(latestDir, 'summary.json'), JSON.stringify(summary, null, 2))
  fs.writeFileSync(
    path.join(runDir, 'SUMMARY.md'),
    [
      `# Sovereign Engine Launch Readiness: ${ok ? 'PASS' : 'BLOCKED'}`,
      '',
      `Generated UTC: ${summary.generatedAt}`,
      `Base URL: ${baseUrl}`,
      `Evidence: ${summary.evidenceDir}`,
      submitPack ? `Submit pack: ${summary.submitPack}` : 'Submit pack: not generated',
      '',
      '## Results',
      '',
      ...results.map((result) => `- ${result.ok ? 'PASS' : 'FAIL'} ${result.name} (${Math.round(result.durationMs / 1000)}s)`),
      '',
      '## Demo Access',
      '',
      `- App: http://localhost:${port}/login`,
      '- Email: demo@sovereign.local',
      '- Password: Demo1234!',
      '',
      '## Stop Command',
      '',
      '`pnpm launch:stop`',
      '',
      errorMessage ? `## Blocker\n\n${errorMessage}\n` : '',
    ].join('\n')
  )
  fs.copyFileSync(path.join(runDir, 'SUMMARY.md'), path.join(latestDir, 'SUMMARY.md'))
}

async function main() {
  log('Sovereign Engine Launch Readiness')
  log('Mode: mock-safe end-to-end. No real email is sent.')
  log(`Port: ${port}`)
  log(`Evidence: ${path.relative(root, latestDir)}`)

  try {
    runStep('Brand check', 'pnpm', ['brand:check'])
    runStep('Buyer-safe copy check', 'pnpm', ['copy:check'])
    if (withTypecheck) runStep('Typecheck', 'pnpm', ['typecheck'])
    runStep('Production dry-run gate', 'node', ['scripts/final-production-check.mjs', `--env=${path.relative(root, demoEnvFile)}`])
    runStep('Stop stale local demo', 'pnpm', ['demo:buyer:stop'])
    await ensureDocker()
    // On some machines Docker Desktop can transiently return EOF while restarting.
    // Stopping the previous stack is best-effort: we still continue and rely on
    // compose up + health checks to prove readiness.
    runStep('Stop previous launch stack', 'pnpm', ['launch:stop'], { allowFailure: true })
    runStep('Production compose config', 'docker', ['compose', '-f', 'docker-compose.prod.yml', 'config'])
    runStep('Start production Docker stack', 'docker', [
      'compose',
      '-f',
      'docker-compose.prod.yml',
      'up',
      '-d',
      '--build',
      'api-gateway',
      'reputation-worker',
      'sender-worker',
    ], { timeoutMs: 15 * 60 * 1000 })
    if (withBuild) runStep('Local production build', 'pnpm', ['-C', 'apps/api-gateway', 'build'])
    await waitForHttp('Health oracle live', '/api/health/stats?client_id=1')
    runStep('Create demo login in Docker', 'docker', [
      'compose',
      '-f',
      'docker-compose.prod.yml',
      'run',
      '--rm',
      'migrate',
      'sh',
      '-lc',
      'node scripts/sync-env.mjs && pnpm user:create demo@sovereign.local Demo1234!',
    ])

    await fetchStep('Health oracle API', '/api/health/stats?client_id=1', ({ json }) => json?.ok === true)
    await fetchStep('Demo metrics API', '/demo/metrics', ({ json }) => json?.summary?.simulatedEventsProcessed === 10000)
    await fetchStep('Pricing page', '/pricing', ({ body }) => body.includes('Campaign Rescue Sprint') && body.includes('£5,000') && body.includes('£3,000/month'))
    await fetchStep('Trust certificate API', '/api/trust/summary?domain=sovereign-demo.example', ({ json }) => json?.ok === true)
    await fetchStep('Production gate API', '/api/production/gate?domain=sovereign-demo.example', ({ json }) => json?.ok === true && json?.realSendingAllowed === false)

    if (!skipBrowser) runStep('Browser QA screenshots', 'pnpm', ['qa:demo', `--base-url=${baseUrl}`], { timeoutMs: 3 * 60 * 1000 })
    if (!skipPack) runStep('Submission evidence pack', 'pnpm', ['submit:pack', '--skip-build', '--skip-checks', `--base-url=${baseUrl}`])
    if (stopAfter) runStep('Stop launch stack', 'pnpm', ['launch:stop'])

    writeSummary(true)
    log('\nREADY TO SUBMIT / RECORD / HAND OFF')
    log(`App: http://localhost:${port}/login`)
    log('Login: demo@sovereign.local / Demo1234!')
    log(`Evidence: ${path.relative(root, latestDir)}`)
    const pack = latestSubmitPack()
    if (pack) log(`Submit pack: ${path.relative(root, pack)}`)
    if (!withBrowser) log('Optional browser screenshots: pnpm launch:ready --with-browser')
    if (!withTypecheck) log('Optional deeper local check: pnpm launch:ready --with-typecheck')
    if (!withBuild) log('Optional local production build: pnpm launch:ready --with-build')
    if (!stopAfter) log('Stop later: pnpm launch:stop')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeSummary(false, message)
    log('\nBLOCKED: not ready yet.')
    log(message)
    log(`Check logs: ${path.relative(root, latestDir)}`)
    process.exitCode = 1
  }
}

main()
