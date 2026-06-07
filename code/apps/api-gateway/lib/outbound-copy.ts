import { tryOpenRouterJson } from '@/lib/ai/openrouter'
import { appEnv } from '@/lib/env'
import { buildSalesBrainContext } from '@/lib/sales-brain'
import { commercialDealValueGbp } from '@/lib/commercial-model'

export type SovereignOfferType = 'direct' | 'agency'

export type SovereignCopyLead = {
  first_name?: string | null
  firstName?: string | null
  company?: string | null
  companyDomain?: string | null
  title?: string | null
  source?: string | null
  reason_to_contact?: string | null
  reasonToContact?: string | null
  offer_type?: string | null
  offerType?: string | null
  customFields?: Record<string, unknown> | null
}

export const SOVEREIGN_STACK_DIRECT_SUBJECT =
  'quick question about outbound infrastructure'

export const SOVEREIGN_STACK_AGENCY_SUBJECT =
  'white-label communication infrastructure'

export const SOVEREIGN_DEFAULT_BOOKING_URL =
  'https://sovereignenginefor-render-d80m.onrender.com/book'
export const SOVEREIGN_CLIENT_GENERATION_TARGET = {
  dailyQualifiedConversationsMin: 1,
  dailyQualifiedConversationsMax: 2,
  operatingSendFloor: 125,
  operatingSendCeiling: 199,
  idealAgencySharePct: 50,
} as const

function allowedBookingDomains(): string[] {
  const raw =
    process.env.SOVEREIGN_ALLOWED_BOOKING_DOMAINS ||
    'sovereignenginefor-render-d80m.onrender.com,vishnuvardhanburri.in,www.vishnuvardhanburri.in'
  return raw
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean)
}

function isAllowedBookingHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return allowedBookingDomains().some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`)
  )
}

export function sovereignBookingUrl(): string {
  const raw =
    process.env.SOVEREIGN_BOOKING_URL ||
    process.env.OUTBOUND_BOOKING_URL ||
    process.env.NEXT_PUBLIC_SOVEREIGN_BOOKING_URL ||
    SOVEREIGN_DEFAULT_BOOKING_URL
  const trimmed = raw.trim()
  if (!trimmed) return SOVEREIGN_DEFAULT_BOOKING_URL

  try {
    const url = new URL(trimmed)
    if (url.protocol === 'https:' && isAllowedBookingHost(url.hostname)) return url.toString()
  } catch {
    return SOVEREIGN_DEFAULT_BOOKING_URL
  }

  return SOVEREIGN_DEFAULT_BOOKING_URL
}

export const SOVEREIGN_BOOKING_URL = SOVEREIGN_DEFAULT_BOOKING_URL

export function sovereignBookingCtaText(): string {
  return `If this is active on your side, the fastest next step is a short walkthrough: ${sovereignBookingUrl()}`
}

export function withSovereignBookingCta(body: string): string {
  let trimmed = body.trim()
  if (!trimmed) return trimmed

  const bookingUrl = sovereignBookingUrl()
  trimmed = trimmed
    .replace(/https?:\/\/cal\.com\/vishnuvardhanburri\/30min\/?/gi, bookingUrl)
    .replace(/https?:\/\/(?:www\.)?vishnulabs\.com\/book\/?/gi, bookingUrl)
    .replace(/https?:\/\/(?:www\.)?vishnuvardhanburri\.in\/?(\s|$)/gi, (_match, suffix: string) =>
      `${bookingUrl}${suffix ?? ''}`
    )

  if (trimmed.includes(bookingUrl)) return trimmed

  const cta = sovereignBookingCtaText()
  const optOutMatch = trimmed.match(
    /\n\nIf this (?:is not|isn't) relevant, (?:just )?reply "no" and I (?:will not|won't) follow up\.$/i
  )
  if (optOutMatch?.index !== undefined) {
    return `${trimmed.slice(0, optOutMatch.index).trim()}\n\n${cta}${trimmed.slice(
      optOutMatch.index
    )}`
  }

  return `${trimmed}\n\n${cta}`
}

export type SovereignRenderedCopy = {
  subject: string
  text: string
  html: string
  source: 'template' | 'openrouter'
  error?: string
}

type LeadResearchContext = {
  evidenceUrl?: string
  linkedinUrl?: string
  linkedinPostUrl?: string
  socialSignal?: string
  competitorSignal?: string
  researchSummary?: string
}

export type SovereignBuyerIndustry =
  | 'agency'
  | 'revops'
  | 'cybersecurity'
  | 'ai'
  | 'devtools'
  | 'saas'
  | 'compliance'
  | 'enterprise'
  | 'default'

export type SovereignBuyerPersona =
  | 'founder'
  | 'revenue'
  | 'partnerships'
  | 'technical'
  | 'security'
  | 'operations'
  | 'generic'

export type SovereignCopyDecision = {
  offerType: SovereignOfferType
  industry: SovereignBuyerIndustry
  persona: SovereignBuyerPersona
  subject: string
  hook: string
  pain: string
  value: string
  cta: string
  followupObservation: string
  proof: string
}

export function inferSovereignOfferType(input: SovereignCopyLead): SovereignOfferType {
  const custom = input.customFields ?? {}
  const explicit = String(
    input.offer_type ?? input.offerType ?? custom.offer_type ?? custom.offerType ?? ''
  ).toLowerCase()
  if (explicit === 'agency' || explicit === 'agency_master') return 'agency'
  if (explicit === 'direct') return 'direct'

  const text = [
    input.company,
    input.companyDomain,
    input.title,
    input.source,
    input.reason_to_contact,
    input.reasonToContact,
    custom.industry,
    custom.segment,
    custom.persona,
  ]
    .map((value) => String(value ?? '').toLowerCase())
    .join(' ')

  if (
    /\bagency\b|\bagencies\b|lead generation|lead-gen|outbound agency|outbound operator|appointment setting|sales development|sdr as a service|revops|revenue operations|demand generation|demand gen|go-to-market|gtm|marketing agency|performance marketing|digital marketing|growth marketing|seo agency|paid acquisition/.test(
      text
    )
  ) {
    return 'agency'
  }

  return 'direct'
}

function numericFitScore(input: SovereignCopyLead): number {
  const custom = input.customFields ?? {}
  const parsed = Number(custom.fit_score ?? custom.fitScore ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function boundedScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function hasAnySignal(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

export function sovereignClientIntentScore(input: SovereignCopyLead): number {
  const custom = input.customFields ?? {}
  const offerType = inferSovereignOfferType(input)
  const email = String(custom.email ?? custom.recipient_email ?? '').toLowerCase()
  const prefix = email.includes('@') ? email.split('@')[0] ?? '' : ''
  const domain = String(input.companyDomain ?? custom.company_domain ?? custom.email_domain ?? '')
    .toLowerCase()
    .trim()
  const text = [
    input.company,
    input.companyDomain,
    input.title,
    input.source,
    input.reason_to_contact,
    input.reasonToContact,
    custom.industry,
    custom.segment,
    custom.persona,
    custom.research_summary,
    custom.public_evidence_url,
    custom.research_evidence_url,
    custom.social_signal,
    custom.competitor_signal,
  ]
    .map((value) => String(value ?? '').toLowerCase())
    .join(' ')

  let score = Math.min(Math.max(numericFitScore(input), 0), 100) * 0.62

  if (offerType === 'agency') score += 10
  if (custom.public_evidence_url || custom.research_evidence_url || custom.source_url) score += 8
  if (custom.linkedin_url || custom.linkedin_post_url || custom.recent_linkedin_post_url) score += 5
  if (custom.email_validation_verdict === 'valid' || custom.verification_status === 'valid') score += 6
  if (custom.auto_approval_eligible === true || custom.auto_approval_eligible === 'true') score += 4

  if (
    hasAnySignal(text, [
      /\boutbound\b/,
      /\blead[- ]?gen(?:eration)?\b/,
      /\bappointment setting\b/,
      /\bsdr\b/,
      /\brevops\b/,
      /\bdemand gen(?:eration)?\b/,
      /\bgrowth agency\b/,
      /\bdeliverability\b/,
      /\binbox placement\b/,
    ])
  ) {
    score += 14
  }

  if (
    hasAnySignal(text, [
      /\bfounder\b/,
      /\bceo\b/,
      /\bowner\b/,
      /\bpartner\b/,
      /\bhead of growth\b/,
      /\brevenue\b/,
      /\bgo[- ]?to[- ]?market\b/,
      /\bgtm\b/,
    ])
  ) {
    score += 10
  }

  if (
    hasAnySignal(text, [
      /\bai\b/,
      /\bsecurity\b/,
      /\bcybersecurity\b/,
      /\bcompliance\b/,
      /\bgovernance\b/,
      /\binfrastructure\b/,
      /\bdevtools\b/,
      /\bsaas\b/,
    ])
  ) {
    score += 7
  }

  if (
    [
      'founder',
      'ceo',
      'partner',
      'partnership',
      'partnerships',
      'business',
      'sales',
      'growth',
      'revenue',
    ].includes(prefix)
  ) {
    score += 5
  }

  if (['hello', 'info', 'contact', 'support', 'feedback', 'admin'].includes(prefix)) score -= 4
  if (/\.(edu|gov|gov\.[a-z]{2}|ac\.[a-z]{2})$/i.test(domain)) score -= 12
  if (looksLikeContentTitle(String(input.company ?? ''))) score -= 14
  if (/\b(article|tutorial|course|definition|news|blog)\b/.test(text)) score -= 8

  return boundedScore(score)
}

export function sovereignDealValueUsd(input: SovereignCopyLead): number {
  return commercialDealValueGbp(inferSovereignOfferType(input))
}

export const sovereignDealValueGbp = sovereignDealValueUsd

export function rankSovereignLeads<T extends SovereignCopyLead>(leads: T[]): T[] {
  return [...leads].sort((a, b) => {
    const clientIntentDelta =
      sovereignClientIntentScore(b) - sovereignClientIntentScore(a)
    if (clientIntentDelta !== 0) return clientIntentDelta

    const valueDelta = sovereignDealValueUsd(b) - sovereignDealValueUsd(a)
    if (valueDelta !== 0) return valueDelta

    const fitDelta = numericFitScore(b) - numericFitScore(a)
    if (fitDelta !== 0) return fitDelta

    return String(a.company ?? a.companyDomain ?? '').localeCompare(
      String(b.company ?? b.companyDomain ?? '')
    )
  })
}

export function balanceSovereignOfferMix<T extends SovereignCopyLead>(
  leads: T[],
  limit: number,
  options: {
    allowRemainderFill?: boolean
    preferredOfferType?: 'agency' | 'direct'
    preferredSlots?: number
  } = {}
): T[] {
  const normalizedLimit = Math.max(0, Math.trunc(limit))
  if (normalizedLimit <= 0) return []

  const ranked = rankSovereignLeads(leads)
  const agency = ranked.filter((lead) => inferSovereignOfferType(lead) === 'agency')
  const direct = ranked.filter((lead) => inferSovereignOfferType(lead) === 'direct')
  const preferredSlots = Math.max(0, Math.trunc(options.preferredSlots ?? 0))
  if (options.preferredOfferType && preferredSlots > 0) {
    const preferred = options.preferredOfferType === 'agency' ? agency : direct
    const opposite = options.preferredOfferType === 'agency' ? direct : agency
    const selected = preferred.slice(0, Math.min(normalizedLimit, preferredSlots, preferred.length))
    const selectedSet = new Set(selected)
    const remainingLimit = normalizedLimit - selected.length
    if (remainingLimit <= 0) return selected

    const repairRemainder = balanceSovereignOfferMix(
      [...opposite, ...preferred.filter((lead) => !selectedSet.has(lead))],
      remainingLimit,
      { allowRemainderFill: options.allowRemainderFill }
    )
    return [...selected, ...repairRemainder].slice(0, normalizedLimit)
  }

  const pairSlots = Math.floor(normalizedLimit / 2)
  const balancedPairs = options.allowRemainderFill
    ? pairSlots
    : Math.min(pairSlots, agency.length, direct.length)
  const targetAgency = options.allowRemainderFill
    ? Math.ceil(normalizedLimit / 2)
    : balancedPairs
  const targetDirect = options.allowRemainderFill
    ? normalizedLimit - targetAgency
    : balancedPairs
  const selected: T[] = []
  const agencySlice = agency.slice(0, targetAgency)
  const directSlice = direct.slice(0, targetDirect)
  const maxPairs = Math.max(agencySlice.length, directSlice.length)
  for (let index = 0; index < maxPairs; index += 1) {
    if (agencySlice[index]) selected.push(agencySlice[index])
    if (directSlice[index]) selected.push(directSlice[index])
  }
  const selectedSet = new Set(selected)
  const remainder = ranked.filter((lead) => !selectedSet.has(lead))

  if (!options.allowRemainderFill) {
    return selected.slice(0, normalizedLimit)
  }

  return [...selected, ...remainder.slice(0, normalizedLimit - selected.length)]
}

export function buildLeadResearchContext(lead: SovereignCopyLead): LeadResearchContext {
  const custom = lead.customFields ?? {}
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = String(custom[key] ?? '').trim()
      if (value) return value.slice(0, 320)
    }
    return undefined
  }

  return {
    evidenceUrl: pick('research_evidence_url', 'public_evidence_url', 'source_url'),
    linkedinUrl: pick('linkedin_url', 'linkedin', 'linkedinUrl'),
    linkedinPostUrl: pick('linkedin_post_url', 'recent_linkedin_post_url', 'linkedinPostUrl'),
    socialSignal: pick('social_signal', 'recent_social_signal', 'social_context'),
    competitorSignal: pick('competitor_signal', 'competitor_context', 'category_signal'),
    researchSummary: pick('research_summary', 'reason_to_contact', 'why_now'),
  }
}

function leadTextForCopyAgent(lead: SovereignCopyLead): string {
  const custom = lead.customFields ?? {}
  return [
    lead.company,
    lead.companyDomain,
    lead.title,
    lead.source,
    lead.reason_to_contact,
    lead.reasonToContact,
    custom.industry,
    custom.segment,
    custom.persona,
    custom.research_summary,
    custom.public_evidence_url,
    custom.research_evidence_url,
    custom.social_signal,
    custom.category_signal,
    custom.competitor_signal,
    custom.source_url,
    custom.linkedin_url,
  ]
    .map((value) => String(value ?? '').toLowerCase())
    .join(' ')
}

export function detectSovereignBuyerIndustry(lead: SovereignCopyLead): SovereignBuyerIndustry {
  const text = leadTextForCopyAgent(lead)
  const offerType = inferSovereignOfferType(lead)
  if (
    offerType === 'agency' ||
    /\bagency\b|\bagencies\b|lead[- ]?gen|outbound agency|appointment setting|demand gen|growth marketing|performance marketing|client acquisition/.test(
      text
    )
  ) {
    if (/\brevops\b|revenue operations|pipeline operations|gtm ops|go[- ]?to[- ]?market operations/.test(text)) {
      return 'revops'
    }
    return 'agency'
  }
  if (/\bcyber\b|cybersecurity|security operations|\bsoc\b|mssp|zero trust|endpoint security|incident response/.test(text)) {
    return 'cybersecurity'
  }
  if (/\bcompliance\b|governance|privacy|gdpr|dpdp|audit|risk management|trust center/.test(text)) {
    return 'compliance'
  }
  if (/\bai\b|llm|machine learning|generative|automation|agentic|model governance/.test(text)) {
    return 'ai'
  }
  if (/\bdevtools\b|developer tools|api platform|infrastructure|platform engineering|github|sdk|observability/.test(text)) {
    return 'devtools'
  }
  if (/\bsaas\b|software|b2b|cloud platform|subscription/.test(text)) {
    return 'saas'
  }
  if (/\benterprise\b|procurement|large accounts|strategic accounts|mid-market/.test(text)) {
    return 'enterprise'
  }
  return 'default'
}

export function detectSovereignBuyerPersona(lead: SovereignCopyLead): SovereignBuyerPersona {
  const text = leadTextForCopyAgent(lead)
  if (/\bfounder\b|co[- ]?founder|\bceo\b|owner|managing partner|principal/.test(text)) return 'founder'
  if (/partnerships?|alliances?|channel|ecosystem/.test(text)) return 'partnerships'
  if (/revenue|growth|sales|gtm|go[- ]?to[- ]?market|demand gen|client acquisition|commercial/.test(text)) {
    return 'revenue'
  }
  if (/\bcto\b|engineering|platform|product|devops|developer|technical|architect/.test(text)) return 'technical'
  if (/security|compliance|risk|trust|governance|privacy/.test(text)) return 'security'
  if (/operations|revops|ops|delivery|customer success/.test(text)) return 'operations'
  return 'generic'
}

function subjectForCopyDecision(
  offerType: SovereignOfferType,
  industry: SovereignBuyerIndustry,
  persona: SovereignBuyerPersona
): string {
  if (offerType === 'agency') {
    if (persona === 'partnerships') return 'infrastructure partnership question'
    if (industry === 'revops') return 'pipeline operations layer'
    return SOVEREIGN_STACK_AGENCY_SUBJECT
  }
  if (industry === 'cybersecurity' || industry === 'compliance') return 'governance infrastructure question'
  if (industry === 'ai' || industry === 'devtools') return 'communication governance question'
  return SOVEREIGN_STACK_DIRECT_SUBJECT
}

function hookForCopyDecision(
  company: string,
  industry: SovereignBuyerIndustry,
  persona: SovereignBuyerPersona
): string {
  if (industry === 'agency') {
    return `I came across ${company} while researching agencies building serious outbound, RevOps, or client acquisition operations.`
  }
  if (industry === 'revops') {
    return `I came across ${company} while looking at teams responsible for pipeline quality and communication operations.`
  }
  if (industry === 'cybersecurity' || industry === 'compliance') {
    return `I came across ${company} while researching trust-heavy teams where outreach, AI governance, and operational proof have to be handled carefully.`
  }
  if (industry === 'ai' || industry === 'devtools') {
    return `I came across ${company} while researching technical teams selling into skeptical buyers where communication has to feel controlled, not automated.`
  }
  if (persona === 'founder') {
    return `I came across ${company} while looking at founder-led teams where outbound quality can quietly affect pipeline trust.`
  }
  return `I came across ${company} while researching teams that rely on outbound growth and operational communications.`
}

function painForCopyDecision(industry: SovereignBuyerIndustry): string {
  if (industry === 'agency') {
    return 'The expensive failure is not writing copy. It is client outreach landing in spam or promotions, domains getting burned, duplicate touches happening across operators, and no proof that sender capacity, suppression, and follow-ups are under control.'
  }
  if (industry === 'revops') {
    return 'Activity dashboards show volume, but the hidden damage is sender reputation, spam/promotions placement, suppression gaps, duplicate follow-ups, and qualified conversations leaking between tools.'
  }
  if (industry === 'cybersecurity' || industry === 'compliance') {
    return 'Trust-heavy buyers ignore outreach that feels uncontrolled. Spam placement, burned senders, messy suppression, weak audit trails, and leaked prospect context can kill a serious conversation before the demo.'
  }
  if (industry === 'ai' || industry === 'devtools') {
    return 'Strong technical products still lose buyers when outreach lands in spam, hits the same contact twice, or runs through inboxes and sheets without sender-capacity control, suppression, or audit proof.'
  }
  return 'The expensive problem usually shows up as silence: emails landing in spam or promotions, follow-ups slipping, duplicate touches, sender reputation damage, and sensitive outreach data spread across inboxes, sheets, CRM records, and assistants.'
}

function valueForCopyDecision(offerType: SovereignOfferType, industry: SovereignBuyerIndustry): string {
  if (offerType === 'agency') {
    return 'Xavira Control Stack is our proven control layer for agencies: domain protection, sender capacity, inbox-placement visibility, queue discipline, suppression governance, reply tracking, delivery proof, audit trails, and Xavira Shield for outreach data.'
  }
  if (industry === 'cybersecurity' || industry === 'compliance') {
    return 'Xavira Control Stack gives operators one governed layer for domain protection, sender capacity, inbox-placement visibility, suppression, follow-ups, delivery proof, audit trails, and Xavira Shield for communication data.'
  }
  return 'Xavira Control Stack gives operators one governed layer for domain protection, sender capacity, spam/promotions visibility, queue discipline, suppression, follow-up control, delivery proof, audit trails, and Xavira Shield for outreach data.'
}

function ctaForCopyDecision(
  company: string,
  industry: SovereignBuyerIndustry,
  persona: SovereignBuyerPersona
): string {
  if (industry === 'agency' || industry === 'revops' || persona === 'partnerships') {
    return `Is this already a client-delivery or white-label risk inside ${company}?`
  }
  if (persona === 'founder') {
    return 'Is domain burn, spam placement, missed follow-up, or outreach-data leakage a real risk for you right now?'
  }
  if (persona === 'technical' || persona === 'security') {
    return 'Is this communication-control layer something your team is actively trying to solve?'
  }
  return `Where does ${company} feel this communication-control problem most today?`
}

function followupObservationForCopyDecision(industry: SovereignBuyerIndustry): string {
  if (industry === 'agency') {
    return 'Most agencies focus on campaign execution, but the client trust gap usually sits behind it: sender capacity, domain protection, suppression, inbox placement, and proof.'
  }
  if (industry === 'revops') {
    return 'Most pipeline reports explain activity, but not whether sender health, spam/promotions placement, suppression, and follow-up governance are protecting qualified conversations.'
  }
  if (industry === 'cybersecurity' || industry === 'compliance') {
    return 'For trust-heavy buyers, the message is only one part of the risk; domain protection, suppression, auditability, and data shielding decide whether outreach feels safe.'
  }
  if (industry === 'ai' || industry === 'devtools') {
    return 'Technical buyers notice when outreach feels generic. The operating layer behind the message has to protect timing, sender reputation, suppression, proof, and trust.'
  }
  return 'Most teams focus on campaigns and sequences, but rarely have clean visibility into the operational layer behind outreach: sender reputation, spam placement, suppression, follow-ups, and data exposure.'
}

export function buildSovereignCopyDecision(lead: SovereignCopyLead): SovereignCopyDecision {
  const company = safeCompanyName(lead)
  const offerType = inferSovereignOfferType(lead)
  const industry = detectSovereignBuyerIndustry(lead)
  const persona = detectSovereignBuyerPersona(lead)

  return {
    offerType,
    industry,
    persona,
    subject: subjectForCopyDecision(offerType, industry, persona),
    hook: hookForCopyDecision(company, industry, persona),
    pain: painForCopyDecision(industry),
    value: valueForCopyDecision(offerType, industry),
    cta: ctaForCopyDecision(company, industry, persona),
    followupObservation: followupObservationForCopyDecision(industry),
    proof: buildSovereignPainLine(lead),
  }
}

export function sovereignDirectEmail1Body(): string {
  return `Hi {{FirstName}},

{{agent_hook}}

{{agent_pain}}

{{agent_value}}

{{agent_cta}}

Best,
Vishnu
Founder
Xavira Tech Labs

{{physical_address}}

If this isn't relevant, just reply "no" and I won't follow up.`
}

export function sovereignAgencyEmail1Body(): string {
  return `Hi {{FirstName}},

{{agent_hook}}

{{agent_pain}}

{{agent_value}}

{{agent_cta}}

Best,
Vishnu
Founder
Xavira Tech Labs

{{physical_address}}

If this isn't relevant, just reply "no" and I won't follow up.`
}

export const SOVEREIGN_STACK_DIRECT_SEQUENCE_STEPS = [
  {
    id: 'sovereign-stack-step-1',
    day: 0,
    subject: SOVEREIGN_STACK_DIRECT_SUBJECT,
    body: sovereignDirectEmail1Body(),
  },
  {
    id: 'sovereign-stack-step-2',
    day: 3,
    subject: 're: outbound infrastructure',
    body: `Hi {{FirstName}},

Just following up on my earlier note.

{{agent_followup_observation}}

If useful, I can show the architecture and operating model behind Xavira Control Stack.

No deck chase - just a practical comparison of how {{Company}} handles this today.

Best,
Vishnu
Xavira Tech Labs

{{physical_address}}

If this isn't relevant, just reply "no" and I won't follow up.`,
  },
  {
    id: 'sovereign-stack-step-3',
    day: 6,
    subject: 'worth a conversation?',
    body: `Hi {{FirstName}},

A quick follow-up.

I am not sure if communication infrastructure, deliverability governance, or AI operational controls are priorities for {{Company}} right now.

If they are, I would be happy to share:
* architecture overview
* governance approach
* deployment options

Even if there is no immediate fit, it is often useful to compare infrastructure approaches.

Best,
Vishnu
Xavira Tech Labs

{{physical_address}}

If this isn't relevant, just reply "no" and I won't follow up.`,
  },
  {
    id: 'sovereign-stack-step-4',
    day: 10,
    subject: 'closing the loop',
    body: `Hi {{FirstName}},

I will close the loop after this message.

The reason I reached out is that we built Xavira Control Stack to solve operational problems that typically do not become visible until organizations scale.

That includes:
* deliverability control
* infrastructure observability
* AI governance
* communication operations

If this becomes relevant later, feel free to reach out.

Wishing you and the team continued success.

Best,
Vishnu
Xavira Tech Labs

{{physical_address}}

If this isn't relevant, just reply "no" and I won't follow up.`,
  },
]

export function sovereignSubjectForLead(lead: SovereignCopyLead): string {
  return buildSovereignCopyDecision(lead).subject
}

export function sovereignBodyForLead(lead: SovereignCopyLead): string {
  return inferSovereignOfferType(lead) === 'agency'
    ? sovereignAgencyEmail1Body()
    : sovereignDirectEmail1Body()
}

function safeGreetingName(value: string | null | undefined): string {
  const name = String(value || '').trim()
  if (!name) return 'there'

  const normalized = name.toLowerCase()
  const genericInboxNames = new Set([
    'admin',
    'business',
    'contact',
    'feedback',
    'hello',
    'hi',
    'info',
    'mail',
    'marketing',
    'office',
    'opportunity',
    'ops',
    'partnership',
    'partnerships',
    'sales',
    'support',
    'team',
  ])

  if (genericInboxNames.has(normalized)) return 'there'
  if (!/^[a-z][a-z' -]{1,40}$/i.test(name)) return 'there'

  return name
}

function companyFromDomain(domain: string): string {
  const base = String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('.')[0]
    .replace(/[-_]+/g, ' ')
    .trim()

  return base
    ? base.replace(/\b\w/g, (letter) => letter.toUpperCase())
    : 'your team'
}

function looksLikeContentTitle(value: string): boolean {
  const text = value.toLowerCase()
  return /\b(?:introduction|intro|guide|tutorial|course|training|learn|what is|types of|explained|best practices|resources?|definition|article|blog|news)\b/.test(
    text
  )
}

function safeCompanyName(lead: SovereignCopyLead): string {
  const rawCompany = String(lead.company || '').trim()
  const domain = String(lead.companyDomain || '').trim()
  if (rawCompany && !looksLikeContentTitle(rawCompany)) return rawCompany
  if (domain) return companyFromDomain(domain)
  return rawCompany || 'your team'
}

export function renderSovereignTemplate(
  template: string,
  lead: SovereignCopyLead,
  physicalAddress: string
): string {
  const firstName = safeGreetingName(lead.first_name || lead.firstName)
  const company = safeCompanyName(lead)
  const reason =
    lead.reason_to_contact ||
    lead.reasonToContact ||
    'your team works around outbound or growth infrastructure'
  const painLine = buildSovereignPainLine(lead)
  const copyDecision = buildSovereignCopyDecision(lead)

  return template
    .replaceAll('{{FirstName}}', firstName)
    .replaceAll('{{Company}}', company)
    .replaceAll('{{first_name}}', firstName)
    .replaceAll('{{company}}', company)
    .replaceAll('{{reason_to_contact}}', reason)
    .replaceAll('{{pain_line}}', painLine)
    .replaceAll('{{agent_hook}}', copyDecision.hook)
    .replaceAll('{{agent_pain}}', copyDecision.pain)
    .replaceAll('{{agent_value}}', copyDecision.value)
    .replaceAll('{{agent_cta}}', copyDecision.cta)
    .replaceAll('{{agent_followup_observation}}', copyDecision.followupObservation)
    .replaceAll('{{agent_proof}}', copyDecision.proof)
    .replaceAll('{{physical_address}}', physicalAddress)
}

function compactSentence(value: string, fallback: string): string {
  const cleaned = value
    .replace(/\s+/g, ' ')
    .replace(/[<>]/g, '')
    .trim()
  if (!cleaned) return fallback
  const sentence = cleaned.replace(/[.?!]*$/, '.')
  return sentence.length > 220 ? `${sentence.slice(0, 217).trim()}...` : sentence
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function humanizeReasonForPainLine(reason: string, company: string): string {
  const withoutCompany = reason
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s*·\s*/g, ' ')
    .replace(/^public search result matched .*? target profile:\s*/i, '')
    .replace(/\bPublic domain and MX records confirm the business domain\b[^.?!]*(?:[.?!]|$)/gi, '')
    .replace(/\bselected safe [a-z -]*inbox\b[^.?!]*(?:[.?!]|$)/gi, '')
    .replace(/\bvalidation and bounce controls remain active\b[^.?!]*(?:[.?!]|$)/gi, '')
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, '')
    .replace(new RegExp(`^${escapeRegExp(company)}\\s+`, 'i'), '')
    .replace(/^.*because it shows public signals around\s+/i, '')
    .replace(/^.*because\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.?!]*$/, '')

  if (looksLikeContentTitle(withoutCompany)) return `${company} is active around a relevant business category`
  if (!withoutCompany) return `${company} is active around outbound or growth`
  if (/^(appears|looks|seems|runs|serves|works|offers|has|is)\b/i.test(withoutCompany)) {
    return `${company} ${withoutCompany}`
  }

  return `${company} shows public signals around ${withoutCompany}`
}

export function buildSovereignPainLine(lead: SovereignCopyLead): string {
  const company = safeCompanyName(lead)
  const reason =
    lead.reason_to_contact ||
    lead.reasonToContact ||
    buildLeadResearchContext(lead).researchSummary ||
    ''
  const context = buildLeadResearchContext(lead)
  const offerType = inferSovereignOfferType(lead)

  if (context.socialSignal) {
    return compactSentence(
      `I noticed ${company} is active around ${context.socialSignal}; that usually means outbound reliability and AI data handling start affecting revenue, not just operations.`,
      `I noticed ${company} is scaling outbound, where deliverability and AI data handling can quietly decide campaign ROI.`
    )
  }

  if (context.competitorSignal) {
    return compactSentence(
      `I noticed ${company} sits in a category where ${context.competitorSignal}; that makes outbound reliability and private AI governance a revenue problem, not a tooling problem.`,
      `I noticed ${company} is in a market where outbound reliability and private AI governance can become a revenue edge.`
    )
  }

  if (reason) {
    const humanReason = humanizeReasonForPainLine(reason, company)
    if (/agency|revops|growth|client acquisition|lead generation|outbound/i.test(humanReason)) {
      return compactSentence(
        `I noticed ${company} appears tied to outbound or growth operations. When clients depend on outbound, pipeline is protected by sender health, suppression, follow-ups, and AI governance - not just copy.`,
        `I noticed ${company} works around outbound; that is where sender health and AI governance start deciding client trust.`
      )
    }

    if (/security|compliance|governance|ai|infrastructure|devtools|saas/i.test(humanReason)) {
      return compactSentence(
        `I noticed ${company} appears relevant to AI, security, or infrastructure buyers. In that market, outbound only works when the system behind it feels controlled, auditable, and safe.`,
        `I noticed ${company} sells into trust-heavy buyers; outbound quality depends on infrastructure control, not just messaging.`
      )
    }

    return compactSentence(
      `I noticed ${humanReason}. That is exactly where domain health, follow-up control, and AI data safety either protect pipeline or quietly leak revenue.`,
      `I noticed ${company} is working around outbound, where domain health and AI data safety can quietly decide reply quality.`
    )
  }

  if (offerType === 'agency') {
    return `I noticed ${company} serves growth or RevOps clients; when client campaigns miss replies because domains degrade or AI handling feels risky, the agency gets blamed before the tool stack does.`
  }

  return `I noticed ${company} is a fit for outbound-led growth; when domain health drops or AI workflows touch sensitive data, pipeline cost rises before the team sees the root cause.`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderTextBlock(block: string): string {
  const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length > 0 && lines.every((line) => line.startsWith('* '))) {
    return `<ul style="margin:0 0 16px 20px;padding:0;color:#111827;">${lines
      .map((line) => `<li style="margin:0 0 6px 0;">${escapeHtml(line.slice(2))}</li>`)
      .join('')}</ul>`
  }

  return `<p style="margin:0 0 16px 0;color:#111827;line-height:1.55;">${lines
    .map(escapeHtml)
    .join('<br>')}</p>`
}

export function renderSovereignHtmlEmail(text: string): string {
  const bookingUrl = sovereignBookingUrl()
  const blocks = text.trim().split(/\n{2,}/)
  const htmlBlocks = blocks
    .map((block) => {
      if (block.includes(SOVEREIGN_BOOKING_URL) || block.includes(bookingUrl)) {
        const safeBookingUrl = escapeHtml(bookingUrl)
        return `<p style="margin:20px 0 18px 0;"><a href="${safeBookingUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;padding:10px 14px;font-weight:700;font-size:14px;">Book walkthrough</a></p><p style="margin:0 0 16px 0;color:#6b7280;font-size:12px;">Or open: <a href="${safeBookingUrl}" style="color:#2563eb;">${safeBookingUrl}</a></p>`
      }

      return renderTextBlock(block)
    })
    .join('')

  return `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111827;"><div style="max-width:620px;margin:0 auto;padding:24px;">${htmlBlocks}</div></body></html>`
}

function envEnabled(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function cleanSubject(value: unknown, fallback: string): string {
  const subject = String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!subject || subject.length > 120) return fallback
  return subject
}

function cleanBody(value: unknown, fallback: string, physicalAddress: string): string {
  let body = String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!body || body.length < 120 || body.length > 2_400) return fallback
  if (!/vishnu/i.test(body)) body += '\n\nBest regards,\nVishnu\nXavira Tech Labs'
  body = withSovereignBookingCta(body)
  if (!body.includes(physicalAddress)) body += `\n${physicalAddress}`
  if (!/reply\s+"?no"?|do not follow up|not relevant/i.test(body)) {
    body += '\n\nIf this isn\'t relevant, just reply "no" and I won\'t follow up.'
  }

  return body
}

export async function buildSovereignCopyForLead(
  lead: SovereignCopyLead,
  options: {
    physicalAddress: string
    subjectOverride?: string
    bodyOverride?: string
    useOpenRouter?: boolean
  }
): Promise<SovereignRenderedCopy> {
  const fallbackSubject = options.subjectOverride || sovereignSubjectForLead(lead)
  const fallbackTemplate = options.bodyOverride || sovereignBodyForLead(lead)
  const fallbackText = renderSovereignTemplate(
    fallbackTemplate,
    lead,
    options.physicalAddress
  )
  const openRouterApiKey = appEnv.openRouterApiKey()
  const shouldUseOpenRouter =
    options.useOpenRouter ??
    (Boolean(openRouterApiKey) &&
      envEnabled(process.env.OUTBOUND_OPENROUTER_COPY, false))

  if (!shouldUseOpenRouter) {
    const text = withSovereignBookingCta(fallbackText)
    return {
      subject: fallbackSubject,
      text,
      html: renderSovereignHtmlEmail(text),
      source: 'template',
    }
  }

  const offerType = inferSovereignOfferType(lead)
  const company = lead.company || lead.companyDomain || 'the company'
  const reason =
    lead.reason_to_contact ||
    lead.reasonToContact ||
    'the company appears relevant to outbound infrastructure or AI security'
  const firstName = safeGreetingName(lead.first_name || lead.firstName)
  const researchContext = buildLeadResearchContext(lead)
  const copyDecision = buildSovereignCopyDecision(lead)

  const aiPayload = JSON.stringify({
    salesBrain: buildSalesBrainContext(lead, offerType),
    recipient: {
      firstName,
      company,
      title: lead.title || null,
      companyDomain: lead.companyDomain || null,
      reasonToContact: reason,
      researchContext,
    },
    offer:
      offerType === 'agency'
        ? {
            name: 'Xavira Control Stack',
            positioning:
              'client-facing communication operations and AI governance infrastructure for agencies, RevOps firms, MSSPs, and consultancies',
            bullets: [
              'Sender health, queue discipline, suppression, delivery proof, and follow-up governance',
              'AI governance, PII controls, and audit evidence for client-facing operations',
              'White-label/commercial licensing exists, but do not mention pricing or commercial rights until the buyer asks',
            ],
          }
        : {
            name: 'Xavira Control Stack',
            positioning:
              'owned outbound operations control plane plus private AI governance layer',
            bullets: [
              'Sovereign Engine for domain health, queue pressure, follow-ups, and delivery proof',
              'Sovereign Shield for private AI handling, PII masking, and audit evidence',
              'Deployment-ready dashboards, desktop apps, mobile apps, and operating reports',
            ],
          },
    copyDecision,
    forbiddenFirstTouchClaims: [
      'GBP pricing',
      '£40,000',
      '£160,000',
      'reseller rights',
      'commercial rights',
      'license recovery',
      '3-4 deployments',
    ],
    requiredSignature: ['Best regards', 'Vishnu', 'Xavira Tech Labs', 'Xavira Control Stack'],
    physicalAddress: options.physicalAddress,
    fallbackSubject,
    writingRules: [
      'Start directly with the most specific verified context available. Avoid "hope you are well" and generic intros.',
      'Use a lower-case, short subject when possible; no salesy words, no excessive punctuation, no spam-trigger wording.',
      'Use at most one evidence-backed personalization line.',
      'Answer the buyer question clearly: why buy, what profit or risk reduction they should expect, and why this matters now.',
      'Optimize for client generation, not lead generation: the email should make a qualified buyer think "this could become an audit or licensing conversation."',
      `Treat ${SOVEREIGN_CLIENT_GENERATION_TARGET.dailyQualifiedConversationsMin}-${SOVEREIGN_CLIENT_GENERATION_TARGET.dailyQualifiedConversationsMax} qualified conversations per day as the operating target, not a promise.`,
      'Do not mention GBP pricing, £40,000, £160,000, reseller rights, commercial rights, license recovery, or deployment economics in cold first-touch/follow-up copy. Pricing belongs only after the buyer asks or a call is booked.',
      'Lead with the company pain before mentioning the product.',
      'Make the ask feel helpful: a 20-minute audit that maps risks and gives a 3-step action plan.',
      'If researchContext has LinkedIn or social context, use it naturally in one sentence.',
      'If competitorSignal exists, phrase it as a category trend, not as a fake customer claim.',
      'Keep the email short, useful, and human; avoid brochure language.',
      'Use one clear ask and one booking link only.',
      'Do not use hype, urgency, discounts, guarantees, or spammy promotional phrasing.',
      'Explain the product benefit in simple words: owned control, safer outbound, cleaner follow-ups, reduced AI data leak risk, and stronger client trust.',
    ],
  })
  const aiSystem =
    'You write compliant B2B enterprise outbound email copy for a legitimate business interest workflow. Return JSON only with subject and body. Use the supplied Sovereign Sales Brain rules. Position Xavira Tech Labs as a premium infrastructure vendor. Do not invent facts, customer names, revenue claims, urgency, fake personalization, or competitor customer claims. Write like a serious operator sending a one-to-one note: short, specific, plain text, pain-first, and useful. No hype, no emojis, no spam tricks, no bypass language. Keep it under 150 words. Do not mention pricing, GBP amounts, reseller rights, commercial rights, or license recovery in cold first-touch/follow-up copy. Include a polite opt-out line. Structure: verified evidence hook, operational pain, why Xavira Control Stack helps, low-friction audit CTA.'

  const result = shouldUseOpenRouter
    ? await tryOpenRouterJson<{
        subject?: string
        body?: string
        reason?: string
      }>({
        task: 'sovereign_outbound_copy',
        system: aiSystem,
        user: aiPayload,
        fallback: {
          subject: fallbackSubject,
          body: fallbackText,
          reason: 'fallback_template',
        },
        apiKey: openRouterApiKey,
        timeoutMs: 5_000,
      })
    : {
        source: 'fallback' as const,
        data: {
          subject: fallbackSubject,
          body: fallbackText,
          reason: 'openrouter_disabled',
        },
        error: 'openrouter_disabled',
  }

  if (result.source !== 'openrouter') {
    const text = withSovereignBookingCta(fallbackText)
    return {
      subject: fallbackSubject,
      text,
      html: renderSovereignHtmlEmail(text),
      source: 'template',
      error: result.error,
    }
  }

  const text = cleanBody(result.data.body, fallbackText, options.physicalAddress)
  return {
    subject: cleanSubject(result.data.subject, fallbackSubject),
    text,
    html: renderSovereignHtmlEmail(text),
    source: 'openrouter',
  }
}
