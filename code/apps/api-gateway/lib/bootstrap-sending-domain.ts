import { query } from '@/lib/db'

export type BootstrapSendingDomainResult = {
  enabled: boolean
  clientId: number
  markAuthValid: boolean
  domainDailyLimit: number
  identityDailyLimit: number
  bootstrapped: Array<{ domain: string; email: string }>
  reason?: string
}

function truthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value || '').trim().toLowerCase())
}

function explicitlyDisabled(value: string | undefined): boolean {
  return ['0', 'false', 'no', 'n', 'off', 'disabled'].includes(
    String(value || '').trim().toLowerCase()
  )
}

function cleanEmail(value: unknown): string {
  const email = String(value || '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

function cleanDomain(value: unknown): string {
  const domain = String(value || '').trim().toLowerCase()
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) ? domain : ''
}

function domainFromEmail(email: string): string {
  return cleanDomain(email.split('@')[1] || '')
}

function parseSmtpAccounts(): string[] {
  const raw = String(process.env.SMTP_ACCOUNTS || '').trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => cleanEmail(item?.user)).filter(Boolean)
  } catch {
    return []
  }
}

function splitEmails(value: unknown): string[] {
  return String(value || '')
    .split(/[\s,;]+/)
    .map(cleanEmail)
    .filter(Boolean)
}

function resolveBootstrapEmails(): string[] {
  const candidates = [
    ...splitEmails(process.env.BOOTSTRAP_SENDING_EMAILS),
    ...splitEmails(process.env.RESEND_FROM_EMAIL),
    ...splitEmails(process.env.SMTP_FROM_EMAIL),
    ...splitEmails(process.env.SMTP_USER),
    ...parseSmtpAccounts(),
  ].filter(Boolean)

  return [...new Set(candidates)]
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(process.env[name] || ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function cappedIntEnv(name: string, fallback: number, capName: string, capFallback: number, max: number): number {
  const configured = intEnv(name, fallback, 1, max)
  const cap = intEnv(capName, capFallback, 1, max)
  return Math.min(configured, cap)
}

function bootstrapEnabled(emails: string[]): { enabled: boolean; reason?: string } {
  const raw = process.env.BOOTSTRAP_SENDING_DOMAIN
  if (explicitlyDisabled(raw)) return { enabled: false, reason: 'BOOTSTRAP_SENDING_DOMAIN disabled' }
  if (truthy(raw) || cleanDomain(raw)) return { enabled: true }
  if (truthy(process.env.BOOTSTRAP_AUTO_RECONCILE_SENDERS)) return { enabled: true }
  if (process.env.BOOTSTRAP_AUTO_RECONCILE_SENDERS === undefined && emails.length > 0) {
    return { enabled: true }
  }
  return { enabled: false, reason: 'no bootstrap sender configuration' }
}

export async function reconcileBootstrapSendingDomain(
  input: { clientId?: number } = {}
): Promise<BootstrapSendingDomainResult> {
  const emails = resolveBootstrapEmails()
  const clientId = input.clientId ?? intEnv('DEFAULT_CLIENT_ID', 1, 1, 1_000_000)
  const domainDailyLimit = cappedIntEnv(
    'BOOTSTRAP_DOMAIN_DAILY_LIMIT',
    75,
    'SENDER_DOMAIN_HARD_DAILY_LIMIT',
    75,
    1_000
  )
  const identityDailyLimit = cappedIntEnv(
    'BOOTSTRAP_IDENTITY_DAILY_LIMIT',
    75,
    'SENDER_IDENTITY_HARD_DAILY_LIMIT',
    75,
    500
  )
  const markAuthValid = truthy(process.env.BOOTSTRAP_MARK_DNS_VALID)
  const enabled = bootstrapEnabled(emails)

  const result: BootstrapSendingDomainResult = {
    enabled: enabled.enabled,
    clientId,
    markAuthValid,
    domainDailyLimit,
    identityDailyLimit,
    bootstrapped: [],
    reason: enabled.reason,
  }

  if (!enabled.enabled) return result
  if (!emails.length) {
    return {
      ...result,
      enabled: false,
      reason:
        'BOOTSTRAP_SENDING_EMAILS, RESEND_FROM_EMAIL, SMTP_ACCOUNTS, SMTP_FROM_EMAIL, or SMTP_USER must include a valid email',
    }
  }

  for (const email of emails) {
    const domain = domainFromEmail(email) || cleanDomain(process.env.BOOTSTRAP_DOMAIN)
    if (!domain) throw new Error(`Unable to resolve sending domain for ${email}`)

    const domainRes = await query<{ id: string | number }>(
      `INSERT INTO domains (
         client_id,
         domain,
         status,
         paused,
         warmup_stage,
         spf_valid,
         dkim_valid,
         dmarc_valid,
         daily_limit,
         daily_cap,
         health_score,
         reputation_score
       )
       VALUES ($1, $2, 'active', FALSE, 1, $3, $3, $3, $4, $4, 100, 100)
       ON CONFLICT (client_id, domain) DO UPDATE
       SET status = 'active',
           paused = FALSE,
           spf_valid = CASE WHEN $3 THEN TRUE ELSE domains.spf_valid END,
           dkim_valid = CASE WHEN $3 THEN TRUE ELSE domains.dkim_valid END,
           dmarc_valid = CASE WHEN $3 THEN TRUE ELSE domains.dmarc_valid END,
           daily_limit = EXCLUDED.daily_limit,
           daily_cap = EXCLUDED.daily_cap,
           updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [clientId, domain, markAuthValid, domainDailyLimit]
    )
    const domainId = domainRes.rows[0]?.id
    if (!domainId) throw new Error(`Failed to bootstrap domain ${domain}`)

    await query(
      `INSERT INTO identities (client_id, domain_id, email, daily_limit, status)
       VALUES ($1, $2, $3, $4, 'active')
       ON CONFLICT (client_id, email) DO UPDATE
       SET domain_id = EXCLUDED.domain_id,
           status = 'active',
           daily_limit = EXCLUDED.daily_limit,
           updated_at = CURRENT_TIMESTAMP`,
      [clientId, domainId, email, identityDailyLimit]
    )

    result.bootstrapped.push({ domain, email })
  }

  return result
}
