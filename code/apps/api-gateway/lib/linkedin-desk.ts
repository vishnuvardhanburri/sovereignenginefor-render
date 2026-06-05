import type { Contact } from '@/lib/db/types'
import { validateBusinessEmailSyntax } from '@/lib/email-address'
import {
  buildSovereignCopyDecision,
  inferSovereignOfferType,
  renderSovereignTemplate,
  sovereignBodyForLead,
  sovereignBookingUrl,
  sovereignClientIntentScore,
  sovereignDealValueGbp,
  sovereignSubjectForLead,
  type SovereignCopyLead,
  type SovereignOfferType,
} from '@/lib/outbound-copy'
import {
  isTargetPayingMarketLead,
  targetMarketScoreBonus,
} from '@/lib/target-market'

export type LinkedInOfferMode = 'auto' | SovereignOfferType

export type LinkedInDeskAccount = {
  id: number
  email: string
  name: string
  firstName: string
  company: string
  title: string
  source: string
  status: string
  offerType: SovereignOfferType
  offerLabel: string
  dealValueGbp: number
  closeScore: number
  linkedinUrl: string
  websiteUrl: string
  evidenceUrl: string
  dmStatus: string
  lastDmDate: string
  dmText: string
  followUpText: string
  emailSubject: string
  emailText: string
  reason: string
}

export type LinkedInDeskSummary = {
  dailyTarget: number
  minimumDailyTarget: number
  queueCount: number
  shortfall: number
  agencyCount: number
  directCount: number
  availableCount: number
  topMotion: 'white_label_first' | 'internal_first' | 'balanced'
  topMotionLabel: string
}

export type PublicEmailScrapeTarget = {
  raw: string
  websiteUrl: string
  linkedinUrl: string
  company: string
  domain: string
}

export type PublicEmailScrapeResult = {
  email: string
  domain: string
  company: string
  sourceUrl: string
  linkedinUrl: string
  offerType: SovereignOfferType
  confidence: 'high' | 'medium' | 'low'
  contactRole: string
  evidenceSummary: string
  publicSignals: string[]
  phoneNumbers: string[]
  discoveredPages: number
}

export type PublicEmailScrapeResponse = {
  targets: PublicEmailScrapeTarget[]
  found: PublicEmailScrapeResult[]
  rejected: Array<{ raw: string; reason: string }>
}

const LINKEDIN_URL_RE = /https?:\/\/(?:[\w-]+\.)?linkedin\.com\/[^\s),]+/gi
const URL_RE = /https?:\/\/[^\s),]+|(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?:\/[^\s),]*)?/gi
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const COMMON_PUBLIC_PATHS = [
  '',
  '/',
  '/contact',
  '/contact-us',
  '/get-in-touch',
  '/sales',
  '/demo',
  '/book-a-demo',
  '/about',
  '/about-us',
  '/team',
  '/people',
  '/leadership',
  '/company',
  '/solutions',
  '/services',
  '/partners',
  '/partnerships',
  '/customers',
  '/case-studies',
  '/work',
  '/pricing',
]
const SITEMAP_PATHS = ['/sitemap.xml', '/sitemap_index.xml']
const HIGH_VALUE_LINK_RE =
  /\b(?:contact|contact-us|get-in-touch|sales|demo|book-a-demo|about|team|people|leadership|company|solutions|services|partners?|partnerships?|customers?|case-stud(?:y|ies)|work|pricing)\b/i
const PUBLIC_SIGNAL_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:enterprise|mid-market|b2b|revenue operations|revops|go-to-market|gtm)\b/i, 'B2B revenue motion'],
  [/\b(?:white[-\s]?label|agency|client services|managed service|done[-\s]?for[-\s]?you)\b/i, 'white-label or agency motion'],
  [/\b(?:ai governance|governance|compliance|audit|soc 2|iso 27001|security)\b/i, 'governance/security proof'],
  [/\b(?:outbound|cold email|sales development|sdr|appointment setting|lead generation)\b/i, 'outbound or pipeline ops'],
  [/\b(?:deliverability|sender reputation|inbox|email infrastructure|domain health)\b/i, 'email infrastructure pain'],
  [/\b(?:case studies|customers|portfolio|results|roi)\b/i, 'public proof available'],
]
const MINIMUM_DAILY_DM_TARGET = 34
const DEFAULT_DAILY_DM_TARGET = 34
const MAX_SCRAPE_TARGETS = 60
const MAX_EMAILS_PER_TARGET = 12
const MAX_PUBLIC_PAGES_PER_TARGET = 24
const MAX_DISCOVERED_LINKS_PER_SOURCE = 16
const MAX_FETCH_BYTES = 500_000
const SCRAPE_TIMEOUT_MS = 4500
const LINKEDIN_LOOKUP_TIMEOUT_MS = 3500
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

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function trimUrlNoise(value: string): string {
  return value.replace(/[)\].,;'"<>]+$/g, '').trim()
}

function safeUrl(value: string): string {
  const candidate = trimUrlNoise(value)
  if (!candidate) return ''
  try {
    const url = new URL(candidate.startsWith('http') ? candidate : `https://${candidate}`)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    return url.toString()
  } catch {
    return ''
  }
}

function isLinkedInUrl(value: string): boolean {
  try {
    return new URL(value).hostname.toLowerCase().includes('linkedin.com')
  } catch {
    return /linkedin\.com/i.test(value)
  }
}

function isExactLinkedInAccountUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    const path = url.pathname.toLowerCase().replace(/\/+$/, '')
    return (
      host.endsWith('linkedin.com') &&
      (/^\/in\/[^/]+/.test(path) ||
        /^\/company\/[^/]+/.test(path) ||
        /^\/school\/[^/]+/.test(path) ||
        /^\/showcase\/[^/]+/.test(path))
    )
  } catch {
    return false
  }
}

function normalizeExactLinkedInAccountUrl(value: string): string {
  const decoded = value.replace(/&amp;/gi, '&')
  const url = safeUrl(decoded)
  if (!url || !isExactLinkedInAccountUrl(url)) return ''
  const parsed = new URL(url)
  parsed.hash = ''
  parsed.search = ''
  return parsed.toString()
}

function hostDomain(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

function companyFromDomain(domain: string): string {
  const base = domain.replace(/^www\./i, '').split('.')[0]?.replace(/[-_]+/g, ' ').trim()
  return base ? base.replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Unknown company'
}

function decodeBingTarget(value: string): string {
  const decoded = value.replace(/&amp;/gi, '&')
  try {
    const url = new URL(decoded, 'https://www.bing.com')
    const encodedTarget = url.searchParams.get('u')
    if (!encodedTarget) return url.toString()
    const payload = encodedTarget.startsWith('a1') ? encodedTarget.slice(2) : encodedTarget
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
    return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8') || url.toString()
  } catch {
    return decoded
  }
}

function extractExactLinkedInAccountsFromHtml(html: string): string[] {
  const directMatches = html.match(LINKEDIN_URL_RE) ?? []
  const hrefMatches = Array.from(html.matchAll(/href=["']([^"']+)["']/gi)).map((match) =>
    decodeBingTarget(String(match[1] || ''))
  )
  return Array.from(
    new Set(
      [...directMatches, ...hrefMatches]
        .map(normalizeExactLinkedInAccountUrl)
        .filter(Boolean)
    )
  )
}

export async function findExactLinkedInAccountUrl(input: {
  company: string
  domain: string
}): Promise<string> {
  const enabled = String(process.env.LINKEDIN_EXACT_ACCOUNT_LOOKUP ?? 'true').toLowerCase() !== 'false'
  if (!enabled) return ''

  const company = input.company || companyFromDomain(input.domain)
  const queries = [
    `"${company}" "${input.domain}" site:linkedin.com/company`,
    `"${company}" site:linkedin.com/company`,
    `"${company}" founder site:linkedin.com/in`,
  ]

  for (const query of queries) {
    try {
      const url = new URL('https://www.bing.com/search')
      url.searchParams.set('q', query)
      url.searchParams.set('setlang', 'en-US')
      url.searchParams.set('ensearch', '1')
      const response = await fetch(url, {
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'en-US,en;q=0.8',
          'user-agent': 'SovereignEngineLinkedInAccountLookup/1.0',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(LINKEDIN_LOOKUP_TIMEOUT_MS),
      })
      if (!response.ok) continue
      const html = await response.text()
      const [accountUrl] = extractExactLinkedInAccountsFromHtml(html)
      if (accountUrl) return accountUrl
    } catch {
      // Public lookup is best-effort; never block email discovery on it.
    }
  }

  return ''
}


function firstNameFromName(name: string, email: string): string {
  const first = name.split(/\s+/)[0]?.trim()
  if (first && /^[a-z][a-z'-]{1,24}$/i.test(first)) return first
  const prefix = email.split('@')[0]?.split(/[._-]/)[0] ?? ''
  if (prefix && /^[a-z][a-z'-]{1,24}$/i.test(prefix)) {
    const generic = new Set(['hello', 'info', 'contact', 'sales', 'team', 'admin', 'support'])
    if (!generic.has(prefix.toLowerCase())) return prefix.replace(/\b\w/g, (letter) => letter.toUpperCase())
  }
  return 'there'
}

function contactCustom(contact: Contact): Record<string, unknown> {
  return contact.custom_fields ?? {}
}

function pickCustom(custom: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = asString(custom[key])
    if (value) return value
  }
  return ''
}

function contactToLead(contact: Contact): SovereignCopyLead {
  const custom = contactCustom(contact)
  return {
    first_name: firstNameFromName(contact.name ?? '', contact.email),
    company: contact.company,
    companyDomain: contact.company_domain,
    title: contact.title,
    source: contact.source,
    reason_to_contact: pickCustom(custom, 'reason_to_contact', 'research_summary', 'hunter_decision_summary'),
    offer_type: pickCustom(custom, 'offer_type', 'sovereign_offer_type'),
    customFields: { ...custom, email: contact.email, company_domain: contact.company_domain },
  }
}

function offerLabel(offerType: SovereignOfferType): string {
  return offerType === 'agency' ? '£160,000 White-label' : '£40,000 Internal'
}

function linkedinUrlForContact(contact: Contact): string {
  const custom = contactCustom(contact)
  const raw = pickCustom(
    custom,
    'linkedin_url',
    'linkedin',
    'linkedin_profile',
    'person_linkedin_url',
    'company_linkedin_url',
    'profile_url'
  )
  const url = safeUrl(raw)
  return url && isExactLinkedInAccountUrl(url) ? url : ''
}

function websiteForContact(contact: Contact): string {
  const custom = contactCustom(contact)
  const explicit = pickCustom(custom, 'website_url', 'website', 'source_url', 'company_url')
  if (explicit && !isLinkedInUrl(explicit)) return safeUrl(explicit)
  if (contact.company_domain) return safeUrl(contact.company_domain)
  const evidence = pickCustom(custom, 'public_evidence_url', 'research_evidence_url', 'hunter_source_proof_url')
  return evidence && !isLinkedInUrl(evidence) ? safeUrl(evidence) : ''
}

function evidenceForContact(contact: Contact): string {
  const custom = contactCustom(contact)
  return pickCustom(custom, 'public_evidence_url', 'research_evidence_url', 'hunter_source_proof_url', 'source_url')
}

function closingReason(contact: Contact, offerType: SovereignOfferType, closeScore: number): string {
  const custom = contactCustom(contact)
  const sourceReason = pickCustom(custom, 'hunter_decision_summary', 'reason_to_contact', 'research_summary')
  if (sourceReason) return sourceReason
  if (offerType === 'agency') return `White-label fit. Ranked ${closeScore}/100 because agency, RevOps, growth, or client-service signals are stronger.`
  return `Internal fit. Ranked ${closeScore}/100 because the contact looks closer to an operator or founder buying for their own team.`
}

function buildLinkedInDmText(lead: SovereignCopyLead, offerType: SovereignOfferType): string {
  const decision = buildSovereignCopyDecision({ ...lead, offer_type: offerType })
  const firstName = asString(lead.first_name ?? lead.firstName, 'there')
  const bookingUrl = sovereignBookingUrl()

  if (offerType === 'agency') {
    return [
      `Hi ${firstName}, I came across ${asString(lead.company, 'your team')} while looking at agencies/RevOps teams that could package communication operations for clients.`,
      'Xavira Control Stack gives a white-label layer for sender health, delivery proof, suppression, follow-ups, and AI governance.',
      `${decision.cta} ${bookingUrl}`,
    ].join('\n\n')
  }

  return [
    `Hi ${firstName}, I came across ${asString(lead.company, 'your team')} while looking at teams where outbound quality, AI governance, and operational proof matter before the demo.`,
    'Xavira Control Stack gives operators one governed layer for sender health, queue discipline, suppression, follow-ups, delivery proof, and AI governance.',
    `${decision.cta} ${bookingUrl}`,
  ].join('\n\n')
}

function buildLinkedInFollowUpText(lead: SovereignCopyLead, offerType: SovereignOfferType): string {
  const company = asString(lead.company, 'your team')
  if (offerType === 'agency') {
    return `Quick follow-up. The reason I thought of ${company}: agencies usually win campaigns on execution, but client trust is protected by the infrastructure layer behind the campaign. Worth comparing if a white-label control stack fits?`
  }
  return `Quick follow-up. I am not sure if communication infrastructure or AI governance is a priority for ${company} right now. Worth a short compare, or should I close the loop?`
}

function buildEmailText(lead: SovereignCopyLead, offerType: SovereignOfferType): { subject: string; text: string } {
  const input = { ...lead, offer_type: offerType }
  return {
    subject: sovereignSubjectForLead(input),
    text: renderSovereignTemplate(
      sovereignBodyForLead(input),
      input,
      process.env.SENDER_PHYSICAL_ADDRESS || 'Xavira Tech Labs, India'
    ),
  }
}

function closeScoreForContact(contact: Contact): number {
  const custom = contactCustom(contact)
  const lead = contactToLead(contact)
  const offerType = inferSovereignOfferType(lead)
  let score = sovereignClientIntentScore(lead)

  if (offerType === 'agency') score += 8
  score += targetMarketScoreBonus(contact.email, contact.company_domain, contact.company, contact.title, contact.source, custom)
  if (linkedinUrlForContact(contact)) score += 5
  if (websiteForContact(contact)) score += 3
  if (evidenceForContact(contact)) score += 4
  if (asString(contact.title).match(/founder|ceo|owner|partner|revenue|growth|sales|gtm/i)) score += 6
  if (asString(custom.linkedin_dm_status) === 'interested') score += 15
  if (asString(custom.linkedin_dm_status) === 'skipped') score -= 25
  if (asString(custom.send_status) === 'blocked') score -= 30

  return Math.max(0, Math.min(100, Math.round(score)))
}

export function dailyLinkedInDmTarget(): number {
  const raw = Number(process.env.LINKEDIN_DM_DAILY_TARGET ?? DEFAULT_DAILY_DM_TARGET)
  if (!Number.isFinite(raw)) return DEFAULT_DAILY_DM_TARGET
  return Math.max(MINIMUM_DAILY_DM_TARGET, Math.min(100, Math.trunc(raw)))
}

export function contactToLinkedInDeskAccount(contact: Contact): LinkedInDeskAccount {
  const lead = contactToLead(contact)
  const offerType = inferSovereignOfferType(lead)
  const closeScore = closeScoreForContact(contact)
  const emailCopy = buildEmailText(lead, offerType)
  const custom = contactCustom(contact)
  const name = contact.name ?? ''
  const company = contact.company ?? companyFromDomain(contact.company_domain ?? contact.email.split('@')[1] ?? '')
  const title = contact.title ?? ''
  const firstName = firstNameFromName(name, contact.email)

  return {
    id: Number(contact.id),
    email: contact.email,
    name,
    firstName,
    company,
    title,
    source: contact.source ?? '',
    status: contact.status,
    offerType,
    offerLabel: offerLabel(offerType),
    dealValueGbp: sovereignDealValueGbp(lead),
    closeScore,
    linkedinUrl: linkedinUrlForContact(contact),
    websiteUrl: websiteForContact(contact),
    evidenceUrl: evidenceForContact(contact),
    dmStatus: asString(custom.linkedin_dm_status, 'new'),
    lastDmDate: asString(custom.linkedin_dm_last_sent_date),
    dmText: buildLinkedInDmText({ ...lead, first_name: firstName, company }, offerType),
    followUpText: buildLinkedInFollowUpText({ ...lead, first_name: firstName, company }, offerType),
    emailSubject: emailCopy.subject,
    emailText: emailCopy.text,
    reason: closingReason(contact, offerType, closeScore),
  }
}

export function buildLinkedInDeskQueue(
  contacts: Contact[],
  dailyTarget = dailyLinkedInDmTarget()
): { queue: LinkedInDeskAccount[]; summary: LinkedInDeskSummary } {
  const candidates = contacts
    .filter((contact) => contact.status === 'active')
    .filter((contact) =>
      isTargetPayingMarketLead({
        email: contact.email,
        domain: contact.company_domain,
        company: contact.company,
        title: contact.title,
        source: contact.source,
        customFields: contact.custom_fields,
      })
    )
    .map(contactToLinkedInDeskAccount)
    .filter((account) => account.dmStatus !== 'blocked')
    .filter((account) => Boolean(account.linkedinUrl))

  const queue = candidates
    .sort((a, b) => b.closeScore - a.closeScore || b.dealValueGbp - a.dealValueGbp)
    .slice(0, dailyTarget)

  const agencyCount = queue.filter((account) => account.offerType === 'agency').length
  const directCount = queue.filter((account) => account.offerType === 'direct').length
  const topMotion =
    agencyCount >= Math.ceil(queue.length * 0.55)
      ? 'white_label_first'
      : directCount >= Math.ceil(queue.length * 0.55)
        ? 'internal_first'
        : 'balanced'

  return {
    queue,
    summary: {
      dailyTarget,
      minimumDailyTarget: MINIMUM_DAILY_DM_TARGET,
      queueCount: queue.length,
      shortfall: Math.max(0, dailyTarget - queue.length),
      agencyCount,
      directCount,
      availableCount: candidates.length,
      topMotion,
      topMotionLabel:
        topMotion === 'white_label_first'
          ? 'Highest expected value: push £160k white-label first'
          : topMotion === 'internal_first'
            ? 'Fastest close path today: push £40k internal first'
            : 'Balanced close motion: work both offers today',
    },
  }
}

function decodeEmailText(value: string): string {
  return value
    .replace(/&#64;|&commat;/gi, '@')
    .replace(/\s*\[\s*at\s*\]\s*|\s*\(\s*at\s*\)\s*/gi, '@')
    .replace(/\s*\[\s*dot\s*\]\s*|\s*\(\s*dot\s*\)\s*/gi, '.')
    .replace(/&amp;/gi, '&')
}

function cleanEmail(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^mailto:/, '')
    .replace(/[)\].,;:'"<>\s]+$/g, '')
    .replace(/^[\s("'<>]+/g, '')
}

function isUsableBusinessEmail(email: string): boolean {
  const validation = validateBusinessEmailSyntax(email)
  if (!validation.valid) return false

  const [local, domain] = validation.normalized.split('@')
  if (!local || !domain) return false
  if (PERSONAL_EMAIL_DOMAINS.has(domain)) return false
  if (/\.(png|jpg|jpeg|gif|webp|svg|css|js|ico|pdf)$/i.test(domain)) return false
  if (/(example|domain|test)\.(com|org|net)$/i.test(domain)) return false
  if (['noreply', 'no-reply', 'donotreply', 'do-not-reply', 'postmaster', 'abuse'].includes(local)) {
    return false
  }
  return true
}

function extractEmails(html: string, expectedDomain = ''): string[] {
  const decoded = decodeEmailText(html)
  const matches = decoded.match(EMAIL_RE) ?? []
  const emails = matches.map(cleanEmail).filter(isUsableBusinessEmail)
  const unique = Array.from(new Set(emails))
  const normalizedExpectedDomain = expectedDomain.toLowerCase().replace(/^www\./, '')
  return unique.sort((a, b) => {
    const aDomain = a.split('@')[1] ?? ''
    const bDomain = b.split('@')[1] ?? ''
    const aAligned = normalizedExpectedDomain && aDomain === normalizedExpectedDomain ? 1 : 0
    const bAligned = normalizedExpectedDomain && bDomain === normalizedExpectedDomain ? 1 : 0
    return bAligned - aAligned || emailRolePriority(a) - emailRolePriority(b)
  })
}

function emailRolePriority(email: string): number {
  const local = email.split('@')[0] ?? ''
  if (/^(founder|ceo|owner|partner|partners|partnerships|business|bd|growth|sales|hello|contact|team)$/i.test(local)) {
    return 0
  }
  if (/^(info|marketing|inquiries|inquiry)$/i.test(local)) return 1
  return 2
}

function targetUrls(baseUrl: string): string[] {
  const base = new URL(baseUrl)
  const urls = COMMON_PUBLIC_PATHS.map((path) => {
    const url = new URL(base.toString())
    url.pathname = path
    url.search = ''
    url.hash = ''
    return url.toString()
  })
  return Array.from(new Set(urls))
}

function resolvePublicLink(baseUrl: string, href: string): string {
  const trimmed = trimUrlNoise(href.replace(/&amp;/gi, '&'))
  if (!trimmed || trimmed.startsWith('#') || /^(mailto|tel|javascript):/i.test(trimmed)) return ''
  try {
    const base = new URL(baseUrl)
    const url = new URL(trimmed, base)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    if (url.hostname.replace(/^www\./i, '').toLowerCase() !== base.hostname.replace(/^www\./i, '').toLowerCase()) {
      return ''
    }
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

function extractHighValueLinks(baseUrl: string, html: string): string[] {
  const links = Array.from(html.matchAll(/href=["']([^"']+)["']/gi))
    .map((match) => resolvePublicLink(baseUrl, String(match[1] || '')))
    .filter((url) => url && HIGH_VALUE_LINK_RE.test(url))
    .slice(0, MAX_DISCOVERED_LINKS_PER_SOURCE)
  return Array.from(new Set(links))
}

function extractSitemapUrls(baseUrl: string, sitemap: string): string[] {
  const explicit = Array.from(sitemap.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi))
    .map((match) => resolvePublicLink(baseUrl, String(match[1] || '')))
  const loose = Array.from(sitemap.matchAll(/https?:\/\/[^\s<>"']+/gi))
    .map((match) => resolvePublicLink(baseUrl, String(match[0] || '')))
  return Array.from(new Set([...explicit, ...loose].filter((url) => url && HIGH_VALUE_LINK_RE.test(url)))).slice(
    0,
    MAX_PUBLIC_PAGES_PER_TARGET
  )
}

function extractPhoneNumbers(text: string): string[] {
  const decoded = decodeEmailText(text)
  const matches = decoded.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,5}\d{2,4}/g) ?? []
  return Array.from(
    new Set(
      matches
        .map((value) => normalizeWhitespace(value))
        .filter((value) => value.replace(/\D/g, '').length >= 8)
        .slice(0, 5)
    )
  )
}

function publicSignalsFromHtml(html: string): string[] {
  return PUBLIC_SIGNAL_PATTERNS
    .filter(([pattern]) => pattern.test(html))
    .map(([, signal]) => signal)
}

function summarizeEvidence(input: {
  company: string
  domain: string
  sourceUrl: string
  publicSignals: string[]
  email: string
  discoveredPages: number
}): string {
  const role = contactRoleFromEmail(input.email)
  const signals = input.publicSignals.slice(0, 3).join(', ') || 'public business evidence'
  return `${input.company} (${input.domain}) exposed ${role} on public pages. Signals: ${signals}. Checked ${input.discoveredPages} public pages; strongest proof: ${input.sourceUrl}.`
}

function contactRoleFromEmail(email: string): string {
  const local = email.split('@')[0] ?? ''
  if (/founder|ceo|owner/i.test(local)) return 'founder/operator mailbox'
  if (/partner|bd|business/i.test(local)) return 'partnership/business mailbox'
  if (/sales|growth|revenue/i.test(local)) return 'sales/growth mailbox'
  if (/hello|team|contact|info/i.test(local)) return 'company contact mailbox'
  return 'business mailbox'
}

function confidenceForScrape(input: {
  email: string
  targetDomain: string
  sourceUrl: string
  publicSignals: string[]
}): 'high' | 'medium' | 'low' {
  const emailDomain = input.email.split('@')[1] ?? ''
  const aligned = emailDomain === input.targetDomain
  const highValuePage = HIGH_VALUE_LINK_RE.test(input.sourceUrl)
  if (aligned && highValuePage && input.publicSignals.length > 0) return 'high'
  if (aligned || input.publicSignals.length > 1) return 'medium'
  return 'low'
}

async function collectPublicEvidenceUrls(baseUrl: string): Promise<string[]> {
  const seeds = targetUrls(baseUrl)
  const discovered = new Set<string>(seeds)

  for (const sitemapPath of SITEMAP_PATHS) {
    const sitemapUrl = new URL(baseUrl)
    sitemapUrl.pathname = sitemapPath
    sitemapUrl.search = ''
    sitemapUrl.hash = ''
    const sitemap = await fetchText(sitemapUrl.toString())
    for (const url of extractSitemapUrls(baseUrl, sitemap)) discovered.add(url)
  }

  const home = await fetchText(baseUrl)
  for (const url of extractHighValueLinks(baseUrl, home)) discovered.add(url)

  return Array.from(discovered).slice(0, MAX_PUBLIC_PAGES_PER_TARGET)
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1',
        'user-agent': 'SovereignEngine/1.0 public email evidence fetcher',
      },
    })
    if (!response.ok) return ''
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType && !/text|html|xml|json/i.test(contentType)) return ''
    const text = await response.text()
    return text.slice(0, MAX_FETCH_BYTES)
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}

export function parsePublicEmailTargets(input: string): PublicEmailScrapeResponse {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_SCRAPE_TARGETS)
  const targets: PublicEmailScrapeTarget[] = []
  const rejected: Array<{ raw: string; reason: string }> = []
  const seen = new Set<string>()

  for (const raw of lines) {
    const linkedinUrl = safeUrl((raw.match(LINKEDIN_URL_RE) ?? [])[0] ?? '')
    const exactLinkedinUrl = normalizeExactLinkedInAccountUrl(linkedinUrl)
    const urls = raw.match(URL_RE) ?? []
    const websiteUrl = urls
      .map(safeUrl)
      .find((url) => url && !isLinkedInUrl(url))

    if (!websiteUrl) {
      rejected.push({ raw, reason: exactLinkedinUrl ? 'linkedin_only_needs_public_company_site' : 'no_public_website_url_or_exact_linkedin_account' })
      continue
    }
    const domain = hostDomain(websiteUrl)
    if (
      !isTargetPayingMarketLead({
        domain,
        company: raw,
        source: raw,
        customFields: { website_url: websiteUrl, linkedin_url: exactLinkedinUrl },
      })
    ) {
      rejected.push({ raw, reason: 'not_target_paying_market_or_india_signal' })
      continue
    }
    if (!domain || seen.has(domain)) continue
    seen.add(domain)
    targets.push({
      raw,
      websiteUrl,
      linkedinUrl: exactLinkedinUrl,
      domain,
      company: companyFromDomain(domain),
    })
  }

  return { targets, found: [], rejected }
}

export async function scrapePublicBusinessEmails(
  input: string,
  offerMode: LinkedInOfferMode = 'auto'
): Promise<PublicEmailScrapeResponse> {
  const parsed = parsePublicEmailTargets(input)
  const found: PublicEmailScrapeResult[] = []
  const seenEmails = new Set<string>()

  for (const target of parsed.targets) {
    const exactLinkedinUrl =
      target.linkedinUrl || (await findExactLinkedInAccountUrl({ company: target.company, domain: target.domain }))
    if (!exactLinkedinUrl) {
      parsed.rejected.push({ raw: target.raw, reason: 'missing_exact_linkedin_account_url' })
      continue
    }

    const evidenceUrls = await collectPublicEvidenceUrls(target.websiteUrl)
    const targetSignals = new Set<string>()
    const targetPhones = new Set<string>()

    for (const url of evidenceUrls) {
      const html = await fetchText(url)
      if (!html) continue
      publicSignalsFromHtml(html).forEach((signal) => targetSignals.add(signal))
      extractPhoneNumbers(html).forEach((phone) => targetPhones.add(phone))

      for (const email of extractEmails(html, target.domain)) {
        if (seenEmails.has(email)) continue
        if ((email.split('@')[1] ?? '') !== target.domain) continue
        seenEmails.add(email)
        const publicSignals = Array.from(targetSignals)
        const offerType =
          offerMode === 'auto'
            ? inferSovereignOfferType({
                company: target.company,
                companyDomain: target.domain,
                source: target.raw,
                customFields: {
                  source_url: target.websiteUrl,
                  linkedin_url: exactLinkedinUrl,
                  public_signals: publicSignals,
                },
              })
            : offerMode
        found.push({
          email,
          domain: email.split('@')[1] ?? target.domain,
          company: target.company,
          sourceUrl: url,
          linkedinUrl: exactLinkedinUrl,
          offerType,
          confidence: confidenceForScrape({
            email,
            targetDomain: target.domain,
            sourceUrl: url,
            publicSignals,
          }),
          contactRole: contactRoleFromEmail(email),
          evidenceSummary: summarizeEvidence({
            company: target.company,
            domain: target.domain,
            sourceUrl: url,
            publicSignals,
            email,
            discoveredPages: evidenceUrls.length,
          }),
          publicSignals,
          phoneNumbers: Array.from(targetPhones).slice(0, 5),
          discoveredPages: evidenceUrls.length,
        })
        if (found.filter((result) => result.domain === target.domain).length >= MAX_EMAILS_PER_TARGET) break
      }
      if (found.filter((result) => result.domain === target.domain).length >= MAX_EMAILS_PER_TARGET) break
    }
  }

  return { ...parsed, found }
}
