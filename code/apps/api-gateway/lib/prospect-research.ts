export type ProspectResearchContact = {
  id: string | number
  email: string
  email_domain?: string | null
  company?: string | null
  company_domain?: string | null
  title?: string | null
  source?: string | null
  custom_fields?: Record<string, unknown> | null
  verification_status?: string | null
  status?: string | null
  unsubscribed_at?: string | null
  bounced_at?: string | null
}

export type ProspectResearchDecision = {
  id: number
  email: string
  company: string | null
  score: number
  approved: boolean
  reasons: string[]
  blockers: string[]
  evidenceUrl: string | null
  source: string | null
}

const PERSONAL_EMAIL_DOMAINS = new Set([
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

const BLOCKED_MAILBOX_PREFIXES = new Set([
  'abuse',
  'admin',
  'billing',
  'career',
  'careers',
  'compliance',
  'donotreply',
  'finance',
  'hr',
  'invoice',
  'invoices',
  'jobs',
  'legal',
  'no-reply',
  'noreply',
  'postmaster',
  'privacy',
  'security',
  'support',
  'webmaster',
])

const SAFE_BUSINESS_PREFIXES = new Set([
  'bd',
  'business',
  'contact',
  'growth',
  'hello',
  'hi',
  'info',
  'inquiries',
  'inquiry',
  'mail',
  'marketing',
  'opportunities',
  'opportunity',
  'partner',
  'partners',
  'partnership',
  'partnerships',
  'sales',
  'team',
])

const SAFE_SOURCE_TYPES = new Set([
  'google_sheet_import',
  'open_lead_graph',
  'owned_open_lead_graph',
  'operator_google_sheet',
])

const SOCIAL_EVIDENCE_HOSTS = new Set([
  'linkedin.com',
  'www.linkedin.com',
  'crunchbase.com',
  'www.crunchbase.com',
])

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase())
}

function normalizeDomain(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0]
}

function rootDomain(value: string): string {
  const parts = normalizeDomain(value).split('.').filter(Boolean)
  if (parts.length <= 2) return parts.join('.')
  return parts.slice(-2).join('.')
}

function isSameOrSubdomain(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizeDomain(candidate)
  const normalizedRoot = normalizeDomain(root)
  return normalizedCandidate === normalizedRoot || normalizedCandidate.endsWith(`.${normalizedRoot}`)
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function getEvidenceHost(value: string | null): string | null {
  if (!value) return null
  try {
    return normalizeDomain(new URL(value).hostname)
  } catch {
    return null
  }
}

function hasSpecificEvidencePath(value: string | null): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    return /contact|about|team|people|leadership|partner|partnership|sales|agency|services|company/i.test(
      `${url.pathname}${url.search}`
    )
  } catch {
    return false
  }
}

function scoreNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function scoreProspectForResearchApproval(
  contact: ProspectResearchContact,
  options?: { threshold?: number }
): ProspectResearchDecision {
  const threshold = Math.max(50, Math.min(Number(options?.threshold ?? 72), 95))
  const customFields = contact.custom_fields ?? {}
  const email = contact.email.trim().toLowerCase()
  const [prefix = '', emailDomainFromAddress = ''] = email.split('@')
  const emailDomain = normalizeDomain(contact.email_domain || emailDomainFromAddress)
  const companyDomain = normalizeDomain(contact.company_domain || asString(customFields.company_domain))
  const evidenceUrl = asString(customFields.public_evidence_url) || asString(customFields.source_url) || null
  const evidenceHost = getEvidenceHost(evidenceUrl)
  const source = contact.source || asString(customFields.data_source) || null
  const reasons: string[] = []
  const blockers: string[] = []
  let score = 0

  if (!Number.isSafeInteger(Number(contact.id))) {
    blockers.push('invalid_contact_id')
  }

  if (!isEmail(email)) {
    blockers.push('invalid_email')
  }

  if (contact.status && contact.status !== 'active') {
    blockers.push('inactive_contact')
  }

  if (contact.bounced_at) blockers.push('previously_bounced')
  if (contact.unsubscribed_at) blockers.push('unsubscribed')

  if (PERSONAL_EMAIL_DOMAINS.has(emailDomain)) {
    blockers.push('personal_email_domain')
  }

  if (BLOCKED_MAILBOX_PREFIXES.has(prefix)) {
    blockers.push('blocked_mailbox_prefix')
  }

  if (prefix.includes('+')) {
    blockers.push('tagged_or_test_address')
  }

  const verificationStatus = String(contact.verification_status ?? 'pending')
  if (['invalid', 'do_not_mail'].includes(verificationStatus)) {
    blockers.push(`verification_${verificationStatus}`)
  }

  if (source && !SAFE_SOURCE_TYPES.has(source) && !asBool(customFields.lead_scout) && !asBool(customFields.sheet_import)) {
    blockers.push('unsupported_source')
  } else {
    score += 8
    reasons.push('trusted_source')
  }

  if (SAFE_BUSINESS_PREFIXES.has(prefix)) {
    score += 28
    reasons.push('safe_business_inbox')
  } else if (prefix.includes('.') || /^[a-z]+[._-][a-z]+$/.test(prefix)) {
    blockers.push('person_like_email_requires_manual_review')
  } else {
    score += 8
    reasons.push('neutral_business_inbox')
  }

  if (emailDomain && companyDomain && rootDomain(emailDomain) === rootDomain(companyDomain)) {
    score += 20
    reasons.push('email_domain_matches_company')
  } else if (companyDomain) {
    blockers.push('email_company_domain_mismatch')
  }

  if (evidenceUrl) {
    score += 16
    reasons.push('public_evidence_url_present')
  } else {
    blockers.push('missing_public_evidence_url')
  }

  if (evidenceHost) {
    const evidenceMatchesCompany =
      (companyDomain && isSameOrSubdomain(evidenceHost, companyDomain)) ||
      (emailDomain && isSameOrSubdomain(evidenceHost, emailDomain)) ||
      SOCIAL_EVIDENCE_HOSTS.has(evidenceHost)

    if (evidenceMatchesCompany) {
      score += 12
      reasons.push('evidence_domain_aligned')
    } else {
      blockers.push('evidence_domain_mismatch')
    }
  }

  if (hasSpecificEvidencePath(evidenceUrl)) {
    score += 8
    reasons.push('specific_contact_evidence')
  }

  if (asBool(customFields.auto_approval_eligible)) {
    score += 8
    reasons.push('source_marked_approval_eligible')
  }

  const fitScore = scoreNumber(customFields.fit_score)
  if (fitScore >= 90) {
    score += 8
    reasons.push('high_fit_score')
  } else if (fitScore >= 70) {
    score += 5
    reasons.push('medium_fit_score')
  }

  if (asString(customFields.reason_to_contact).length >= 24) {
    score += 5
    reasons.push('reason_to_contact_present')
  }

  if (verificationStatus === 'valid') {
    score += 8
    reasons.push('email_verified_valid')
  } else if (verificationStatus === 'catch_all' || verificationStatus === 'unknown') {
    score += 2
    reasons.push(`verification_${verificationStatus}`)
  }

  const approved = blockers.length === 0 && score >= threshold

  return {
    id: Number(contact.id),
    email,
    company: contact.company ?? null,
    score: Math.min(100, score),
    approved,
    reasons,
    blockers,
    evidenceUrl,
    source,
  }
}
