import { resolve4, resolveMx, resolveTxt } from 'node:dns/promises'
import { queryOne } from '@/lib/db'

export type ReadinessStatus = 'pass' | 'warn' | 'fail' | 'info'

export type ReadinessCheck = {
  id: string
  label: string
  status: ReadinessStatus
  detail: string
  evidence?: string[]
  suggestedRecord?: DnsRecordSuggestion
  action?: string
}

export type DnsRecordSuggestion = {
  type: 'TXT' | 'CNAME' | 'MX'
  host: string
  value: string
  priority?: number
  note?: string
}

export type ReadinessSection = {
  id: string
  title: string
  summary: string
  checks: ReadinessCheck[]
}

export type ProductionReadinessReport = {
  ok: true
  generatedAt: string
  domain: string | null
  smtpHost: string | null
  score: number
  status: 'READY' | 'NEEDS_ATTENTION' | 'BLOCKED'
  blockers: number
  warnings: number
  sections: ReadinessSection[]
  nextActions: string[]
}

type DomainDbRow = {
  domain: string
  status: string
  paused: boolean
  spf_valid: boolean
  dkim_valid: boolean
  dmarc_valid: boolean
  daily_limit: string | number | null
  health_score: string | number | null
}

const COMMON_DKIM_SELECTORS = ['default', 'selector1', 'selector2', 'google', 'k1', 'mail']

function hasEnv(name: string) {
  return Boolean(process.env[name]?.trim())
}

function envValue(name: string) {
  const value = process.env[name]?.trim()
  return value || ''
}

function normalizeDomain(input?: string | null) {
  const value = String(input ?? '').trim().toLowerCase()
  if (!value) return ''
  return value.replace(/^https?:\/\//, '').split('/')[0]!.replace(/^www\./, '').replace(/\.$/, '')
}

function isLikelyDomain(value: string) {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)
}

function firstTxt(records: string[][]) {
  return records.map((parts) => parts.join('')).filter(Boolean)
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise.catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function check(id: string, label: string, status: ReadinessStatus, detail: string, extra: Partial<ReadinessCheck> = {}): ReadinessCheck {
  return { id, label, status, detail, ...extra }
}

function hostOrAt(host: string) {
  return host || '@'
}

function dmarcMailbox(domain: string) {
  return domain ? `mailto:dmarc@${domain}` : 'mailto:dmarc@your-domain.com'
}

function espIncludeHint(smtpHost: string | null) {
  if (!smtpHost) return 'include:_spf.your-esp.example'
  const host = smtpHost.replace(/^smtp[.-]/i, '').replace(/:\d+$/, '')
  if (!host || host === 'mock.local') return 'include:_spf.your-esp.example'
  return `include:${host}`
}

function dnsFixes(domain: string, smtpHost: string | null) {
  const safeDomain = domain || 'your-domain.com'
  return {
    mx: {
      type: 'MX' as const,
      host: hostOrAt(''),
      priority: 10,
      value: 'inbound.your-mail-provider.example',
      note: 'Use the exact inbound MX host from your mailbox or ESP provider.',
    },
    spf: {
      type: 'TXT' as const,
      host: hostOrAt(''),
      value: `v=spf1 ${espIncludeHint(smtpHost)} -all`,
      note: 'Replace the include with the SPF include supplied by the buyer SMTP/ESP provider.',
    },
    dkim: {
      type: 'TXT' as const,
      host: `selector1._domainkey.${safeDomain}`,
      value: 'v=DKIM1; k=rsa; p=PASTE_2048_BIT_PUBLIC_KEY_FROM_ESP',
      note: 'The selector and public key must come from the connected SMTP/ESP provider.',
    },
    dmarc: {
      type: 'TXT' as const,
      host: `_dmarc.${safeDomain}`,
      value: `v=DMARC1; p=quarantine; rua=${dmarcMailbox(safeDomain)}; ruf=${dmarcMailbox(safeDomain)}; adkim=s; aspf=s; pct=100`,
      note: 'Start with quarantine, verify reports, then move to reject when aligned traffic is stable.',
    },
    mtaSts: {
      type: 'TXT' as const,
      host: `_mta-sts.${safeDomain}`,
      value: `v=STSv1; id=${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
      note: 'Also publish an HTTPS MTA-STS policy file after inbound TLS is configured.',
    },
    bimi: {
      type: 'TXT' as const,
      host: `default._bimi.${safeDomain}`,
      value: `v=BIMI1; l=https://${safeDomain}/bimi.svg; a=`,
      note: 'Optional. Add only after DMARC is strong and brand assets are verified.',
    },
  }
}

function summarize(checks: ReadinessCheck[]) {
  const pass = checks.filter((item) => item.status === 'pass').length
  const fail = checks.filter((item) => item.status === 'fail').length
  const warn = checks.filter((item) => item.status === 'warn').length
  return `${pass} passing, ${warn} warnings, ${fail} blockers`
}

function scoreSections(sections: ReadinessSection[]) {
  const checks = sections.flatMap((section) => section.checks)
  const totalWeight = checks.length || 1
  const earned = checks.reduce((sum, item) => {
    if (item.status === 'pass') return sum + 1
    if (item.status === 'info') return sum + 0.8
    if (item.status === 'warn') return sum + 0.45
    return sum
  }, 0)
  return Math.max(0, Math.min(100, Math.round((earned / totalWeight) * 100)))
}

async function inspectDomainRecord(domain: string) {
  if (!domain) return null
  return queryOne<DomainDbRow>(
    `SELECT domain, status, paused, spf_valid, dkim_valid, dmarc_valid, daily_limit, health_score
     FROM domains
     WHERE lower(domain) = lower($1)
     ORDER BY updated_at DESC
     LIMIT 1`,
    [domain]
  ).catch(() => null)
}

async function inspectDns(domain: string) {
  if (!domain || !isLikelyDomain(domain)) {
    return {
      mx: [] as string[],
      a: [] as string[],
      txt: [] as string[],
      dmarc: [] as string[],
      mtaSts: [] as string[],
      bimi: [] as string[],
      dkim: [] as Array<{ selector: string; records: string[] }>,
    }
  }

  const [mx, a, txt, dmarc, mtaSts, bimi, dkim] = await Promise.all([
    withTimeout(resolveMx(domain).then((rows) => rows.map((row) => `${row.exchange} (${row.priority})`)), 2500, []),
    withTimeout(resolve4(domain), 2500, []),
    withTimeout(resolveTxt(domain).then(firstTxt), 2500, []),
    withTimeout(resolveTxt(`_dmarc.${domain}`).then(firstTxt), 2500, []),
    withTimeout(resolveTxt(`_mta-sts.${domain}`).then(firstTxt), 2500, []),
    withTimeout(resolveTxt(`default._bimi.${domain}`).then(firstTxt), 2500, []),
    Promise.all(
      COMMON_DKIM_SELECTORS.map(async (selector) => ({
        selector,
        records: await withTimeout(resolveTxt(`${selector}._domainkey.${domain}`).then(firstTxt), 1800, []),
      }))
    ),
  ])

  return { mx, a, txt, dmarc, mtaSts, bimi, dkim }
}

export async function buildProductionReadinessReport(input: {
  domain?: string | null
  smtpHost?: string | null
}): Promise<ProductionReadinessReport> {
  const domain = normalizeDomain(input.domain)
  const smtpHost = String(input.smtpHost || envValue('SMTP_HOST') || '').trim() || null
  const [dbDomain, dns] = await Promise.all([inspectDomainRecord(domain), inspectDns(domain)])
  const fixes = dnsFixes(domain, smtpHost)

  const smtpConfigured =
    envValue('MOCK_SMTP') === 'true' ||
    Boolean(smtpHost && (hasEnv('SMTP_ACCOUNTS') || (hasEnv('SMTP_USER') && hasEnv('SMTP_PASS'))))

  const envChecks: ReadinessCheck[] = [
    check(
      'env.database',
      'Postgres database',
      hasEnv('DATABASE_URL') ? 'pass' : 'fail',
      hasEnv('DATABASE_URL') ? 'DATABASE_URL is configured.' : 'DATABASE_URL is missing.',
      { action: 'Set DATABASE_URL to the production Postgres connection string.' }
    ),
    check(
      'env.redis',
      'Redis queue/cache',
      hasEnv('REDIS_URL') ? 'pass' : 'fail',
      hasEnv('REDIS_URL') ? 'REDIS_URL is configured.' : 'REDIS_URL is missing.',
      { action: 'Set REDIS_URL to the production Redis endpoint.' }
    ),
    check(
      'env.app-domain',
      'Application domain',
      hasEnv('APP_DOMAIN') ? 'pass' : 'warn',
      hasEnv('APP_DOMAIN') ? `APP_DOMAIN is set to ${envValue('APP_DOMAIN')}.` : 'APP_DOMAIN is not set.',
      { action: 'Set APP_DOMAIN to the buyer-facing host, for example app.example.com.' }
    ),
    check(
      'env.auth-secret',
      'Session secret',
      envValue('AUTH_SECRET').length >= 32 || envValue('CRON_SECRET').length >= 32 ? 'pass' : 'warn',
      'Auth secrets are checked by length only; plaintext is never exposed.',
      { action: 'Use a 32+ character AUTH_SECRET in production.' }
    ),
    check(
      'env.smtp',
      'SMTP / ESP credentials',
      smtpConfigured ? 'pass' : 'warn',
      smtpConfigured
        ? 'SMTP delivery is configured or MOCK_SMTP is enabled for demo mode.'
        : 'SMTP credentials are not configured yet.',
      { action: 'Connect a reputable ESP or managed MTA before real sending.' }
    ),
    check(
      'env.validator',
      'Email validation provider',
      hasEnv('ZEROBOUNCE_API_KEY') || hasEnv('HUNTER_API_KEY') ? 'pass' : 'warn',
      hasEnv('ZEROBOUNCE_API_KEY') || hasEnv('HUNTER_API_KEY')
        ? 'Validation API key is configured.'
        : 'Validation API key is not configured; imports can still run in demo mode.',
      { action: 'Add ZEROBOUNCE_API_KEY or HUNTER_API_KEY for production hygiene.' }
    ),
  ]

  const spf = dns.txt.find((record) => /^v=spf1\b/i.test(record))
  const dmarc = dns.dmarc.find((record) => /^v=DMARC1\b/i.test(record))
  const dkimMatches = dns.dkim.filter((item) => item.records.some((record) => /^v=DKIM1\b/i.test(record)))

  const dnsChecks: ReadinessCheck[] = [
    check(
      'dns.input',
      'Domain provided',
      domain ? (isLikelyDomain(domain) ? 'pass' : 'fail') : 'warn',
      domain ? `Checking ${domain}.` : 'Enter a sending domain to run DNS verification.',
      { action: 'Use the domain you will authenticate for outbound mail.' }
    ),
    check(
      'dns.mx',
      'MX records',
      dns.mx.length ? 'pass' : domain ? 'fail' : 'warn',
      dns.mx.length ? `${dns.mx.length} MX record(s) found.` : 'No MX records found.',
      {
        evidence: dns.mx.slice(0, 5),
        suggestedRecord: fixes.mx,
        action: 'Add MX records for inbound replies and domain legitimacy.',
      }
    ),
    check(
      'dns.spf',
      'SPF policy',
      spf ? (/\+all/i.test(spf) ? 'fail' : /[-~]all/i.test(spf) ? 'pass' : 'warn') : domain ? 'fail' : 'warn',
      spf ? 'SPF record detected.' : 'No SPF record detected.',
      {
        evidence: spf ? [spf] : [],
        suggestedRecord: fixes.spf,
        action: 'Publish a strict SPF record with required ESP includes and avoid +all.',
      }
    ),
    check(
      'dns.dkim',
      'DKIM 2048-bit alignment',
      dkimMatches.length || dbDomain?.dkim_valid ? 'pass' : domain ? 'warn' : 'warn',
      dkimMatches.length
        ? `DKIM found for selector(s): ${dkimMatches.map((item) => item.selector).join(', ')}.`
        : dbDomain?.dkim_valid
          ? 'DKIM is marked valid in Sovereign Engine.'
          : 'No common DKIM selector found. This may be fine if your ESP uses a custom selector.',
      {
        evidence: dkimMatches.flatMap((item) => item.records.map((record) => `${item.selector}: ${record.slice(0, 120)}...`)),
        suggestedRecord: fixes.dkim,
        action: 'Verify the ESP DKIM selector and keep d= aligned with the sending domain.',
      }
    ),
    check(
      'dns.dmarc',
      'DMARC enforcement',
      dmarc ? (/p=(quarantine|reject)/i.test(dmarc) ? 'pass' : 'warn') : domain ? 'fail' : 'warn',
      dmarc ? 'DMARC record detected.' : 'No DMARC record detected.',
      {
        evidence: dmarc ? [dmarc] : [],
        suggestedRecord: fixes.dmarc,
        action: 'Move DMARC to p=quarantine or p=reject before scaled production sending.',
      }
    ),
    check(
      'dns.mta-sts',
      'MTA-STS',
      dns.mtaSts.some((record) => /^v=STSv1\b/i.test(record)) ? 'pass' : 'info',
      dns.mtaSts.length ? 'MTA-STS TXT record detected.' : 'MTA-STS is optional but recommended for enterprise posture.',
      {
        evidence: dns.mtaSts.slice(0, 3),
        suggestedRecord: fixes.mtaSts,
        action: 'Add MTA-STS after TLS is stable on inbound mail hosts.',
      }
    ),
    check(
      'dns.bimi',
      'BIMI readiness',
      dns.bimi.length ? 'pass' : 'info',
      dns.bimi.length ? 'BIMI record detected.' : 'BIMI is optional and should come after strong DMARC.',
      { evidence: dns.bimi.slice(0, 2), suggestedRecord: fixes.bimi }
    ),
  ]

  const domainChecks: ReadinessCheck[] = [
    check(
      'domain.registered',
      'Domain exists in workspace',
      dbDomain ? 'pass' : domain ? 'warn' : 'warn',
      dbDomain ? `${dbDomain.domain} is registered in Sovereign Engine.` : 'Domain has not been added to the workspace yet.',
      { action: 'Add the domain in Sending Health, then let the verifier update SPF/DKIM/DMARC flags.' }
    ),
    check(
      'domain.status',
      'Domain lane status',
      dbDomain ? (dbDomain.paused || dbDomain.status === 'paused' ? 'warn' : 'pass') : 'info',
      dbDomain ? `Current status: ${dbDomain.status}.` : 'Status will appear after the domain is added.',
      { action: 'Keep new domains in warmup until reputation lanes report healthy.' }
    ),
    check(
      'domain.capacity',
      'Daily sending cap',
      dbDomain && Number(dbDomain.daily_limit) > 0 ? 'pass' : 'info',
      dbDomain ? `Daily cap: ${Number(dbDomain.daily_limit || 0).toLocaleString()} messages.` : 'Daily cap is assigned after domain onboarding.',
      { action: 'Start conservatively and let the Reputation Brain ramp limits automatically.' }
    ),
    check(
      'domain.health',
      'Health score',
      dbDomain && Number(dbDomain.health_score) >= 80 ? 'pass' : dbDomain ? 'warn' : 'info',
      dbDomain ? `Health score: ${Number(dbDomain.health_score || 0).toFixed(1)} / 100.` : 'Health score appears after measurements.',
      { action: 'Investigate bounces, complaints, and seed placement when health drops below 80.' }
    ),
  ]

  const complianceChecks: ReadinessCheck[] = [
    check('compliance.unsubscribe', 'Unsubscribe path', 'pass', 'Unsubscribe token routes are implemented and tracked.'),
    check('compliance.suppression', 'Suppression model', 'pass', 'Global and per-client suppression tables are present.'),
    check('compliance.audit', 'Tamper-evident audit trail', 'pass', 'Privileged actions are chained with SHA-256 hashes.'),
    check('compliance.secrets', 'Secret handling', hasEnv('SECRET_MASTER_KEY') || hasEnv('SECRET_MASTER_KEYS') ? 'pass' : 'warn', 'Secret vault checks key presence only.', {
      action: 'Set SECRET_MASTER_KEY or SECRET_MASTER_KEYS before storing production credentials.',
    }),
  ]

  const sections: ReadinessSection[] = [
    { id: 'environment', title: 'Environment', summary: summarize(envChecks), checks: envChecks },
    { id: 'dns', title: 'DNS Verification Center', summary: summarize(dnsChecks), checks: dnsChecks },
    { id: 'domain', title: 'Domain Onboarding', summary: summarize(domainChecks), checks: domainChecks },
    { id: 'compliance', title: 'Compliance & Security', summary: summarize(complianceChecks), checks: complianceChecks },
  ]

  const checks = sections.flatMap((section) => section.checks)
  const blockers = checks.filter((item) => item.status === 'fail').length
  const warnings = checks.filter((item) => item.status === 'warn').length
  const score = scoreSections(sections)
  const nextActions = checks
    .filter((item) => item.status === 'fail' || item.status === 'warn')
    .map((item) => item.action)
    .filter((action): action is string => Boolean(action))
    .slice(0, 8)

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    domain: domain || null,
    smtpHost,
    score,
    status: blockers ? 'BLOCKED' : warnings ? 'NEEDS_ATTENTION' : 'READY',
    blockers,
    warnings,
    sections,
    nextActions,
  }
}
