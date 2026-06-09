import { verifyEmailAddress, type VerificationResult } from '@/lib/integrations/zerobounce'
import { validateBusinessEmailSyntax } from '@/lib/email-address'

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
  confidence: number
  verdict: 'approved' | 'review' | 'blocked'
  approved: boolean
  bounceRisk: 'low' | 'medium' | 'high'
  buyerFit: 'premium' | 'strong' | 'medium' | 'low'
  recommendation: 'approve' | 'review' | 'hold'
  verificationLabel: 'verified' | 'likely' | 'risky' | 'unverified'
  mailboxQuality: 'direct' | 'commercial' | 'generic' | 'risky'
  sourceStrength: 'exact_public' | 'provider_validated' | 'domain_matched' | 'pattern_only' | 'weak'
  decisionSummary: string
  sourceProof: {
    label: string
    url: string | null
  }
  reasons: string[]
  blockers: string[]
  evidenceUrl: string | null
  source: string | null
}

type PublicEvidenceResponse = {
  ok: boolean
  text: () => Promise<string>
}

export type PublicEmailEvidenceResult = {
  contact: ProspectResearchContact
  checked: boolean
  matched: boolean
  reason?: string
}

export type ProviderValidationResult = {
  contact: ProspectResearchContact
  checked: boolean
  verdict?: ProviderVerdict
  reason?: string
}

type ProviderVerdict = 'valid' | 'risky' | 'invalid' | 'unknown'

type ProviderEmailVerificationResult = {
  provider: string
  verdict: ProviderVerdict
  score: number
  catchAll: boolean
  raw: Record<string, unknown> | null
  error?: string
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
  'accounting',
  'billing',
  'career',
  'careers',
  'compliance',
  'comments',
  'community',
  'copyright',
  'customer',
  'customerservice',
  'dmca',
  'donotreply',
  'editor',
  'feedback',
  'finance',
  'fraud',
  'help',
  'helpdesk',
  'hr',
  'investor',
  'investors',
  'ir',
  'invoice',
  'invoices',
  'jobs',
  'legal',
  'listed',
  'listing',
  'media',
  'news',
  'no-reply',
  'noreply',
  'office',
  'orders',
  'payroll',
  'postmaster',
  'pr',
  'press',
  'privacy',
  'reception',
  'reportincident',
  'security',
  'service',
  'services',
  'support',
  'tax',
  'test',
  'testsecurity',
  'web',
  'website',
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

const VALIDATION_REQUIRED_PREFIXES = new Set([
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
  'sales',
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

const WEAK_GENERIC_PREFIXES = new Set([
  'contact',
  'hello',
  'hi',
  'info',
  'mail',
  'team',
])

const COMMERCIAL_ROLE_PREFIXES = new Set([
  'bd',
  'business',
  'growth',
  'marketing',
  'opportunities',
  'opportunity',
  'sales',
])

const PROTECTED_ENTERPRISE_DOMAINS = new Set([
  '1password.com',
  'ai.google',
  'anthropic.com',
  'clay.com',
  'cloudflare.com',
  'crowdstrike.com',
  'deepai.org',
  'grok.com',
  'langchain.com',
  'meta.ai',
  'microsoft.com',
  'mistral.ai',
  'notebooklm.google',
  'okta.com',
  'openai.com',
  'perplexity.ai',
  'rapid7.com',
  'sentinelone.com',
  'snyk.io',
  'vellum.ai',
  'wiz.io',
  'zscaler.com',
])

const BROAD_DIRECT_ENTERPRISE_DOMAINS = new Set([
  'adobe.com',
  'atlassian.com',
  'github.com',
  'hubspot.com',
  'monday.com',
  'neon.tech',
  'replicate.com',
  'salesforce.com',
  'stripe.com',
])

const AGENCY_BUYER_SIGNAL_RE =
  /\b(?:abm|appointment\s+setting|b2b\s+(?:demand|lead|marketing|sales)|client\s+acquisition|demand\s+generation|done[-\s]?for[-\s]?you\s+outbound|go[-\s]?to[-\s]?market|gtm|lead[-\s]?gen(?:eration)?|outbound\s+(?:agency|operator|ops|operations|sales|service)|pipeline\s+operations|revenue\s+operations|revops|sales\s+development|sdr\s+as\s+a\s+service|white[-\s]?label)\b/i

const LOW_INTENT_DOMAIN_PATTERNS = [
  /(^|\.)cylex-/,
  /(^|\.)findglocal\./,
  /(^|\.)meilleursagents\.com$/,
  /(^|\.)mapquest\./,
  /(^|\.)petitesaffiches\.fr$/,
  /(^|\.)yellowpages\./,
  /(^|\.)zillow\./,
  /(^|\.)zumper\./,
  /(^|\.)rew\.ca$/,
  /directory/,
  /classified/,
  /locale/,
]

const UNSAFE_OR_ADULT_PATTERNS = [
  /\badult\b/,
  /\bcasino\b/,
  /\bescort\b/,
  /\bgambling\b/,
  /\bnude\b/,
  /\bonlyfans\b/,
  /\bporn(?:o|hub|ography)?\b/,
  /\bsex\s*(?:chat|dating|site|video|worker)?\b/,
  /\bxnxx\b/,
  /\bxvideos\b/,
]

const NON_TARGET_CONTENT_PATTERNS = [
  /\bancient origins\b/,
  /\barticle\b/,
  /\bclassifieds?\b/,
  /\bcollege\b/,
  /\bcompare\s+\d+\s+ai\s+models\b/,
  /\bcourse\b/,
  /\bdirectory\b/,
  /\bdocumentation\b/,
  /\bdocs?\b/,
  /\bfree\s+porn\b/,
  /\bgames?\b/,
  /\bgaming\b/,
  /\bgovernment\b/,
  /\bguide\b/,
  /\bhiking\b/,
  /\bhistory\b/,
  /\bign\b/,
  /\blaw school\b/,
  /\blaw\s+(?:degree|admission|school|student)\b/,
  /\bleaderboard\b/,
  /\bllm\s+benchmark(?:s|ing)?\b/,
  /\bllm\s+degree\b/,
  /\blocal business(?:es)?\b/,
  /\bmagazine\b/,
  /\bmastering\b/,
  /\bmodule\b/,
  /\bmunicipal\b/,
  /\bnintendo\s+switch\b/,
  /\bopen[-\s]?world\b/,
  /\bpackage\b/,
  /\breal estate\b/,
  /\brentals?\b/,
  /\bschedule\s+appointment\b/,
  /\bschool\b/,
  /\bsports?\b/,
  /\bsteam\b/,
  /\bstudent\b/,
  /\bsurvival\b/,
  /\btemplate:infobox\b/,
  /\btraduci\b/,
  /\btranslation\b/,
  /\btutorial\b/,
  /\buniversity\b/,
  /\bwalkthrough\b/,
  /\bwhat is\b/,
  /\bwiki\b/,
  /\byellow pages\b/,
]

const NON_TARGET_HOST_PATTERNS = [
  /(^|\.)ancient-origins\.net$/,
  /(^|\.)dev\.to$/,
  /(^|\.)fandom\.com$/,
  /(^|\.)github\.com$/,
  /(^|\.)geeksforgeeks\.org$/,
  /(^|\.)ign\.com$/,
  /(^|\.)lsac\.org$/,
  /(^|\.)medium\.com$/,
  /(^|\.)nintendo\.com$/,
  /(^|\.)pkg\.go\.dev$/,
  /(^|\.)questdiagnostics\.com$/,
  /(^|\.)sports\.ndtv\.com$/,
  /(^|\.)stackoverflow\.com$/,
  /(^|\.)substack\.com$/,
  /(^|\.)thegamesedge\.com$/,
  /(^|\.)theoutbound\.com$/,
  /^docs?\./,
  /^learn\./,
]

const SAFE_SOURCE_TYPES = new Set([
  'apify_google_maps',
  'google_maps_apify',
  'google_maps_scraper_export',
  'google_sheet_import',
  'hunter_domain_search',
  'open_lead_graph',
  'owned_open_lead_graph',
  'operator_google_sheet',
  'public_search',
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
  return validateBusinessEmailSyntax(value).valid
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function pageContainsExactEmail(pageText: string, email: string): boolean {
  const normalizedEmail = email.trim().toLowerCase()
  if (!isEmail(normalizedEmail)) return false

  const haystack = pageText
    .toLowerCase()
    .replace(/&commat;/g, '@')
    .replace(/&#64;/g, '@')
    .replace(/&period;/g, '.')
    .replace(/&#46;/g, '.')

  if (haystack.includes(normalizedEmail)) return true

  const [local, domain] = normalizedEmail.split('@')
  const domainParts = domain.split('.').filter(Boolean)
  if (!local || domainParts.length < 2) return false

  const atPattern = String.raw`\s*(?:@|\[\s*at\s*\]|\(\s*at\s*\)|\s+at\s+)\s*`
  const dotPattern = String.raw`\s*(?:\.|\[\s*dot\s*\]|\(\s*dot\s*\)|\s+dot\s+)\s*`
  const pattern = `${escapeRegex(local)}${atPattern}${domainParts
    .map(escapeRegex)
    .join(dotPattern)}`

  return new RegExp(pattern, 'i').test(haystack)
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

const BUSINESS_ROLE_FALLBACK_EVIDENCE = new Set([
  'business_domain_role_pattern',
  'maps_public_business_domain_match',
  'maps_public_business_evidence',
  'synthetic_role_pattern',
])

function envBool(name: string, fallback: boolean): boolean {
  const value = process.env[name]
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) ? parsed : fallback
}

function requireExactPublicEmailEvidence(): boolean {
  return envBool('DAILY_OUTBOUND_REQUIRE_EXACT_PUBLIC_EMAIL_EVIDENCE', false)
}

function allowBusinessRoleFallback(): boolean {
  return envBool('DAILY_OUTBOUND_BUSINESS_ROLE_FALLBACK', true)
}

function isPersonLikeMailboxPrefix(prefix: string): boolean {
  return prefix.includes('.') || /^[a-z]+[._-][a-z]+$/.test(prefix)
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

  const mailboxRole = asString(customFields.email_validation_mailbox_role)
  if (!['commercial_role', 'safe_role'].includes(mailboxRole)) return false

  const score = scoreNumber(customFields.email_validation_score)
  return score >= ownedProviderValidationMinScore()
}

function hasAcceptedProviderValidationFallback(customFields: Record<string, unknown>): boolean {
  if (hasAcceptedOwnedValidationFallback(customFields)) return true
  if (!allowUnknownProviderValidation()) return false
  const provider = asString(customFields.email_validation_provider)
  const verdict = asString(customFields.email_validation_verdict)
  const score = scoreNumber(customFields.email_validation_score)
  if (!provider) return false
  if (verdict === 'risky') return score >= 0.65
  if (verdict === 'unknown') return score >= 0.75
  return false
}

function hasAcceptedBusinessRoleFallback(
  customFields: Record<string, unknown>,
  prefix: string
): boolean {
  if (!allowBusinessRoleFallback()) return false
  if (!SAFE_BUSINESS_PREFIXES.has(prefix)) return false
  const hasTrustedAutonomousSource =
    asBool(customFields.public_search) ||
    asBool(customFields.lead_scout) ||
    asBool(customFields.maps_import) ||
    ['apify_google_maps', 'public_search', 'owned_open_lead_graph'].includes(
      asString(customFields.data_source)
    )
  if (!hasTrustedAutonomousSource) return false

  const evidence = asString(customFields.email_evidence).toLowerCase()
  if (!BUSINESS_ROLE_FALLBACK_EVIDENCE.has(evidence)) return false

  const fitScore = scoreNumber(customFields.fit_score)
  if (WEAK_GENERIC_PREFIXES.has(prefix)) {
    return evidence === 'maps_public_business_domain_match' && fitScore >= 95
  }
  if (evidence === 'synthetic_role_pattern') return fitScore >= 88
  if (evidence === 'maps_public_business_evidence') return fitScore >= 82
  return fitScore >= 70
}

function hasStrongEmailEvidence(
  customFields: Record<string, unknown>,
  verificationStatus: string
): boolean {
  return (
    verificationStatus === 'valid' ||
    hasExactPublicEmailEvidence(customFields.email_evidence) ||
    hasAcceptedProviderValidationFallback(customFields)
  )
}

function weakGenericHasHardEvidence(
  customFields: Record<string, unknown>,
  verificationStatus: string
): boolean {
  return verificationStatus === 'valid' || hasExactPublicEmailEvidence(customFields.email_evidence)
}

function sourceProofLabel(
  customFields: Record<string, unknown>,
  evidenceUrl: string | null,
  source: string | null
): { label: string; url: string | null } {
  const provider = asString(customFields.email_validation_provider)
  if (evidenceUrl) {
    return {
      label: hasSpecificEvidencePath(evidenceUrl) ? 'public page proof' : 'domain proof',
      url: evidenceUrl,
    }
  }
  if (provider) return { label: `${provider} verification`, url: null }
  if (source) return { label: source.replace(/_/g, ' '), url: null }
  return { label: 'not recorded', url: null }
}

function buyerFitFromScore(fitScore: number): ProspectResearchDecision['buyerFit'] {
  if (fitScore >= 90) return 'premium'
  if (fitScore >= 80) return 'strong'
  if (fitScore >= 70) return 'medium'
  return 'low'
}

function verificationLabelFor(
  customFields: Record<string, unknown>,
  verificationStatus: string,
  prefix: string
): ProspectResearchDecision['verificationLabel'] {
  if (verificationStatus === 'valid' || hasExactPublicEmailEvidence(customFields.email_evidence)) {
    return 'verified'
  }
  if (hasAcceptedOwnedValidationFallback(customFields)) return 'likely'
  if (hasAcceptedBusinessRoleFallback(customFields, prefix)) return 'likely'
  if (['invalid', 'do_not_mail'].includes(verificationStatus)) return 'risky'
  if (hasAcceptedProviderValidationFallback(customFields)) return 'risky'
  return 'unverified'
}

function bounceRiskFor(
  blockers: string[],
  customFields: Record<string, unknown>,
  verificationStatus: string,
  prefix: string
): ProspectResearchDecision['bounceRisk'] {
  const hardRisk = blockers.some((blocker) =>
    [
      'invalid_email',
      'personal_email_domain',
      'artifact_or_too_short_mailbox',
      'blocked_mailbox_prefix',
      'previously_bounced',
      'unsubscribed',
      'institutional_or_government_domain',
      'low_intent_public_directory_domain',
    ].includes(blocker) ||
    blocker.startsWith('verification_') ||
    blocker.includes('weak_generic')
  )
  if (hardRisk) return 'high'
  if (verificationStatus === 'valid' || hasExactPublicEmailEvidence(customFields.email_evidence)) return 'low'
  if (WEAK_GENERIC_PREFIXES.has(prefix) || hasAcceptedProviderValidationFallback(customFields)) return 'medium'
  return 'medium'
}

function hasInstitutionalOrGovernmentDomain(domain: string): boolean {
  const normalized = normalizeDomain(domain)
  return /\.(edu|gov|mil)(\.[a-z]{2})?$/.test(normalized) || /\.ac\.[a-z]{2}$/.test(normalized)
}

function hasLowIntentDomain(domain: string): boolean {
  const normalized = normalizeDomain(domain)
  return LOW_INTENT_DOMAIN_PATTERNS.some((pattern) => pattern.test(normalized))
}

function hasProtectedEnterpriseDomain(domain: string): boolean {
  const normalized = normalizeDomain(domain)
  const root = rootDomain(normalized)
  return (
    PROTECTED_ENTERPRISE_DOMAINS.has(normalized) ||
    PROTECTED_ENTERPRISE_DOMAINS.has(root) ||
    BROAD_DIRECT_ENTERPRISE_DOMAINS.has(normalized) ||
    BROAD_DIRECT_ENTERPRISE_DOMAINS.has(root)
  )
}

function isArtifactMailboxPrefix(prefix: string): boolean {
  const normalized = prefix.trim().toLowerCase()
  if (!normalized) return true
  if (normalized.length <= 2) return true
  if (/^\d/.test(normalized)) return true
  if (/^test(?:[._-]?[a-z0-9]+)?$/.test(normalized)) return true
  if (/^(?:listed|listing|reportincident|incident)$/i.test(normalized)) return true
  if (/^[a-z]{3}$/.test(normalized) && !SAFE_BUSINESS_PREFIXES.has(normalized)) return true
  return false
}

type MailboxQuality = ProspectResearchDecision['mailboxQuality']
type SourceStrength = ProspectResearchDecision['sourceStrength']

function mailboxQualityFor(prefix: string): MailboxQuality {
  const normalized = prefix.trim().toLowerCase()
  if (BLOCKED_MAILBOX_PREFIXES.has(normalized) || isArtifactMailboxPrefix(normalized)) return 'risky'
  if (COMMERCIAL_ROLE_PREFIXES.has(normalized) || RISKY_GUESSED_ROLE_PREFIXES.has(normalized)) {
    return 'commercial'
  }
  if (WEAK_GENERIC_PREFIXES.has(normalized) || SAFE_BUSINESS_PREFIXES.has(normalized)) return 'generic'
  if (isPersonLikeMailboxPrefix(normalized)) return 'direct'
  return 'generic'
}

function sourceStrengthFor(
  customFields: Record<string, unknown>,
  verificationStatus: string,
  evidenceUrl: string | null,
  source: string | null
): SourceStrength {
  const evidence = asString(customFields.email_evidence).toLowerCase()
  const validationVerdict = asString(customFields.email_validation_verdict).toLowerCase()

  if (['exact_public_email', 'public_mailto_match', 'public_page_email_match'].includes(evidence)) {
    return 'exact_public'
  }
  if (verificationStatus === 'valid' || evidence === 'provider_validated' || validationVerdict === 'valid') {
    return 'provider_validated'
  }
  if (hasAcceptedOwnedValidationFallback(customFields)) {
    return 'provider_validated'
  }
  if (
    [
      'hunter_domain_search',
      'maps_public_business_domain_match',
      'maps_public_business_evidence',
      'public_domain_email',
    ].includes(evidence)
  ) {
    return 'domain_matched'
  }
  if (['business_domain_role_pattern', 'synthetic_role_pattern'].includes(evidence)) return 'pattern_only'
  if (evidenceUrl) return 'domain_matched'
  if (source) return 'weak'
  return 'weak'
}

function humanizeToken(value: string): string {
  return value.replace(/_/g, ' ')
}

function mailboxQualityCopy(value: MailboxQuality): string {
  if (value === 'direct') return 'direct person-like'
  if (value === 'commercial') return 'commercial role'
  if (value === 'generic') return 'generic business'
  return 'risky'
}

function sourceStrengthCopy(value: SourceStrength): string {
  if (value === 'exact_public') return 'exact public email proof'
  if (value === 'provider_validated') return 'provider validation'
  if (value === 'domain_matched') return 'domain-matched public proof'
  if (value === 'pattern_only') return 'pattern-only evidence'
  return 'weak proof'
}

function decisionSummaryFor(args: {
  approved: boolean
  blockers: string[]
  bounceRisk: ProspectResearchDecision['bounceRisk']
  mailboxQuality: MailboxQuality
  sourceStrength: SourceStrength
  buyerFit: ProspectResearchDecision['buyerFit']
}): string {
  if (args.approved) {
    return `Sendable: ${mailboxQualityCopy(args.mailboxQuality)} inbox with ${sourceStrengthCopy(args.sourceStrength)} and ${args.buyerFit} buyer fit.`
  }

  const reason =
    args.blockers[0] ??
    (args.bounceRisk === 'high' ? 'high bounce risk' : 'score below approval threshold')
  return `Hold: ${humanizeToken(reason)}. ${mailboxQualityCopy(args.mailboxQuality)} inbox with ${sourceStrengthCopy(args.sourceStrength)}.`
}

function prospectText(contact: ProspectResearchContact): string {
  const customFields = contact.custom_fields ?? {}
  const selectedCustomFields = [
    'company',
    'company_domain',
    'data_source',
    'description',
    'email_evidence',
    'industry',
    'maps_category',
    'public_evidence_url',
    'public_snippet',
    'public_title',
    'reason_to_contact',
    'search_query',
    'search_snippet',
    'search_title',
    'source_url',
    'website_text',
  ]

  return [
    contact.email,
    contact.email_domain,
    contact.company,
    contact.company_domain,
    contact.title,
    contact.source,
    ...selectedCustomFields.map((key) => customFields[key]),
  ]
    .map((value) => String(value ?? '').toLowerCase())
    .filter(Boolean)
    .join(' ')
}

function hasAgencyBuyerSignal(contact: ProspectResearchContact): boolean {
  return AGENCY_BUYER_SIGNAL_RE.test(prospectText(contact))
}

function hasUnsafeOrAdultProspectSignal(contact: ProspectResearchContact): boolean {
  const text = prospectText(contact)
  return UNSAFE_OR_ADULT_PATTERNS.some((pattern) => pattern.test(text))
}

function hasNonTargetHostSignal(contact: ProspectResearchContact): boolean {
  const customFields = contact.custom_fields ?? {}
  const hosts = [
    contact.email_domain,
    contact.company_domain,
    getEvidenceHost(asString(customFields.public_evidence_url) || asString(customFields.source_url)),
  ]
    .map((value) => normalizeDomain(value || ''))
    .filter(Boolean)

  return hosts.some((host) => NON_TARGET_HOST_PATTERNS.some((pattern) => pattern.test(host)))
}

function looksLikeContentPageInsteadOfCompany(contact: ProspectResearchContact): boolean {
  const customFields = contact.custom_fields ?? {}
  const titleText = [
    contact.company,
    contact.title,
    customFields.public_title,
    customFields.search_title,
  ]
    .map((value) => String(value ?? '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ')
  const fullText = prospectText(contact)
  const companyWords = String(contact.company ?? '').trim().split(/\s+/).filter(Boolean).length

  return (
    NON_TARGET_CONTENT_PATTERNS.some((pattern) => pattern.test(titleText || fullText)) ||
    companyWords >= 9
  )
}

function prospectContentBlockers(contact: ProspectResearchContact): string[] {
  const blockers: string[] = []
  if (hasUnsafeOrAdultProspectSignal(contact)) blockers.push('unsafe_or_adult_prospect')
  if (hasNonTargetHostSignal(contact)) blockers.push('content_or_documentation_host')
  if (looksLikeContentPageInsteadOfCompany(contact)) blockers.push('content_page_not_company')
  return blockers
}

export function prospectNeedsExactPublicEmailEvidence(
  contact: ProspectResearchContact
): boolean {
  const email = contact.email.trim().toLowerCase()
  const [prefix = ''] = email.split('@')
  const verificationStatus = String(contact.verification_status ?? 'pending')
  const customFields = contact.custom_fields ?? {}

  return (
    RISKY_GUESSED_ROLE_PREFIXES.has(prefix) &&
    verificationStatus !== 'valid' &&
    !hasExactPublicEmailEvidence(customFields.email_evidence) &&
    !hasAcceptedBusinessRoleFallback(customFields, prefix) &&
    !hasAcceptedProviderValidationFallback(customFields)
  )
}

export function approvedContactQueueBlockers(
  contact: ProspectResearchContact
): string[] {
  const blockers: string[] = []
  const email = contact.email.trim().toLowerCase()
  const [prefix = '', emailDomainFromAddress = ''] = email.split('@')
  const emailDomain = normalizeDomain(contact.email_domain || emailDomainFromAddress)
  const verificationStatus = String(contact.verification_status ?? 'pending')
  const customFields = contact.custom_fields ?? {}
  const fitScore = scoreNumber(customFields.fit_score)
  const agencyBuyerSignal = hasAgencyBuyerSignal(contact)

  if (!isEmail(email)) blockers.push('invalid_email')
  if (contact.status && contact.status !== 'active') blockers.push('inactive_contact')
  if (contact.bounced_at) blockers.push('previously_bounced')
  if (contact.unsubscribed_at) blockers.push('unsubscribed')
  if (BLOCKED_MAILBOX_PREFIXES.has(prefix)) blockers.push('blocked_mailbox_prefix')
  if (isArtifactMailboxPrefix(prefix)) blockers.push('artifact_or_too_short_mailbox')
  if (hasInstitutionalOrGovernmentDomain(emailDomain)) {
    blockers.push('institutional_or_government_domain')
  }
  if (hasLowIntentDomain(emailDomain)) {
    blockers.push('low_intent_public_directory_domain')
  }
  if (
    WEAK_GENERIC_PREFIXES.has(prefix) &&
    hasProtectedEnterpriseDomain(emailDomain)
  ) {
    blockers.push('weak_generic_enterprise_inbox_requires_manual_review')
  }
  if (
    !agencyBuyerSignal &&
    hasProtectedEnterpriseDomain(emailDomain) &&
    !hasExactPublicEmailEvidence(customFields.email_evidence)
  ) {
    blockers.push('protected_direct_enterprise_requires_manual_review')
  }
  if (
    !agencyBuyerSignal &&
    (WEAK_GENERIC_PREFIXES.has(prefix) || mailboxQualityFor(prefix) === 'generic') &&
    fitScore < 95
  ) {
    blockers.push('direct_generic_low_reply_risk')
  }
  if (
    WEAK_GENERIC_PREFIXES.has(prefix) &&
    !weakGenericHasHardEvidence(customFields, verificationStatus)
  ) {
    blockers.push('weak_generic_inbox_requires_verification_or_public_proof')
  }
  if (['invalid', 'do_not_mail'].includes(verificationStatus)) {
    blockers.push(`verification_${verificationStatus}`)
  }
  if (
    asBool(customFields.lead_scout) &&
    !asBool(customFields.auto_approval_eligible) &&
    verificationStatus !== 'valid' &&
    requireExactPublicEmailEvidence()
  ) {
    blockers.push('lead_scout_without_public_evidence')
  }
  if (
    VALIDATION_REQUIRED_PREFIXES.has(prefix) &&
    verificationStatus !== 'valid' &&
    !hasExactPublicEmailEvidence(customFields.email_evidence) &&
    !hasAcceptedBusinessRoleFallback(customFields, prefix) &&
    !hasAcceptedProviderValidationFallback(customFields)
  ) {
    blockers.push('generic_inbox_requires_email_validation')
  }
  if (prospectNeedsExactPublicEmailEvidence(contact)) {
    blockers.push('risky_role_requires_exact_public_email_evidence')
  }
  blockers.push(...prospectContentBlockers(contact))

  return Array.from(new Set(blockers))
}

export async function enrichProspectWithPublicEmailEvidence(
  contact: ProspectResearchContact,
  options?: {
    fetchPage?: (url: string) => Promise<PublicEvidenceResponse>
    now?: () => Date
    maxBytes?: number
  }
): Promise<PublicEmailEvidenceResult> {
  const customFields = contact.custom_fields ?? {}
  if (!prospectNeedsExactPublicEmailEvidence(contact)) {
    return {
      contact,
      checked: false,
      matched: hasExactPublicEmailEvidence(customFields.email_evidence),
      reason: 'exact_evidence_not_required',
    }
  }

  const evidenceUrl = asString(customFields.public_evidence_url) || asString(customFields.source_url)
  if (!evidenceUrl) {
    return {
      contact,
      checked: false,
      matched: false,
      reason: 'missing_public_evidence_url',
    }
  }

  try {
    const response = options?.fetchPage
      ? await options.fetchPage(evidenceUrl)
      : await fetch(evidenceUrl, {
          cache: 'no-store',
          redirect: 'follow',
          signal: AbortSignal.timeout(6_000),
        })

    if (!response.ok) {
      return {
        contact,
        checked: true,
        matched: false,
        reason: 'public_evidence_fetch_failed',
      }
    }

    const maxBytes = Math.max(10_000, Math.min(options?.maxBytes ?? 250_000, 1_000_000))
    const pageText = (await response.text()).slice(0, maxBytes)
    const matched = pageContainsExactEmail(pageText, contact.email)

    if (!matched) {
      return {
        contact,
        checked: true,
        matched: false,
        reason: 'exact_email_not_found_on_evidence_page',
      }
    }

    return {
      contact: {
        ...contact,
        custom_fields: {
          ...customFields,
          email_evidence: 'public_page_email_match',
          email_evidence_checked_at: (options?.now?.() ?? new Date()).toISOString(),
        },
      },
      checked: true,
      matched: true,
    }
  } catch {
    return {
      contact,
      checked: true,
      matched: false,
      reason: 'public_evidence_fetch_error',
    }
  }
}

export async function enrichProspectWithProviderValidation(
  contact: ProspectResearchContact,
  options?: {
    verifyEmail?: (email: string) => Promise<ProviderEmailVerificationResult>
    now?: () => Date
  }
): Promise<ProviderValidationResult> {
  const email = contact.email.trim().toLowerCase()
  const [prefix = ''] = email.split('@')
  const verificationStatus = String(contact.verification_status ?? 'pending').toLowerCase()
  const customFields = contact.custom_fields ?? {}
  const needsValidation =
    VALIDATION_REQUIRED_PREFIXES.has(prefix) ||
    isPersonLikeMailboxPrefix(prefix) ||
    (RISKY_GUESSED_ROLE_PREFIXES.has(prefix) && !hasExactPublicEmailEvidence(customFields.email_evidence))

  if (!needsValidation) {
    return { contact, checked: false, reason: 'provider_validation_not_required' }
  }

  if (verificationStatus === 'valid' || hasExactPublicEmailEvidence(customFields.email_evidence)) {
    return { contact, checked: false, reason: 'already_validated' }
  }

  const result = options?.verifyEmail
    ? await options.verifyEmail(email)
    : await verifyEmailWithConfiguredProvider(email)
  const checkedAt = (options?.now?.() ?? new Date()).toISOString()
  const raw = result.raw ?? {}
  const ownedConfidence = scoreNumber(raw.owned_confidence)
  const validationFields = {
    ...customFields,
    email_validation_provider: result.provider,
    email_validation_score: result.score,
    email_validation_checked_at: checkedAt,
    email_validation_verdict: result.verdict,
    email_validation_error: result.error ?? null,
    email_validation_mx: raw.mx === true ? true : raw.mx === false ? false : null,
    email_validation_mx_provider: asString(raw.mx_provider) || null,
    email_validation_mailbox_role: asString(raw.mailbox_role) || null,
    email_validation_owned_confidence: ownedConfidence > 0 ? ownedConfidence : null,
  }

  if (result.verdict === 'valid' && result.score >= 0.75) {
    return {
      contact: {
        ...contact,
        verification_status: 'valid',
        custom_fields: {
          ...validationFields,
          email_evidence: 'provider_validated',
        },
      },
      checked: true,
      verdict: result.verdict,
    }
  }

  if (result.verdict === 'invalid') {
    return {
      contact: {
        ...contact,
        verification_status: 'invalid',
        custom_fields: validationFields,
      },
      checked: true,
      verdict: result.verdict,
    }
  }

  return {
    contact: {
      ...contact,
      verification_status: result.verdict === 'risky' ? 'unknown' : contact.verification_status,
      custom_fields: validationFields,
    },
    checked: true,
    verdict: result.verdict,
  }
}

function mapProviderVerificationResult(
  result: VerificationResult
): ProviderEmailVerificationResult {
  if (result.status === 'valid') {
    return {
      provider: result.provider,
      verdict: 'valid',
      score: result.score,
      catchAll: false,
      raw: result.raw,
      error: result.error,
    }
  }

  if (result.status === 'invalid' || result.status === 'do_not_mail') {
    return {
      provider: result.provider,
      verdict: 'invalid',
      score: result.score,
      catchAll: false,
      raw: result.raw,
      error: result.error,
    }
  }

  if (result.status === 'catch_all') {
    return {
      provider: result.provider,
      verdict: 'risky',
      score: result.score,
      catchAll: true,
      raw: result.raw,
      error: result.error,
    }
  }

  return {
    provider: result.provider,
    verdict: 'unknown',
    score: result.score,
    catchAll: false,
    raw: result.raw,
    error: result.error ?? result.subStatus ?? undefined,
  }
}

async function verifyEmailWithConfiguredProvider(
  email: string
): Promise<ProviderEmailVerificationResult> {
  return mapProviderVerificationResult(await verifyEmailAddress(email))
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
  const agencyBuyerSignal = hasAgencyBuyerSignal(contact)
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

  if (isArtifactMailboxPrefix(prefix)) {
    blockers.push('artifact_or_too_short_mailbox')
  }

  if (prefix.includes('+')) {
    blockers.push('tagged_or_test_address')
  }

  const verificationStatus = String(contact.verification_status ?? 'pending')
  const mailboxQuality = mailboxQualityFor(prefix)
  const sourceStrength = sourceStrengthFor(customFields, verificationStatus, evidenceUrl, source)
  if (['invalid', 'do_not_mail'].includes(verificationStatus)) {
    blockers.push(`verification_${verificationStatus}`)
  }

  if (
    VALIDATION_REQUIRED_PREFIXES.has(prefix) &&
    verificationStatus !== 'valid' &&
    !hasExactPublicEmailEvidence(customFields.email_evidence) &&
    !hasAcceptedBusinessRoleFallback(customFields, prefix) &&
    !hasAcceptedProviderValidationFallback(customFields)
  ) {
    blockers.push('generic_inbox_requires_email_validation')
  }

  if (
    WEAK_GENERIC_PREFIXES.has(prefix) &&
    !weakGenericHasHardEvidence(customFields, verificationStatus)
  ) {
    blockers.push('weak_generic_inbox_requires_verification_or_public_proof')
  }

  if (hasInstitutionalOrGovernmentDomain(emailDomain)) {
    blockers.push('institutional_or_government_domain')
  }

  if (hasLowIntentDomain(emailDomain)) {
    blockers.push('low_intent_public_directory_domain')
  }

  if (
    WEAK_GENERIC_PREFIXES.has(prefix) &&
    hasProtectedEnterpriseDomain(emailDomain)
  ) {
    blockers.push('weak_generic_enterprise_inbox_requires_manual_review')
  }

  if (
    !agencyBuyerSignal &&
    hasProtectedEnterpriseDomain(emailDomain) &&
    !hasExactPublicEmailEvidence(customFields.email_evidence)
  ) {
    blockers.push('protected_direct_enterprise_requires_manual_review')
  }

  if (
    WEAK_GENERIC_PREFIXES.has(prefix) &&
    hasProtectedEnterpriseDomain(emailDomain) &&
    !hasStrongEmailEvidence(customFields, verificationStatus)
  ) {
    blockers.push('weak_generic_enterprise_inbox_requires_strong_evidence')
  }

  if (
    WEAK_GENERIC_PREFIXES.has(prefix) &&
    hasLowIntentDomain(emailDomain) &&
    !hasStrongEmailEvidence(customFields, verificationStatus)
  ) {
    blockers.push('weak_generic_low_intent_domain_requires_strong_evidence')
  }

  if (
    isPersonLikeMailboxPrefix(prefix) &&
    verificationStatus !== 'valid' &&
    !hasExactPublicEmailEvidence(customFields.email_evidence) &&
    !hasAcceptedProviderValidationFallback(customFields)
  ) {
    blockers.push('person_like_email_requires_manual_review')
  }

  if (prospectNeedsExactPublicEmailEvidence(contact)) {
    blockers.push('risky_role_requires_exact_public_email_evidence')
  }

  if (source && !SAFE_SOURCE_TYPES.has(source) && !asBool(customFields.lead_scout) && !asBool(customFields.sheet_import)) {
    blockers.push('unsupported_source')
  } else {
    score += 8
    reasons.push('trusted_source')
  }

  blockers.push(...prospectContentBlockers(contact))

  if (COMMERCIAL_ROLE_PREFIXES.has(prefix)) {
    score += 32
    reasons.push('strong_commercial_inbox')
    reasons.push('safe_business_inbox')
  } else if (SAFE_BUSINESS_PREFIXES.has(prefix)) {
    score += 28
    reasons.push('safe_business_inbox')
  } else if (isPersonLikeMailboxPrefix(prefix)) {
    score += 10
    reasons.push('person_like_business_inbox')
  } else {
    score += 8
    reasons.push('neutral_business_inbox')
  }
  reasons.push(`mailbox_quality_${mailboxQuality}`)
  reasons.push(`source_strength_${sourceStrength}`)
  if (mailboxQuality === 'direct') {
    score += 8
  } else if (mailboxQuality === 'commercial') {
    score += 6
  }

  if (sourceStrength === 'exact_public') {
    score += 14
  } else if (sourceStrength === 'provider_validated') {
    score += 12
  } else if (sourceStrength === 'domain_matched') {
    score += 7
  } else if (sourceStrength === 'pattern_only') {
    score += 2
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
    reasons.push('public_evidence_url_absent')
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
      reasons.push('evidence_domain_unaligned')
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
  if (
    !agencyBuyerSignal &&
    (WEAK_GENERIC_PREFIXES.has(prefix) || mailboxQuality === 'generic') &&
    fitScore < 95
  ) {
    blockers.push('direct_generic_low_reply_risk')
  }

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
    score += 18
    reasons.push('email_verified_valid')
  } else if (verificationStatus === 'catch_all' || verificationStatus === 'unknown') {
    score += 2
    reasons.push(`verification_${verificationStatus}`)
  }
  if (hasAcceptedProviderValidationFallback(customFields)) {
    score += 8
    reasons.push(`provider_validation_${asString(customFields.email_validation_verdict)}_accepted`)
  }
  if (hasAcceptedBusinessRoleFallback(customFields, prefix)) {
    score += 12
    reasons.push('business_role_fallback_accepted')
  }

  const uniqueBlockers = Array.from(new Set(blockers))
  const bounceRisk = bounceRiskFor(uniqueBlockers, customFields, verificationStatus, prefix)
  const buyerFit = buyerFitFromScore(fitScore)
  const verificationLabel = verificationLabelFor(customFields, verificationStatus, prefix)
  let confidence = Math.min(100, score)
  if (mailboxQuality === 'generic' && sourceStrength === 'weak') confidence = Math.min(confidence, 64)
  if (mailboxQuality === 'generic' && sourceStrength === 'pattern_only') confidence = Math.min(confidence, 69)
  if (uniqueBlockers.length > 0) confidence = Math.min(confidence, 64)
  if (bounceRisk === 'high') confidence = Math.min(confidence, 49)
  const approved = uniqueBlockers.length === 0 && confidence >= threshold && bounceRisk !== 'high'
  const verdict = approved ? 'approved' : uniqueBlockers.length > 0 ? 'blocked' : 'review'
  const recommendation = approved ? 'approve' : bounceRisk === 'high' || uniqueBlockers.length > 0 ? 'hold' : 'review'
  const decisionSummary = decisionSummaryFor({
    approved,
    blockers: uniqueBlockers,
    bounceRisk,
    mailboxQuality,
    sourceStrength,
    buyerFit,
  })

  return {
    id: Number(contact.id),
    email,
    company: contact.company ?? null,
    score: confidence,
    confidence,
    verdict,
    approved,
    bounceRisk,
    buyerFit,
    recommendation,
    verificationLabel,
    mailboxQuality,
    sourceStrength,
    decisionSummary,
    sourceProof: sourceProofLabel(customFields, evidenceUrl, source),
    reasons: Array.from(new Set(reasons)),
    blockers: uniqueBlockers,
    evidenceUrl,
    source,
  }
}
