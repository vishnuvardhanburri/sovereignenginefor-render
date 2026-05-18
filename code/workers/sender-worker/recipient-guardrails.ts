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
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(raw))
}

export function hasExactPublicEmailEvidence(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
  return [
    'exact_public_email',
    'public_page_email_match',
    'public_mailto_match',
    'provider_validated',
  ].includes(normalized)
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
  const isValid = verificationStatus === 'valid'

  if (!isEmail(email)) blockers.push('invalid_email')
  if (jobEmail && email !== jobEmail) blockers.push('recipient_contact_mismatch')
  if (contact.status && contact.status !== 'active') blockers.push('inactive_contact')
  if (contact.bounced_at) blockers.push('previously_bounced')
  if (contact.unsubscribed_at) blockers.push('unsubscribed')
  if (['invalid', 'do_not_mail'].includes(verificationStatus)) blockers.push(`verification_${verificationStatus}`)

  if (VALIDATION_REQUIRED_PREFIXES.has(prefix) && !isValid && !hasExactEvidence) {
    blockers.push('generic_inbox_requires_email_validation_or_exact_evidence')
  }

  if (RISKY_GUESSED_ROLE_PREFIXES.has(prefix) && !isValid && !hasExactEvidence) {
    blockers.push('risky_role_requires_exact_public_email_evidence')
  }

  return Array.from(new Set(blockers))
}
