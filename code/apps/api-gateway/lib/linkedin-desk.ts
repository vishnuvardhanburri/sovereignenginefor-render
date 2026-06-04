import type { Contact } from '@/lib/db/types'
import { validateBusinessEmailSyntax } from '@/lib/email-address'
import {
  balanceSovereignOfferMix,
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

export type LinkedInOfferMode = 'auto' | SovereignOfferType

export type LinkedInDeskLead = {
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
  linkedinSearchUrl: string
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
}

export type PublicEmailScrapeResponse = {
  targets: PublicEmailScrapeTarget[]
  found: PublicEmailScrapeResult[]
  rejected: Array<{ raw: string; reason: string }>
}

const LINKEDIN_URL_RE = /https?:\/\/(?:[\w-]+\.)?linkedin\.com\/[^\s),]+/gi
const URL_RE = /https?:\/\/[^\s),]+|(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?:\/[^\s),]*)?/gi
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const COMMON_PUBLIC_PATHS = ['', '/', '/contact', '/contact-us', '/about', '/about-us', '/team', '/people', '/leadership']
const MINIMUM_DAILY_DM_TARGET = 20
const DEFAULT_DAILY_DM_TARGET = 24
const MAX_SCRAPE_TARGETS = 60
const MAX_EMAILS_PER_TARGET = 12
const MAX_FETCH_BYTES = 500_000
const SCRAPE_TIMEOUT_MS = 4500

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
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
  return pickCustom(
    custom,
    'linkedin_url',
    'linkedin',
    'linkedin_profile',
    'person_linkedin_url',
    'company_linkedin_url',
    'profile_url'
  )
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

function linkedinSearchUrl(name: string, company: string, title: string): string {
  const keywords = normalizeWhitespace([name, title, company].filter(Boolean).join(' '))
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords || company || name || 'founder')}`
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

export function contactToLinkedInDeskLead(contact: Contact): LinkedInDeskLead {
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
    linkedinSearchUrl: linkedinSearchUrl(name, company, title),
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
): { queue: LinkedInDeskLead[]; summary: LinkedInDeskSummary } {
  const candidates = contacts
    .filter((contact) => contact.status === 'active')
    .map((contact) => ({ contact, lead: contactToLead(contact) }))
    .filter(({ contact }) => asString(contactCustom(contact).linkedin_dm_status) !== 'blocked')

  const selectedContacts = balanceSovereignOfferMix(
    candidates.map(({ contact, lead }) => ({ ...lead, contact })),
    dailyTarget,
    {
      allowRemainderFill: true,
      preferredOfferType: 'agency',
      preferredSlots: Math.ceil(dailyTarget * 0.6),
    }
  ).map((candidate) => candidate.contact)

  const queue = selectedContacts
    .map(contactToLinkedInDeskLead)
    .sort((a, b) => b.closeScore - a.closeScore || b.dealValueGbp - a.dealValueGbp)
    .slice(0, dailyTarget)

  const agencyCount = queue.filter((lead) => lead.offerType === 'agency').length
  const directCount = queue.filter((lead) => lead.offerType === 'direct').length
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
  if (/\.(png|jpg|jpeg|gif|webp|svg|css|js|ico|pdf)$/i.test(domain)) return false
  if (/(example|domain|test)\.(com|org|net)$/i.test(domain)) return false
  if (['noreply', 'no-reply', 'donotreply', 'do-not-reply', 'postmaster', 'abuse'].includes(local)) {
    return false
  }
  return true
}

function extractEmails(html: string): string[] {
  const decoded = decodeEmailText(html)
  const matches = decoded.match(EMAIL_RE) ?? []
  const emails = matches.map(cleanEmail).filter(isUsableBusinessEmail)
  return Array.from(new Set(emails))
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
    const urls = raw.match(URL_RE) ?? []
    const websiteUrl = urls
      .map(safeUrl)
      .find((url) => url && !isLinkedInUrl(url))

    if (!websiteUrl) {
      rejected.push({ raw, reason: linkedinUrl ? 'linkedin_only_needs_public_company_site' : 'no_public_website_url' })
      continue
    }

    const domain = hostDomain(websiteUrl)
    if (!domain || seen.has(domain)) continue
    seen.add(domain)
    targets.push({
      raw,
      websiteUrl,
      linkedinUrl,
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
    for (const url of targetUrls(target.websiteUrl)) {
      const html = await fetchText(url)
      if (!html) continue

      for (const email of extractEmails(html)) {
        if (seenEmails.has(email)) continue
        seenEmails.add(email)
        const offerType =
          offerMode === 'auto'
            ? inferSovereignOfferType({
                company: target.company,
                companyDomain: target.domain,
                source: target.raw,
                customFields: { source_url: target.websiteUrl, linkedin_url: target.linkedinUrl },
              })
            : offerMode
        found.push({
          email,
          domain: email.split('@')[1] ?? target.domain,
          company: target.company,
          sourceUrl: url,
          linkedinUrl: target.linkedinUrl,
          offerType,
        })
        if (found.filter((result) => result.domain === target.domain).length >= MAX_EMAILS_PER_TARGET) break
      }
      if (found.filter((result) => result.domain === target.domain).length >= MAX_EMAILS_PER_TARGET) break
    }
  }

  return { ...parsed, found }
}
