#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const args = new Set(process.argv.slice(2))
const envArg = process.argv.slice(2).find((arg) => arg.startsWith('--env='))
const envPath = envArg ? path.resolve(root, envArg.slice('--env='.length)) : path.join(root, '.env')
const realSend = args.has('--real-send')
const jsonOutput = args.has('--json')

function parseEnv(raw) {
  const out = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function isLocalHost(value = '') {
  return /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|$)/i.test(value) || /\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(value)
}

function weakSecret(value = '') {
  const v = value.trim()
  return (
    v.length < 32 ||
    ['change-me', 'change_me', 'sovereign-engine', 'local-test-key-32-bytes-minimum-value'].includes(v) ||
    /^mock/i.test(v)
  )
}

function pushIssue(issues, severity, check, message, fix) {
  issues.push({ severity, check, message, fix })
}

function checkRequired(env, issues, names, severity = 'blocker') {
  for (const name of names) {
    if (!env[name] || !env[name].trim()) {
      pushIssue(issues, severity, name, `Missing ${name}.`, `Set ${name} in .env or your container environment.`)
    }
  }
}

function summarize(results) {
  const blockers = results.filter((x) => x.severity === 'blocker')
  const warnings = results.filter((x) => x.severity === 'warning')
  return { ok: blockers.length === 0, blockers: blockers.length, warnings: warnings.length, issues: results }
}

const issues = []

{
  const env = { ...process.env }
  if (fs.existsSync(envPath)) {
    Object.assign(env, parseEnv(fs.readFileSync(envPath, 'utf8')))
  } else if (envArg) {
    pushIssue(issues, 'blocker', envPath, `Env file not found: ${envPath}.`, 'Pass an existing --env=path or create .env from configs/env/.env.production.example.')
  } else {
    pushIssue(issues, 'warning', '.env', 'No .env file found; checking process environment only.', 'Copy configs/env/.env.production.example to .env for server deployments.')
  }

  checkRequired(env, issues, [
    'DATABASE_URL',
    'REDIS_URL',
    'APP_DOMAIN',
    'AUTH_SECRET',
    'CRON_SECRET',
    'SECURITY_KILL_SWITCH_TOKEN',
  ])

  if (!String(env.ZEROBOUNCE_API_KEY || '').trim() && !String(env.HUNTER_API_KEY || '').trim()) {
    pushIssue(
      issues,
      'blocker',
      'validation_provider',
      'Missing validation provider key.',
      'Set ZEROBOUNCE_API_KEY or HUNTER_API_KEY before approving real outbound contacts.'
    )
  }

  if (realSend) {
    checkRequired(env, issues, ['SMTP_HOST'], 'blocker')
    const hasAccountList = Boolean(env.SMTP_ACCOUNTS && env.SMTP_ACCOUNTS.trim())
    if (!hasAccountList) {
      checkRequired(env, issues, ['SMTP_USER', 'SMTP_PASS'], 'blocker')
    }
    if (env.MOCK_SMTP !== 'false') {
      pushIssue(issues, 'blocker', 'MOCK_SMTP', 'Real-send mode requires MOCK_SMTP=false.', 'Set MOCK_SMTP=false only after DNS, suppression, and test recipients are ready.')
    }
  } else if (env.MOCK_SMTP !== 'true') {
    pushIssue(issues, 'warning', 'MOCK_SMTP', 'MOCK_SMTP is not true in dry-run mode.', 'Use pnpm prod:check:real when intentionally validating real sending.')
  }

  for (const secretName of ['AUTH_SECRET', 'CRON_SECRET', 'SECURITY_KILL_SWITCH_TOKEN']) {
    if (env[secretName] && weakSecret(env[secretName])) {
      pushIssue(issues, 'blocker', secretName, `${secretName} is weak or still a placeholder.`, `Generate with: openssl rand -base64 32`)
    }
  }

  if (env.SECRET_MASTER_KEY && env.SECRET_MASTER_KEY.length < 32) {
    pushIssue(issues, 'blocker', 'SECRET_MASTER_KEY', 'SECRET_MASTER_KEY is too short for production vaulting.', 'Generate with: openssl rand -base64 32')
  }
  if (!env.SECRET_MASTER_KEY && realSend) {
    pushIssue(issues, 'blocker', 'SECRET_MASTER_KEY', 'Real-send production should encrypt retrievable secrets.', 'Set SECRET_MASTER_KEY_ID and SECRET_MASTER_KEY.')
  }

  if (realSend && isLocalHost(env.APP_DOMAIN || env.APP_BASE_URL)) {
    pushIssue(issues, 'blocker', 'APP_DOMAIN', 'APP_DOMAIN is still local.', 'Set APP_DOMAIN to the public HTTPS dashboard domain.')
  }

  if (realSend && env.APP_PROTOCOL && env.APP_PROTOCOL !== 'https') {
    pushIssue(issues, 'blocker', 'APP_PROTOCOL', 'Real production should use HTTPS.', 'Set APP_PROTOCOL=https behind TLS.')
  }

  if (realSend && /password@|:password@|postgres:password/i.test(env.DATABASE_URL || '')) {
    pushIssue(issues, 'blocker', 'DATABASE_URL', 'DATABASE_URL appears to use the default password.', 'Use a strong database password or managed Postgres secret.')
  }

  if (realSend && /mock|example|your_/i.test(`${env.SMTP_HOST || ''} ${env.SMTP_USER || ''} ${env.ZEROBOUNCE_API_KEY || ''} ${env.HUNTER_API_KEY || ''}`)) {
    pushIssue(issues, 'blocker', 'provider_keys', 'SMTP or validation provider values still look like placeholders.', 'Fill live ESP/SMTP and ZeroBounce or Hunter credentials.')
  }

  if (env.REQUIRE_INTERNAL_TLS === 'true') {
    if (!/sslmode=(require|verify-ca|verify-full)/i.test(env.DATABASE_URL || '')) {
      pushIssue(issues, 'warning', 'DATABASE_URL TLS', 'REQUIRE_INTERNAL_TLS=true but DATABASE_URL does not advertise sslmode=require/verify.', 'Use managed Postgres TLS params.')
    }
    if (!/^rediss:\/\//i.test(env.REDIS_URL || '')) {
      pushIssue(issues, 'warning', 'REDIS_URL TLS', 'REQUIRE_INTERNAL_TLS=true but REDIS_URL is not rediss://.', 'Use TLS Redis or private network isolation.')
    }
  }

  if (realSend && env.SEND_ALLOW_UNKNOWN_VALIDATION !== 'false') {
    pushIssue(issues, 'warning', 'SEND_ALLOW_UNKNOWN_VALIDATION', 'Unknown validation is allowed.', 'Set SEND_ALLOW_UNKNOWN_VALIDATION=false for stricter production sending.')
  }

  const globalPerMinute = Number(env.GLOBAL_SENDS_PER_MINUTE || 120)
  if (realSend && globalPerMinute > 1000) {
    pushIssue(issues, 'warning', 'GLOBAL_SENDS_PER_MINUTE', 'Global send cap is very high.', 'Keep initial go-live conservative and let safe-ramp increase capacity.')
  }

  const productionFiles = [
    'docker-compose.prod.yml',
    'Dockerfile',
    '../docs/OPERATING_GUIDE.md',
    '../README.md',
    '../docs/PRODUCTION_SUBMISSION_CHECKLIST.md',
  ]
  for (const file of productionFiles) {
    if (!fs.existsSync(path.join(root, file))) {
      pushIssue(issues, 'blocker', file, `Missing ${file}.`, 'Restore the production handoff artifact.')
    }
  }
}

const summary = summarize(issues)

if (jsonOutput) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  console.log(`Sovereign Engine final production check: ${summary.ok ? 'PASS' : 'BLOCKED'}`)
  console.log(`Mode: ${realSend ? 'real-send' : 'dry-run/mock-safe'}`)
  console.log(`Blockers: ${summary.blockers}`)
  console.log(`Warnings: ${summary.warnings}`)
  for (const issue of issues) {
    const label = issue.severity === 'blocker' ? 'BLOCKER' : 'WARN'
    console.log(`\n[${label}] ${issue.check}`)
    console.log(`  ${issue.message}`)
    console.log(`  Fix: ${issue.fix}`)
  }
}

process.exitCode = summary.ok ? 0 : 1
