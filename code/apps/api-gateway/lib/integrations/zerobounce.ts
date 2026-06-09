import { appEnv } from '@/lib/env'
import { VerificationStatus } from '@/lib/db/types'
import { resolveMx } from 'node:dns/promises'
import {
  HunterVerificationResult,
  verifyEmailWithHunter,
} from '@/lib/integrations/hunter'
import { validateBusinessEmailSyntax } from '@/lib/email-address'

export interface VerificationResult {
  status: VerificationStatus
  subStatus: string | null
  provider: 'zerobounce' | 'hunter' | 'owned' | 'none'
  score: number
  error?: string
  raw: Record<string, unknown> | null
}

let zeroBounceCircuitOpenUntil = 0

function envFlagOverride(name: string): boolean | null {
  const normalized = String(process.env[name] ?? '').trim().toLowerCase()
  if (!normalized) return null
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return null
}

function rateLimitCooldownMs(): number {
  const parsed = Number(process.env.ZEROBOUNCE_RATE_LIMIT_COOLDOWN_MS)
  if (!Number.isFinite(parsed)) return 15 * 60 * 1000
  return Math.max(60_000, Math.min(Math.trunc(parsed), 60 * 60 * 1000))
}

function openZeroBounceCircuit() {
  zeroBounceCircuitOpenUntil = Math.max(
    zeroBounceCircuitOpenUntil,
    Date.now() + rateLimitCooldownMs()
  )
}

export function isHunterFallbackEnabled(): boolean {
  const explicit =
    envFlagOverride('HUNTER_FALLBACK_ENABLED') ??
    envFlagOverride('EMAIL_VALIDATION_HUNTER_FALLBACK')
  if (explicit !== null) return explicit

  // If Hunter is configured, use it as the automatic continuity provider when
  // ZeroBounce is unknown, timed out, or rate-limited. This prevents one
  // verifier quota event from freezing the approval inventory.
  return Boolean(appEnv.hunterApiKey())
}

function scoreOwnedResult(status: VerificationStatus): number {
  if (status === 'invalid' || status === 'do_not_mail') return 0.05
  if (status === 'unknown') return 0.55
  return 0
}

const OWNED_PERSONAL_EMAIL_DOMAINS = new Set([
  'aol.com',
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mail.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'yahoo.com',
  'yandex.com',
])

const OWNED_BLOCKED_PREFIXES = new Set([
  'abuse',
  'admin',
  'billing',
  'career',
  'careers',
  'compliance',
  'donotreply',
  'help',
  'hr',
  'jobs',
  'legal',
  'noreply',
  'postmaster',
  'privacy',
  'security',
  'support',
  'test',
  'webmaster',
])

const OWNED_COMMERCIAL_PREFIXES = new Set([
  'bd',
  'business',
  'growth',
  'marketing',
  'opportunities',
  'opportunity',
  'sales',
])

const OWNED_SAFE_PREFIXES = new Set([
  'contact',
  'hello',
  'hi',
  'inquiries',
  'inquiry',
  'info',
  'mail',
  'partner',
  'partners',
  'partnership',
  'partnerships',
  'team',
])

const OWNED_WEAK_GENERIC_PREFIXES = new Set(['contact', 'hello', 'hi', 'info', 'mail', 'team'])

type OwnedMailboxRole =
  | 'blocked_role'
  | 'commercial_role'
  | 'safe_role'
  | 'weak_generic'
  | 'person_like'
  | 'unknown_role'

function classifyOwnedMailboxRole(localPart: string): OwnedMailboxRole {
  const normalized = localPart.trim().toLowerCase().split('+')[0] ?? ''
  if (!normalized || OWNED_BLOCKED_PREFIXES.has(normalized)) return 'blocked_role'
  if (OWNED_COMMERCIAL_PREFIXES.has(normalized)) return 'commercial_role'
  if (OWNED_WEAK_GENERIC_PREFIXES.has(normalized)) return 'weak_generic'
  if (OWNED_SAFE_PREFIXES.has(normalized)) return 'safe_role'
  if (normalized.includes('.') || /^[a-z]+[._-][a-z]+$/.test(normalized)) return 'person_like'
  return 'unknown_role'
}

function inferMxProvider(mxHosts: string[]): string {
  const joined = mxHosts.map((host) => host.toLowerCase()).join(' ')
  if (/googlemail|google\.com|aspmx\.l\.google/.test(joined)) return 'google_workspace'
  if (/mail\.protection\.outlook|outlook\.com|office365|microsoft/.test(joined)) return 'microsoft_365'
  if (/zoho/.test(joined)) return 'zoho'
  if (/protonmail|proton\.ch|proton\.me/.test(joined)) return 'proton'
  if (/titan\.email|hostinger/.test(joined)) return 'hostinger_titan'
  if (/secureserver|godaddy/.test(joined)) return 'godaddy'
  if (/mimecast/.test(joined)) return 'mimecast'
  if (/pphosted|proofpoint/.test(joined)) return 'proofpoint'
  if (/amazonses|awsapps|workmail/.test(joined)) return 'aws_mail'
  if (/mailgun/.test(joined)) return 'mailgun'
  if (/sendgrid/.test(joined)) return 'sendgrid'
  if (/mailchannels/.test(joined)) return 'mailchannels'
  return 'unknown_mx'
}

function scoreOwnedMxConfidence(input: {
  domain: string
  localPart: string
  mailboxRole: OwnedMailboxRole
  mxProvider: string
}): number {
  if (OWNED_PERSONAL_EMAIL_DOMAINS.has(input.domain)) return 0.15
  if (input.mailboxRole === 'blocked_role') return 0.2

  let score = 0.55
  if (input.mxProvider !== 'unknown_mx') score += 0.04

  if (input.mailboxRole === 'commercial_role') score += 0.23
  else if (input.mailboxRole === 'safe_role') score += 0.2
  else if (input.mailboxRole === 'weak_generic') score += 0.12
  else if (input.mailboxRole === 'person_like') score += 0.05

  if (input.localPart.includes('+')) score -= 0.08

  return Math.max(0.05, Math.min(Number(score.toFixed(2)), 0.84))
}

async function withTimeout<T>(promise: Promise<T>, ms: number, code: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(code)), ms)
  })

  try {
    return await Promise.race([promise, timer])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function verifyEmailWithOwnedSignals(email: string): Promise<VerificationResult> {
  const syntax = validateBusinessEmailSyntax(email)
  const normalized = syntax.normalized
  if (!syntax.valid) {
    return {
      status: 'invalid',
      subStatus: syntax.reason ?? 'invalid_syntax',
      provider: 'owned',
      score: scoreOwnedResult('invalid'),
      error: syntax.reason ?? 'invalid_syntax',
      raw: { provider: 'owned', checks: ['syntax'], syntax: false, reason: syntax.reason },
    }
  }

  const [localPart = '', domain = ''] = normalized.split('@')
  if (!domain) {
    return {
      status: 'invalid',
      subStatus: 'missing_domain',
      provider: 'owned',
      score: scoreOwnedResult('invalid'),
      error: 'missing_domain',
      raw: { provider: 'owned', checks: ['syntax'], syntax: false },
    }
  }

  try {
    const records = await withTimeout(resolveMx(domain), 3_000, 'mx_lookup_timeout')
    const liveMxRecords = records.filter((record) => !['', '.'].includes(record.exchange.trim()))
    if (!liveMxRecords.length) {
      return {
        status: 'invalid',
        subStatus: 'mx_not_found',
        provider: 'owned',
        score: scoreOwnedResult('invalid'),
        error: 'mx_not_found',
        raw: { provider: 'owned', checks: ['syntax', 'mx'], syntax: true, mx: false, domain },
      }
    }

    const mxHosts = liveMxRecords
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 3)
      .map((record) => record.exchange)
    const mxProvider = inferMxProvider(mxHosts)
    const mailboxRole = classifyOwnedMailboxRole(localPart)
    const ownedConfidence = scoreOwnedMxConfidence({
      domain,
      localPart,
      mailboxRole,
      mxProvider,
    })

    return {
      status: 'unknown',
      subStatus: 'mx_present_unverified',
      provider: 'owned',
      score: ownedConfidence,
      raw: {
        provider: 'owned',
        checks: ['syntax', 'mx'],
        syntax: true,
        mx: true,
        domain,
        mx_hosts: mxHosts,
        mx_provider: mxProvider,
        mailbox_role: mailboxRole,
        owned_confidence: ownedConfidence,
      },
    }
  } catch (error) {
    const code = error instanceof Error && error.message === 'mx_lookup_timeout'
      ? 'mx_lookup_timeout'
      : 'mx_lookup_failed'

    return {
      status: 'unknown',
      subStatus: code,
      provider: 'owned',
      score: 0.35,
      error: code,
      raw: { provider: 'owned', checks: ['syntax', 'mx'], syntax: true, mx: null, domain, error: code },
    }
  }
}

function mapZeroBounceStatus(status: string): VerificationStatus {
  switch (status) {
    case 'valid':
      return 'valid'
    case 'invalid':
      return 'invalid'
    case 'catch-all':
      return 'catch_all'
    case 'spamtrap':
    case 'abuse':
    case 'do_not_mail':
      return 'do_not_mail'
    case 'unknown':
      return 'unknown'
    default:
      return 'pending'
  }
}

function mapHunterStatus(result: HunterVerificationResult): VerificationStatus {
  if (result.verdict === 'valid') return 'valid'
  if (result.verdict === 'invalid') return 'invalid'
  if (result.verdict === 'risky' && result.catchAll) return 'catch_all'
  return 'unknown'
}

function mapHunterResult(
  result: HunterVerificationResult,
  fallback?: {
    reason: string
    zeroBounceRaw: Record<string, unknown> | null
  }
): VerificationResult {
  const status = mapHunterStatus(result)
  const raw: Record<string, unknown> = {
    provider: result.provider,
    ...(result.raw ?? {}),
  }

  if (fallback) {
    raw.fallback_from = 'zerobounce'
    raw.fallback_reason = fallback.reason
    raw.zerobounce = fallback.zeroBounceRaw
  }

  if (!result.raw && result.error) {
    raw.error = result.error
  }

  return {
    status,
    subStatus: result.error ?? (result.catchAll ? 'catch_all' : null),
    provider: 'hunter',
    score: result.score,
    error: result.error,
    raw,
  }
}

async function verifyWithHunterFallback(
  email: string,
  fallback?: {
    reason: string
    zeroBounceRaw: Record<string, unknown> | null
  }
): Promise<VerificationResult | null> {
  if (!isHunterFallbackEnabled()) return null

  const hunterApiKey = appEnv.hunterApiKey()
  if (!hunterApiKey) return null

  const result = await verifyEmailWithHunter(email, { apiKey: hunterApiKey })
  return mapHunterResult(result, fallback)
}

function shouldUseHunterFallback(status: VerificationStatus): boolean {
  return status === 'unknown' || status === 'pending'
}

function mergeHunterFallback(
  original: VerificationResult,
  fallback: VerificationResult | null
): VerificationResult {
  if (!fallback) return original
  if (!shouldUseHunterFallback(fallback.status)) return fallback

  return {
    ...original,
    subStatus: original.subStatus ?? fallback.subStatus,
    error: original.error ?? fallback.error,
    raw: {
      ...(original.raw ?? {}),
      hunter_fallback: fallback.raw,
    },
  }
}

export async function verifyEmailAddress(email: string): Promise<VerificationResult> {
  const apiKey = appEnv.zeroBounceApiKey()
  if (!apiKey) {
    const hunterFallback = await verifyWithHunterFallback(email)
    if (hunterFallback) {
      return hunterFallback
    }

    return verifyEmailWithOwnedSignals(email)
  }

  if (zeroBounceCircuitOpenUntil > Date.now()) {
    const ownedFallback = await verifyEmailWithOwnedSignals(email)
    const original: VerificationResult = {
      status: 'unknown',
      subStatus: 'zerobounce_circuit_open',
      provider: 'zerobounce',
      score: 0.5,
      error: 'zerobounce_circuit_open',
      raw: {
        provider: 'zerobounce',
        error: 'zerobounce_circuit_open',
        retry_after_ms: Math.max(0, zeroBounceCircuitOpenUntil - Date.now()),
        owned_fallback: ownedFallback.raw,
      },
    }
    const fallback = await verifyWithHunterFallback(email, {
      reason: 'zerobounce_circuit_open',
      zeroBounceRaw: original.raw,
    })
    return ownedFallback.status === 'invalid' ? ownedFallback : mergeHunterFallback(original, fallback)
  }

  const url = new URL('https://api.zerobounce.net/v2/validate')
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('email', email)

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8_000),
    })

    if (!response.ok) {
      if (response.status === 429) {
        openZeroBounceCircuit()
      }
      const ownedFallback = await verifyEmailWithOwnedSignals(email)
      const original: VerificationResult = {
        status: 'unknown',
        subStatus: `zerobounce_http_${response.status}`,
        provider: 'zerobounce',
        score: 0.5,
        error: `zerobounce_http_${response.status}`,
        raw: { provider: 'zerobounce', status: response.status, owned_fallback: ownedFallback.raw },
      }
      const fallback = await verifyWithHunterFallback(email, {
        reason: original.error ?? 'zerobounce_http_error',
        zeroBounceRaw: original.raw,
      })
      return ownedFallback.status === 'invalid' ? ownedFallback : mergeHunterFallback(original, fallback)
    }

    const payload = (await response.json()) as {
      status?: string
      sub_status?: string
      [key: string]: unknown
    }
    const status = mapZeroBounceStatus(String(payload.status ?? 'pending'))
    const subStatus = payload.sub_status ? String(payload.sub_status) : null

    const original: VerificationResult = {
      status,
      subStatus,
      provider: 'zerobounce',
      score: scoreZeroBounceResult(status, subStatus),
      raw: { provider: 'zerobounce', ...payload },
    }

    if (shouldUseHunterFallback(status)) {
      const fallback = await verifyWithHunterFallback(email, {
        reason: `zerobounce_${status}`,
        zeroBounceRaw: original.raw,
      })
      return mergeHunterFallback(original, fallback)
    }

    return original
  } catch (error) {
    const code = error instanceof Error && error.name === 'AbortError'
      ? 'zerobounce_timeout'
      : 'zerobounce_request_failed'

    const ownedFallback = await verifyEmailWithOwnedSignals(email)
    const original: VerificationResult = {
      status: 'unknown',
      subStatus: code,
      provider: 'zerobounce',
      score: 0.5,
      error: code,
      raw: { provider: 'zerobounce', error: code, owned_fallback: ownedFallback.raw },
    }
    const fallback = await verifyWithHunterFallback(email, {
      reason: code,
      zeroBounceRaw: original.raw,
    })
    return ownedFallback.status === 'invalid' ? ownedFallback : mergeHunterFallback(original, fallback)
  }
}

function scoreZeroBounceResult(
  status: VerificationStatus,
  subStatus: string | null
): number {
  if (status === 'valid') return subStatus === 'role_based' ? 0.85 : 0.95
  if (status === 'invalid' || status === 'do_not_mail') return 0.05
  if (status === 'catch_all') return 0.65
  if (status === 'unknown') return 0.5
  return 0
}
