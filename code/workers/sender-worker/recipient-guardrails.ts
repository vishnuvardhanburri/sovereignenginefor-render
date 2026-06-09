export type RecipientGuardrailContact = {
  email: string
  status?: string | null
  verification_status?: string | null
  bounced_at?: string | null
  unsubscribed_at?: string | null
  custom_fields?: Record<string, unknown> | null
}

const VALIDATION_REQUIRED_PREFIXES = new Set([
  'business',
  'contact',
  'hello',
  'hi',
  'info',
  'mail',
  'marketing',
  'team',
])

const RISKY_GUESSED_ROLE_PREFIXES = new Set([
  'founder',
  'founders',
  'partner',
  'partners',
  'partnership',
  'partnerships',
])

function cleanEmail(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase()
}

function isEmail(raw: unknown): boolean {
  return recipientSyntaxBlockers(raw).length === 0
}

export function recipientSyntaxBlockers(raw: unknown): string[] {
  const email = cleanEmail(raw)
  const blockers: string[] = []

  if (!email) return ['empty_email']
  if (email.length > 254) blockers.push('email_too_long')
  if (!/^[\x21-\x7E]+$/.test(email)) blockers.push('non_ascii_email')

  const parts = email.split('@')
  if (parts.length !== 2) blockers.push('invalid_at_count')

  const [local = '', domain = ''] = parts
  if (!local || !domain) blockers.push('missing_local_or_domain')
  if (local.length > 64) blockers.push('local_part_too_long')
  if (domain.length > 253) blockers.push('domain_too_long')
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    blockers.push('invalid_local_dots')
  }
  if (/(^|[._-])u003[ce]/i.test(local) || /(^|[._-])u0026/i.test(local)) {
    blockers.push('escaped_html_email_artifact')
  }
  if (/u00[0-9a-f]{2}/i.test(local) || />|<|&amp;/.test(local)) {
    blockers.push('escaped_html_email_artifact')
  }
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) {
    blockers.push('invalid_domain_dots')
  }
  if (
    !/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(email)
  ) {
    blockers.push('invalid_business_email_syntax')
  }

  if (domain.split('.').some((label) => label.length > 63)) {
    blockers.push('domain_label_too_long')
  }

  return Array.from(new Set(blockers))
}

export function hasExactPublicEmailEvidence(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
  return [
    'exact_public_email',
    'hunter_domain_search',
    'maps_public_business_domain_match',
    'public_domain_email',
    'public_page_email_match',
    'public_mailto_match',
    'provider_validated',
  ].includes(normalized)
}

function hasBusinessDomainRolePattern(value: unknown): boolean {
  return String(value ?? '').trim().toLowerCase() === 'business_domain_role_pattern'
}

function asString(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function asBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase())
}

function envBool(name: string, fallback: boolean): boolean {
  const value = process.env[name]
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) ? parsed : fallback
}

function allowUnknownProviderValidation(): boolean {
  return envBool(
    'DAILY_OUTBOUND_ALLOW_UNKNOWN_VALIDATION',
    envBool('SEND_ALLOW_UNKNOWN_VALIDATION', true)
  )
}

function allowOwnedProviderValidation(): boolean {
  return envBool('DAILY_OUTBOUND_ALLOW_OWNED_VALIDATION', true)
}

function ownedProviderValidationMinScore(): number {
  return Math.max(
    0.65,
    Math.min(
      envNumber(
        'DAILY_OUTBOUND_OWNED_VALIDATION_MIN_SCORE',
        envNumber('OWNED_VALIDATION_MIN_SCORE', 0.78)
      ),
      0.9
    )
  )
}

function hasAcceptedOwnedValidationFallback(customFields: Record<string, unknown>): boolean {
  if (!allowOwnedProviderValidation()) return false
  if (asString(customFields.email_validation_provider) !== 'owned') return false
  const verdict = asString(customFields.email_validation_verdict)
  if (!['unknown', 'risky'].includes(verdict)) return false
  if (!asBool(customFields.email_validation_mx)) return false
  if (!['commercial_role', 'safe_role'].includes(asString(customFields.email_validation_mailbox_role))) {
    return false
  }
  return numberField(customFields.email_validation_score) >= ownedProviderValidationMinScore()
}

function hasAcceptedProviderValidationFallback(customFields: Record<string, unknown>): boolean {
  if (hasAcceptedOwnedValidationFallback(customFields)) return true
  if (!allowUnknownProviderValidation()) return false
  const provider = asString(customFields.email_validation_provider)
  const verdict = asString(customFields.email_validation_verdict)
  const score = numberField(customFields.email_validation_score)
  if (!provider) return false
  if (verdict === 'risky') return score >= 0.65
  if (verdict === 'unknown') return score >= 0.75
  return false
}

function numberField(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function hasAcceptedBusinessRoleFallback(
  customFields: Record<string, unknown>,
  prefix: string
): boolean {
  const safeBusinessPrefixes = new Set([
    'business',
    'contact',
    'growth',
    'hello',
    'hi',
    'info',
    'mail',
    'marketing',
    'sales',
    'team',
  ])

  if (!safeBusinessPrefixes.has(prefix)) return false
  if (!['1', 'true', 'yes', 'on'].includes(String(customFields.public_search ?? customFields.lead_scout ?? '').trim().toLowerCase())) {
    return false
  }
  if (!hasBusinessDomainRolePattern(customFields.email_evidence)) return false
  return numberField(customFields.fit_score) >= 70
}

export function recipientApprovalBlockers(
  contact: RecipientGuardrailContact | null | undefined,
  jobRecipientEmail?: string | null
): string[] {
  const blockers: string[] = []
  if (!contact) return ['contact_missing']

  const email = cleanEmail(contact.email)
  const jobEmail = cleanEmail(jobRecipientEmail)
  const [prefix = ''] = email.split('@')
  const verificationStatus = String(contact.verification_status ?? 'pending').trim().toLowerCase()
  const customFields = contact.custom_fields ?? {}
  const hasExactEvidence = hasExactPublicEmailEvidence(customFields.email_evidence)
  const acceptedBusinessRoleFallback = hasAcceptedBusinessRoleFallback(customFields, prefix)
  const acceptedProviderFallback = hasAcceptedProviderValidationFallback(customFields)
  const isValid = verificationStatus === 'valid'

  const syntaxBlockers = recipientSyntaxBlockers(email)
  if (syntaxBlockers.length > 0) blockers.push('invalid_email', ...syntaxBlockers)
  if (jobEmail && email !== jobEmail) blockers.push('recipient_contact_mismatch')
  if (contact.status && contact.status !== 'active') blockers.push('inactive_contact')
  if (contact.bounced_at) blockers.push('previously_bounced')
  if (contact.unsubscribed_at) blockers.push('unsubscribed')
  if (['invalid', 'do_not_mail'].includes(verificationStatus)) blockers.push(`verification_${verificationStatus}`)

  if (
    VALIDATION_REQUIRED_PREFIXES.has(prefix) &&
    !isValid &&
    !hasExactEvidence &&
    !acceptedBusinessRoleFallback &&
    !acceptedProviderFallback
  ) {
    blockers.push('generic_inbox_requires_email_validation_or_exact_evidence')
  }

  if (RISKY_GUESSED_ROLE_PREFIXES.has(prefix) && !isValid && !hasExactEvidence && !acceptedProviderFallback) {
    blockers.push('risky_role_requires_exact_public_email_evidence')
  }

  return Array.from(new Set(blockers))
}
