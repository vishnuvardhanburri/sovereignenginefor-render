import { tryXaviraAiJson, xaviraAiConfigured } from '@/lib/ai/xavira-ai'
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

export type SovereignCopyRagContext = {
  contactFacts?: Record<string, unknown>
  evidenceFacts?: string[]
  eventHistory?: string[]
  replySignals?: string[]
  accountSignals?: string[]
  riskSignals?: string[]
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
  source: 'template' | 'xavira_ai'
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
  | 'investor'
  | 'generic'

export type SovereignBuyerIntelligence = {
  companyType: string
  businessModel: string
  revenueMotion: string
  customerType: string
  growthMotion: string
  communicationComplexity: string
  operationalRiskIndicators: string[]
  likelyStakeholders: string[]
  likelyCommunicationChannels: string[]
  businessSummary: string
  riskSummary: string
  communicationHypothesis: string
}

export type SovereignConversationSelfScore = {
  observationQuality: number
  hypothesisQuality: number
  personaRelevance: number
  conversationPotential: number
}

type SovereignConversationQualityResult = {
  ok: boolean
  scores: SovereignConversationSelfScore
  reasons: string[]
}

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

function compactResearchValue(value: unknown, max = 220): string {
  const text = String(value ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text
}

function researchTextForBuyerIntelligence(
  lead: SovereignCopyLead,
  ragContext: SovereignCopyRagContext = {}
): string {
  const custom = lead.customFields ?? {}
  const fields = [
    lead.company,
    lead.companyDomain,
    lead.title,
    lead.source,
    lead.reason_to_contact,
    lead.reasonToContact,
    ...Object.values(custom),
    ...Object.values(ragContext.contactFacts ?? {}),
    ...(ragContext.evidenceFacts ?? []),
    ...(ragContext.accountSignals ?? []),
    ...(ragContext.riskSignals ?? []),
  ]

  return fields.map((value) => compactResearchValue(value, 260).toLowerCase()).join(' ')
}

function includesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

function uniqueList(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function inferCompanyType(text: string, offerType: SovereignOfferType): string {
  if (offerType === 'agency') return 'agency or client acquisition services firm'
  if (includesAny(text, [/\brevops\b|revenue operations|gtm ops|sales operations/])) {
    return 'RevOps or revenue operations team'
  }
  if (includesAny(text, [/\bmssp\b|security consultancy|cybersecurity consultancy|incident response|soc\b/])) {
    return 'security consultancy or managed security provider'
  }
  if (includesAny(text, [/\bcapital raising\b|lender|broker|real estate|property|development|project stakeholders?/])) {
    return 'project-led development or capital-raising business'
  }
  if (includesAny(text, [/\bsaas\b|software|platform|subscription|cloud/])) return 'B2B software company'
  if (includesAny(text, [/\bconsulting\b|advisory|services|implementation/])) return 'consulting or services firm'
  return 'communication-heavy B2B business'
}

function inferBusinessModel(text: string, offerType: SovereignOfferType): string {
  if (offerType === 'agency') return 'service-led client delivery'
  if (includesAny(text, [/\bsubscription\b|saas|platform|licenses?/])) return 'software subscription'
  if (includesAny(text, [/\bcapital raising\b|lender|broker|development|project/])) return 'deal-led project execution'
  if (includesAny(text, [/\bconsulting\b|advisory|implementation|managed service/])) return 'consulting and managed services'
  return 'relationship-led B2B sales'
}

function inferRevenueMotion(text: string, offerType: SovereignOfferType): string {
  if (includesAny(text, [/\bcapital raising\b|investor|lender|broker|partner communications?/])) {
    return 'capital raising and stakeholder coordination'
  }
  if (offerType === 'agency' || includesAny(text, [/\bclient acquisition\b|lead generation|appointment setting|outbound/])) {
    return 'client acquisition and outbound-led growth'
  }
  if (includesAny(text, [/\benterprise\b|strategic accounts?|mid-market|sales-led/])) return 'sales-led enterprise pipeline'
  if (includesAny(text, [/\bdemand gen|pipeline|gtm|revenue/])) return 'pipeline and demand generation'
  return 'relationship-driven growth'
}

function inferCustomerType(text: string, offerType: SovereignOfferType): string {
  if (offerType === 'agency') return 'clients that depend on pipeline or campaign execution'
  if (includesAny(text, [/\binvestor|lender|broker|partner|project stakeholders?/])) {
    return 'investors, lenders, brokers, partners, and project stakeholders'
  }
  if (includesAny(text, [/\benterprise|procurement|security buyer|trust-heavy|compliance/])) {
    return 'enterprise or trust-heavy buyers'
  }
  if (includesAny(text, [/\bdeveloper|cto|engineering|platform/])) return 'technical buyers and operators'
  return 'B2B buyers and internal stakeholders'
}

function inferGrowthMotion(text: string, offerType: SovereignOfferType): string {
  if (includesAny(text, [/\bhiring\b|open role|recruiting|team growth|expanding/])) return 'team expansion'
  if (includesAny(text, [/\bcapital raising\b|raising capital|fundraising|investor/])) return 'capital formation'
  if (offerType === 'agency') return 'client acquisition scale'
  if (includesAny(text, [/\bpartnership|channel|alliances?|ecosystem/])) return 'partnership-led growth'
  return 'outbound or relationship-led expansion'
}

function inferCommunicationComplexity(text: string, offerType: SovereignOfferType): string {
  if (includesAny(text, [/\bcapital raising\b|investor|lender|broker|project stakeholders?|development/])) {
    return 'investors, lenders, brokers, partners, and project stakeholders'
  }
  if (offerType === 'agency') return 'clients, prospects, account owners, and delivery teams'
  if (includesAny(text, [/\benterprise|procurement|security|compliance|legal|risk/])) {
    return 'buyers, technical evaluators, legal, security, and internal operators'
  }
  if (includesAny(text, [/\brevops\b|sales operations|gtm ops|pipeline/])) {
    return 'sales, marketing, customer-facing teams, and operations owners'
  }
  return 'prospects, internal owners, and follow-up workflows'
}

export function buildSovereignBuyerIntelligence(
  lead: SovereignCopyLead,
  ragContext: SovereignCopyRagContext = {}
): SovereignBuyerIntelligence {
  const company = safeCompanyName(lead)
  const offerType = inferSovereignOfferType(lead)
  const text = researchTextForBuyerIntelligence(lead, ragContext)
  const companyType = inferCompanyType(text, offerType)
  const businessModel = inferBusinessModel(text, offerType)
  const revenueMotion = inferRevenueMotion(text, offerType)
  const customerType = inferCustomerType(text, offerType)
  const growthMotion = inferGrowthMotion(text, offerType)
  const communicationComplexity = inferCommunicationComplexity(text, offerType)
  const operationalRiskIndicators = uniqueList([
    includesAny(text, [/\bfollow[- ]?up|reply|inbox|missed response/]) ? 'follow-up ownership' : '',
    includesAny(text, [/\bclient|reporting|account owner|delivery/]) ? 'client reporting visibility' : '',
    includesAny(text, [/\binvestor|lender|broker|partner|stakeholder/]) ? 'multi-stakeholder coordination' : '',
    includesAny(text, [/\bsecurity|compliance|governance|audit|risk/]) ? 'communication governance and evidence' : '',
    includesAny(text, [/\boutbound|lead generation|campaign|sdr|demand gen/]) ? 'outbound delivery visibility' : '',
    includesAny(text, [/\bspreadsheet|crm|linkedin|gmail|calendar|assistant/]) ? 'context spread across tools' : '',
  ])
  const likelyStakeholders = uniqueList([
    includesAny(text, [/\bfounder|ceo|owner|principal|partner/]) ? 'founders or principals' : '',
    includesAny(text, [/\brevops|sales|cro|revenue|gtm|demand gen/]) ? 'revenue and RevOps leaders' : '',
    includesAny(text, [/\boperations|coo|delivery|account owner/]) ? 'operations and delivery owners' : '',
    includesAny(text, [/\bcto|engineering|platform|integrations?/]) ? 'technical owners' : '',
    includesAny(text, [/\bciso|security|compliance|audit|risk/]) ? 'security or compliance owners' : '',
    includesAny(text, [/\binvestor|lender|broker|capital|project stakeholder/]) ? 'investors, lenders, brokers, and partners' : '',
  ])
  const likelyCommunicationChannels = uniqueList([
    'email',
    includesAny(text, [/\blinkedin|social selling|dm\b/]) ? 'LinkedIn' : '',
    includesAny(text, [/\bcrm|salesforce|hubspot|pipeline/]) ? 'CRM' : '',
    includesAny(text, [/\bcalendar|calendly|meeting|demo/]) ? 'calendar workflows' : '',
    includesAny(text, [/\bspreadsheet|sheet|assistant/]) ? 'spreadsheets or assistant-managed workflows' : '',
  ])

  const risks = operationalRiskIndicators.length
    ? operationalRiskIndicators.join(', ')
    : 'reply visibility, follow-up ownership, and communication context'

  return {
    companyType,
    businessModel,
    revenueMotion,
    customerType,
    growthMotion,
    communicationComplexity,
    operationalRiskIndicators,
    likelyStakeholders: likelyStakeholders.length ? likelyStakeholders : ['founders, revenue owners, and operators'],
    likelyCommunicationChannels,
    businessSummary: `${company} appears to be a ${companyType} with a ${businessModel} model and a ${revenueMotion} motion.`,
    riskSummary: `The likely risk is ${risks} becoming hard to see as communication volume grows.`,
    communicationHypothesis: `When ${company} has to coordinate ${communicationComplexity}, the first problems are usually visibility, ownership, and knowing which conversations need action.`,
  }
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
  if (/\binvestor\b|venture partner|capital partner|private equity|vc\b|fund manager/.test(text)) return 'investor'
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

function isRejectedObservation(observation: string): boolean {
  const text = observation.toLowerCase()
  return (
    /\b(?:you are growing|you'?re growing|great company|impressive work|love what you do|came across your website)\b/.test(text) ||
    /\b(?:leading provider|mission is to|committed to|trusted by|founded in|headquartered in)\b/.test(text) ||
    /\b(?:end-to-end|comprehensive solutions|tailored solutions|innovative solutions)\b/.test(text)
  )
}

function isOperationalObservation(observation: string): boolean {
  return /\b(?:coordinate|communication|stakeholder|investor|lender|broker|partner|follow-up|client|reporting|pipeline|governance|visibility|delivery|operations|outreach|growth|workflow)\b/i.test(
    observation
  )
}

function selectOperationalObservation(
  lead: SovereignCopyLead,
  intelligence: SovereignBuyerIntelligence
): string {
  const company = safeCompanyName(lead)
  const complexity = intelligence.communicationComplexity
  const candidates = [
    /\binvestors?, lenders?, brokers?, partners?, and project stakeholders?\b/i.test(complexity)
      ? `I noticed ${company} appears to coordinate investors, lenders, brokers, partners, and project stakeholders simultaneously.`
      : '',
    /\bclients?, prospects?, account owners?, and delivery teams?\b/i.test(complexity)
      ? `I noticed ${company} appears to manage client, prospect, account-owner, and delivery conversations in parallel.`
      : '',
    /\bbuyers?, technical evaluators?, legal, security\b/i.test(complexity)
      ? `I noticed ${company} appears to sell into groups where buyers, technical evaluators, security, and internal operators all influence the conversation.`
      : '',
    /\bsales, marketing, customer-facing teams\b/i.test(complexity)
      ? `I noticed ${company} appears to sit across sales, marketing, customer-facing teams, and operations owners.`
      : '',
    `I noticed ${company} appears to run a communication-heavy ${intelligence.revenueMotion} motion.`,
  ]

  const selected = candidates
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate && !isRejectedObservation(candidate) && isOperationalObservation(candidate))

  return selected || `I noticed ${company} appears to run a communication-heavy revenue motion.`
}

function hypothesisForBuyerIntelligence(intelligence: SovereignBuyerIntelligence): string {
  return intelligence.communicationHypothesis
}

function xaviraMentionForBuyerIntelligence(): string {
  return 'Xavira Control Stack was built around that layer.'
}

function questionForPersona(
  company: string,
  persona: SovereignBuyerPersona,
  intelligence: SovereignBuyerIntelligence
): string {
  if (persona === 'founder') {
    return `As ${company} scales this motion, what becomes hardest to keep visible: growth conversations, stakeholder coordination, or follow-up ownership?`
  }
  if (persona === 'revenue') {
    return `Where does ${company} feel the most friction today: pipeline visibility, follow-up ownership, or knowing which conversations actually need attention?`
  }
  if (persona === 'operations') {
    return `Where does this become hardest operationally for ${company}: process control, accountability, or visibility across owners?`
  }
  if (persona === 'technical') {
    return `Where does this become hardest for ${company}: system handoffs, integrations, or reliability across communication workflows?`
  }
  if (persona === 'security') {
    return `Where does ${company} need the clearest evidence today: communication governance, auditability, or control over sensitive context?`
  }
  if (persona === 'investor') {
    return `Where does communication discipline matter most for ${company}: reporting, stakeholder visibility, or keeping follow-ups consistent?`
  }
  if (persona === 'partnerships') {
    return `Where does this become hardest for ${company}: partner coordination, follow-up ownership, or visibility across shared conversations?`
  }
  const channels = intelligence.likelyCommunicationChannels.slice(0, 3).join(', ')
  return `Where does ${company} feel the most communication friction today: visibility, follow-ups, or coordination across ${channels || 'current tools'}?`
}

function subjectForCopyDecision(
  offerType: SovereignOfferType,
  industry: SovereignBuyerIndustry,
  persona: SovereignBuyerPersona
): string {
  if (offerType === 'agency') {
    if (persona === 'partnerships') return 'partnership communication visibility'
    if (industry === 'revops') return 'follow-up visibility'
    return 'client outreach visibility'
  }
  if (industry === 'cybersecurity' || industry === 'compliance') return 'communication control question'
  if (industry === 'ai' || industry === 'devtools') return 'buyer communication visibility'
  return 'communication visibility'
}

function hookForCopyDecision(
  company: string,
  industry: SovereignBuyerIndustry,
  persona: SovereignBuyerPersona
): string {
  if (industry === 'agency') {
    return `I looked at ${company} because agencies running client acquisition usually hit the same hidden problem once volume grows: the campaign looks busy, but sender trust and follow-up control decide whether revenue is actually created.`
  }
  if (industry === 'revops') {
    return `I looked at ${company} because RevOps teams often own the painful gap between activity numbers and real buyer conversations.`
  }
  if (industry === 'cybersecurity' || industry === 'compliance') {
    return `I looked at ${company} because trust-heavy buyers punish anything that feels uncontrolled: spam placement, messy follow-up, weak audit trails, or loose AI handling.`
  }
  if (industry === 'ai' || industry === 'devtools') {
    return `I looked at ${company} because technical buyers can ignore even strong products when the outreach layer feels automated, duplicated, or poorly governed.`
  }
  if (persona === 'founder') {
    return `I looked at ${company} because founder-led teams feel the cost first when outbound burns a domain, loses follow-ups, or spreads deal context across too many tools.`
  }
  return `I looked at ${company} because outbound problems rarely announce themselves; they show up as silence, weak replies, and operators not knowing which touch actually reached the buyer.`
}

function painForCopyDecision(industry: SovereignBuyerIndustry): string {
  if (industry === 'agency') {
    return 'That usually creates hard-to-see operating gaps: replies get missed, client reporting becomes fuzzy, prospects are touched twice, and deliverability problems show up only after performance drops.'
  }
  if (industry === 'revops') {
    return 'As volume grows, the issue is less activity and more control: knowing what reached the buyer, what needs follow-up, and which conversations are leaking between tools.'
  }
  if (industry === 'cybersecurity' || industry === 'compliance') {
    return 'Trust-heavy buyers tend to punish communication that feels loose. Missed follow-ups, unclear ownership, poor inbox placement, or scattered context can weaken a serious conversation before it starts.'
  }
  if (industry === 'ai' || industry === 'devtools') {
    return 'Technical buyers can ignore even strong products when outreach feels automated, duplicated, or disconnected from the real buying context.'
  }
  return 'That kind of motion can become difficult to control when messages, follow-ups, and context live across inboxes, LinkedIn, calendars, spreadsheets, CRM records, and assistants.'
}

function valueForCopyDecision(offerType: SovereignOfferType, industry: SovereignBuyerIndustry): string {
  if (offerType === 'agency') {
    return 'Xavira Control Stack helps agencies keep client-facing outreach visible and controlled across the systems they already use. Sovereign Shield adds protection for sensitive communication and deal-flow data.'
  }
  if (industry === 'cybersecurity' || industry === 'compliance') {
    return 'Xavira Control Stack helps teams gain visibility and control across the communication systems they already use, with Sovereign Shield protecting sensitive outreach and client data.'
  }
  return 'Xavira Control Stack helps teams see and control what is happening across outreach, follow-ups, client-facing communication, and sensitive communication data.'
}

function ctaForCopyDecision(
  company: string,
  industry: SovereignBuyerIndustry,
  persona: SovereignBuyerPersona
): string {
  if (industry === 'agency' || industry === 'revops' || persona === 'partnerships') {
    return `Where does this become hardest inside ${company}: reply visibility, follow-up ownership, client reporting, or duplicate outreach?`
  }
  if (persona === 'founder') {
    return 'What tends to break first for you as communication volume grows?'
  }
  if (persona === 'technical' || persona === 'security') {
    return 'Is this something your team already has under control, or does it still live across the current tools?'
  }
  return `Where does ${company} feel the most leakage today: reach, replies, follow-ups, or internal visibility?`
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

export function buildSovereignCopyDecision(
  lead: SovereignCopyLead,
  ragContext: SovereignCopyRagContext = {}
): SovereignCopyDecision {
  const company = safeCompanyName(lead)
  const offerType = inferSovereignOfferType(lead)
  const industry = detectSovereignBuyerIndustry(lead)
  const persona = detectSovereignBuyerPersona(lead)
  const intelligence = buildSovereignBuyerIntelligence(lead, ragContext)
  const observation = selectOperationalObservation(lead, intelligence)

  return {
    offerType,
    industry,
    persona,
    subject: subjectForCopyDecision(offerType, industry, persona),
    hook: observation,
    pain: hypothesisForBuyerIntelligence(intelligence),
    value: xaviraMentionForBuyerIntelligence(),
    cta: questionForPersona(company, persona, intelligence),
    followupObservation: followupObservationForCopyDecision(industry),
    proof: observation,
  }
}

export function sovereignDirectEmail1Body(): string {
  return `Hi {{FirstName}},

{{agent_proof}}

{{agent_pain}}

{{agent_value}}

{{agent_cta}}

Best,
Vishnu
Founder
Xavira Tech Labs

If not relevant, no worries.

{{physical_address}}`
}

export function sovereignAgencyEmail1Body(): string {
  return `Hi {{FirstName}},

{{agent_proof}}

{{agent_pain}}

{{agent_value}}

{{agent_cta}}

Best,
Vishnu
Founder
Xavira Tech Labs

If not relevant, no worries.

{{physical_address}}`
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
      `I noticed ${company} has been active around ${context.socialSignal}.`,
      `I noticed ${company} has been active around a relevant business priority.`
    )
  }

  if (context.competitorSignal) {
    return compactSentence(
      `I noticed ${company} operates in a category where ${context.competitorSignal}.`,
      `I noticed ${company} operates in a category where communication quality can affect trust.`
    )
  }

  if (reason) {
    const humanReason = humanizeReasonForPainLine(reason, company)
    if (/agency|revops|growth|client acquisition|lead generation|outbound/i.test(humanReason)) {
      return compactSentence(
        `I noticed ${company} appears active around outbound, demand generation, or client acquisition.`,
        `I noticed ${company} works around outbound or growth.`
      )
    }

    if (/\b(?:security|compliance|governance|ai|infrastructure|devtools|saas)\b/i.test(humanReason)) {
      return compactSentence(
        `I noticed ${company} appears focused on AI, security, infrastructure, or other trust-heavy buyers.`,
        `I noticed ${company} sells into trust-heavy buyers.`
      )
    }

    return compactSentence(
      `I noticed ${humanReason}.`,
      `I noticed ${company} is working around a relevant business motion.`
    )
  }

  if (offerType === 'agency') {
    return `I noticed ${company} serves growth, RevOps, or client acquisition teams.`
  }

  return `I noticed ${company} appears to have a communication-heavy go-to-market motion.`
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

function wordCount(value: string): number {
  return value
    .replace(/https?:\/\/\S+/g, '')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean).length
}

function companyMentionCount(body: string, company: string): number {
  const normalizedCompany = company.trim()
  if (!normalizedCompany || normalizedCompany === 'the company' || normalizedCompany === 'your team') {
    return 1
  }
  const pattern = new RegExp(`\\b${escapeRegExp(normalizedCompany)}\\b`, 'gi')
  return body.match(pattern)?.length ?? 0
}

function questionCount(body: string): number {
  return (body.match(/\?/g) ?? []).length
}

function productWordShare(body: string): number {
  const message = bodyBeforeSignature(body)
  const paragraphs = message.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean)
  const total = Math.max(wordCount(message), 1)
  const productWords = paragraphs
    .filter((paragraph) => /\b(?:xavira|control stack|sovereign shield|sovereign engine)\b/i.test(paragraph))
    .reduce((sum, paragraph) => sum + wordCount(paragraph), 0)
  return productWords / total
}

function hasForbiddenColdEmailLanguage(body: string): boolean {
  return /\b(?:revolutionary|disruptive|cutting-edge|game-changing|best-in-class|powerful|innovative|industry-leading|ai-powered platform)\b/i.test(body) ||
    /\b(?:£40,000|£160,000|40k|160k|pricing|license|licensing|reseller rights|commercial rights|maintenance|white-label|white label|license recovery)\b/i.test(body) ||
    /\b(?:book|schedule|hop on|jump on|demo|walkthrough|calendar|cal\.com)\b/i.test(body)
}

function hasGenericColdEmailLanguage(body: string): boolean {
  return /\b(?:hope you'?re well|i came across your company|your company caught my eye|touching base|checking in|quick intro)\b/i.test(body) ||
    /\b(?:increase revenue|grow your business|generate more leads|scale your sales)\b/i.test(body)
}

function hasFeatureList(body: string): boolean {
  return /(?:^|\n)\s*(?:[-*]|\d+[.)])\s+\S/.test(body) ||
    /\b(?:features?|includes?|offers?|provides?):\s*(?:[^.\n]+,\s*){2,}/i.test(body)
}

function xaviraMentionCount(body: string): number {
  return bodyBeforeSignature(body).match(/\bXavira\b/gi)?.length ?? 0
}

function scoreByCondition(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)))
}

function bodyBeforeSignature(body: string): string {
  return body.split(/\n\nBest,\s*\nVishnu/i)[0]?.trim() ?? body.trim()
}

function contentParagraphs(body: string): string[] {
  return bodyBeforeSignature(body)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .filter((paragraph) => !/^hi\b/i.test(paragraph))
}

function firstBodyParagraph(body: string): string {
  return contentParagraphs(body)[0] ?? ''
}

function secondBodyParagraph(body: string): string {
  return contentParagraphs(body)[1] ?? ''
}

export function scoreSovereignConversationCopy(
  body: string,
  company: string,
  persona: SovereignBuyerPersona = 'generic'
): SovereignConversationSelfScore {
  const first = firstBodyParagraph(body)
  const second = secondBodyParagraph(body)
  const words = wordCount(body)
  const companyMentions = companyMentionCount(body, company)
  const oneQuestion = questionCount(body) === 1
  const productShare = productWordShare(body)
  const forbidden = hasForbiddenColdEmailLanguage(body)
  const generic = hasGenericColdEmailLanguage(body)
  const featureList = hasFeatureList(body)
  const observationOperational = isOperationalObservation(first)
  const observationRejected = isRejectedObservation(first)
  const hypothesisBusiness =
    /\b(?:usually|when|as|if|the first|that can|becomes?|hardest|difficult|friction|leak|visibility|ownership|coordination|control)\b/i.test(second) &&
    !/\b(?:Xavira|Control Stack|Sovereign)\b/i.test(second)
  const personaTerms: Record<SovereignBuyerPersona, RegExp> = {
    founder: /\b(?:scale|growth|coordination|stakeholder|motion)\b/i,
    revenue: /\b(?:pipeline|visibility|follow-up|conversation|revenue)\b/i,
    partnerships: /\b(?:partner|coordination|shared conversations|follow-up)\b/i,
    technical: /\b(?:systems?|integrations?|reliability|handoffs?|workflow)\b/i,
    security: /\b(?:governance|auditability|evidence|sensitive|control)\b/i,
    operations: /\b(?:process|control|accountability|owners?|visibility)\b/i,
    investor: /\b(?:reporting|stakeholder|visibility|discipline|follow-up)\b/i,
    generic: /\b(?:visibility|follow-up|coordination|communication)\b/i,
  }
  const personaRelevant = personaTerms[persona].test(body)

  return {
    observationQuality: scoreByCondition(
      100 -
        (companyMentions < 1 ? 20 : 0) -
        (!observationOperational ? 18 : 0) -
        (observationRejected ? 35 : 0) -
        (generic ? 25 : 0)
    ),
    hypothesisQuality: scoreByCondition(
      100 -
        (!hypothesisBusiness ? 25 : 0) -
        (featureList ? 35 : 0) -
        (forbidden ? 35 : 0)
    ),
    personaRelevance: scoreByCondition(
      100 -
        (!personaRelevant ? 20 : 0) -
        (companyMentions < 2 ? 12 : 0)
    ),
    conversationPotential: scoreByCondition(
      100 -
        (!oneQuestion ? 35 : 0) -
        (words > 180 ? 35 : 0) -
        (words < 70 ? 15 : 0) -
        (productShare > 0.25 ? 25 : 0) -
        (xaviraMentionCount(body) > 1 ? 25 : 0) -
        (forbidden ? 35 : 0) -
        (featureList ? 30 : 0)
    ),
  }
}

function normalizeSelfScore(value: unknown): SovereignConversationSelfScore | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const read = (key: keyof SovereignConversationSelfScore) => {
    const parsed = Number(record[key])
    return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.trunc(parsed))) : NaN
  }
  const scores = {
    observationQuality: read('observationQuality'),
    hypothesisQuality: read('hypothesisQuality'),
    personaRelevance: read('personaRelevance'),
    conversationPotential: read('conversationPotential'),
  }
  return Object.values(scores).every((score) => Number.isFinite(score)) ? scores : null
}

function evaluateColdConversationQuality(
  body: string,
  company: string,
  persona: SovereignBuyerPersona,
  aiSelfScore?: unknown
): SovereignConversationQualityResult {
  const words = wordCount(body)
  const scores = scoreSovereignConversationCopy(body, company, persona)
  const reasons: string[] = []
  const modelScores = normalizeSelfScore(aiSelfScore)

  if (words < 70) reasons.push('too_short')
  if (words > 180) reasons.push('too_long')
  if (questionCount(body) !== 1) reasons.push('must_have_exactly_one_question')
  if (productWordShare(body) > 0.25) reasons.push('too_product_heavy')
  if (xaviraMentionCount(body) > 1) reasons.push('xavira_mentioned_more_than_once')
  if (hasForbiddenColdEmailLanguage(body)) reasons.push('forbidden_language')
  if (hasGenericColdEmailLanguage(body)) reasons.push('generic_language')
  if (hasFeatureList(body)) reasons.push('feature_list')
  if (companyMentionCount(body, company) < 2) reasons.push('company_not_mentioned_twice')
  if (!/\bBest,\s*\nVishnu\s*\nFounder\s*\nXavira Tech Labs\b/i.test(body)) reasons.push('bad_signature')
  if (!/\bIf not relevant, no worries\./i.test(body)) reasons.push('missing_soft_opt_out')
  for (const [key, score] of Object.entries(scores)) {
    if (score < 85) reasons.push(`${key}_below_85`)
  }
  if (modelScores) {
    for (const [key, score] of Object.entries(modelScores)) {
      if (score < 85) reasons.push(`model_${key}_below_85`)
    }
  } else if (aiSelfScore !== undefined) {
    reasons.push('invalid_model_self_score')
  }

  return { ok: reasons.length === 0, scores, reasons }
}

function cleanBody(
  value: unknown,
  fallback: string,
  physicalAddress: string,
  options: { includeBookingCta?: boolean } = {}
): string {
  let body = String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!body || body.length < 120 || body.length > 2_400) return fallback
  if (!/vishnu/i.test(body)) body += '\n\nBest,\nVishnu\nFounder\nXavira Tech Labs'
  if (options.includeBookingCta) body = withSovereignBookingCta(body)
  if (!/If not relevant, no worries\./i.test(body)) {
    body += '\n\nIf not relevant, no worries.'
  }
  if (!body.includes(physicalAddress)) body += `\n${physicalAddress}`

  return body
}

export async function buildSovereignCopyForLead(
  lead: SovereignCopyLead,
  options: {
    physicalAddress: string
    subjectOverride?: string
    bodyOverride?: string
    useXaviraAi?: boolean
    useOpenRouter?: boolean
    ragContext?: SovereignCopyRagContext
    includeBookingCta?: boolean
  }
): Promise<SovereignRenderedCopy> {
  const fallbackSubject = options.subjectOverride || sovereignSubjectForLead(lead)
  const fallbackTemplate = options.bodyOverride || sovereignBodyForLead(lead)
  const fallbackText = renderSovereignTemplate(
    fallbackTemplate,
    lead,
    options.physicalAddress
  )
  const shouldUseXaviraAi =
    options.useXaviraAi ??
    options.useOpenRouter ??
    (xaviraAiConfigured() &&
      envEnabled(
        process.env.OUTBOUND_XAVIRA_AI_COPY,
        envEnabled(process.env.OUTBOUND_OPENROUTER_COPY, true)
      ))

  if (!shouldUseXaviraAi) {
    const text = options.includeBookingCta ? withSovereignBookingCta(fallbackText) : fallbackText.trim()
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
  const ragContext = options.ragContext ?? {}
  const buyerIntelligence = buildSovereignBuyerIntelligence(lead, ragContext)
  const copyDecision = buildSovereignCopyDecision(lead, ragContext)

  const aiPayloadBase = {
    salesBrain: buildSalesBrainContext(lead, offerType),
    retrieval: {
      method: 'database_rag',
      instruction:
        'Use these retrieved database facts as the primary source. Do not write a generic template. If facts are thin, name the likely operational risk and ask a diagnostic question instead of pretending to know more.',
      contactFacts: ragContext.contactFacts ?? {},
      evidenceFacts: ragContext.evidenceFacts ?? [],
      eventHistory: ragContext.eventHistory ?? [],
      replySignals: ragContext.replySignals ?? [],
      accountSignals: ragContext.accountSignals ?? [],
      riskSignals: ragContext.riskSignals ?? [],
    },
    recipient: {
      firstName,
      company,
      title: lead.title || null,
      companyDomain: lead.companyDomain || null,
      reasonToContact: reason,
      researchContext,
    },
    buyerIntelligence,
    problemChain: {
      observation: copyDecision.proof,
      operationalHypothesis: copyDecision.pain,
      xaviraMention: copyDecision.value,
      discoveryQuestion: copyDecision.cta,
    },
    offer: {
      name: 'Xavira Control Stack',
      mentionRule:
        'Mention Xavira once only. Use one short sentence such as "Xavira Control Stack was built around that layer." No feature list.',
      sovereignShieldContext:
        'Sovereign Shield is the sensitive-communication protection angle, but only mention it if directly relevant and never as a feature list.',
    },
    copyDecision,
    outputContract: {
      jsonOnly: true,
      fields: ['subject', 'body', 'selfScore'],
      selfScoreFields: [
        'observationQuality',
        'hypothesisQuality',
        'personaRelevance',
        'conversationPotential',
      ],
      selfScoreMinimum: 85,
      instruction:
        'Score the draft. If any score is below 85, rewrite before returning the final JSON.',
    },
    forbiddenFirstTouchClaims: [
      'GBP pricing',
      '£40,000',
      '£160,000',
      'reseller rights',
      'commercial rights',
      'license recovery',
      '3-4 deployments',
      'booking links',
      'meeting asks',
      'maintenance',
      'white-label',
      'feature lists',
    ],
    requiredSignature: ['Best', 'Vishnu', 'Founder', 'Xavira Tech Labs', 'If not relevant, no worries.'],
    physicalAddress: options.physicalAddress,
    fallbackSubject,
    writingRules: [
      'You are Xavira AI, an elite B2B outbound research and email strategist.',
      'Goal: start a relevant business conversation, not pitch immediately.',
      'Paragraph 1: start with the prospect and one specific verified observation from research. Never start with Xavira.',
      'Paragraph 2: create a reasonable business hypothesis tied to that observation.',
      'Paragraph 3: mention Xavira briefly in business language only.',
      'Paragraph 4: ask one thoughtful diagnostic question.',
      'Signature must be exactly: Best, Vishnu, Founder, Xavira Tech Labs, then "If not relevant, no worries."',
      'Keep the body between 80 and 140 words before the physical address.',
      'Mention the prospect company at least twice naturally.',
      'More than 25% of the email must not talk about Xavira.',
      'Start directly with the most specific verified context available. Avoid "hope you are well" and generic intros.',
      'Use retrieved database facts first; deterministic template language is only fallback inspiration.',
      'Do not say "I came across" unless the retrieved context proves where the lead came from.',
      'Use a lower-case, short subject when possible; no salesy words, no excessive punctuation, no spam-trigger wording.',
      'Use at most one evidence-backed personalization line.',
      'Focus on business pains: lost opportunities, poor visibility, client reporting issues, deliverability uncertainty, follow-up gaps, duplicate outreach, scaling operations, and data protection concerns.',
      'Avoid technical jargon such as queue discipline, suppression architecture, governance layer, and internal platform terminology.',
      'Optimize for client generation, not lead generation: the email should make a qualified buyer think "this person actually looked at my company."',
      `Treat ${SOVEREIGN_CLIENT_GENERATION_TARGET.dailyQualifiedConversationsMin}-${SOVEREIGN_CLIENT_GENERATION_TARGET.dailyQualifiedConversationsMax} qualified conversations per day as the operating target, not a promise.`,
      'Do not mention GBP pricing, £40,000, £160,000, reseller rights, commercial rights, license recovery, or deployment economics in cold first-touch/follow-up copy. Pricing belongs only after the buyer asks or a call is booked.',
      'Do not ask for a meeting, call, demo, walkthrough, or calendar booking in first-touch copy.',
      'If researchContext has LinkedIn or social context, use it naturally in one sentence.',
      'If competitorSignal exists, phrase it as a category trend, not as a fake customer claim.',
      'Keep the email short, useful, and human; avoid brochure language.',
      'Use one clear question only.',
      'Do not use hype, urgency, discounts, guarantees, or spammy promotional phrasing.',
      'Explain the product benefit in simple words: better visibility, cleaner follow-ups, reduced communication risk, and stronger client trust.',
    ],
  }
  const aiSystem =
    'You are Xavira AI, an elite B2B outbound research and email strategist. Return JSON only with subject, body, and selfScore. Write a cold email that feels manually researched. This is RAG writing, not a template fill: use retrieved facts first and never invent facts. The goal is reply rate, conversation rate, and discovery rate, not meeting-booking rate. Structure the body as four short paragraphs: specific operational observation, operational hypothesis, one brief Xavira sentence, one discovery question. Then sign exactly: Best, Vishnu, Founder, Xavira Tech Labs, If not relevant, no worries. Keep body copy 80-140 words before physical address. The company name must appear at least twice. Mention Xavira once only. Avoid feature lists, hype, technical jargon, pricing, booking links, meeting asks, fake personalization, spam tricks, and buzzwords. Score observationQuality, hypothesisQuality, personaRelevance, and conversationPotential from 0-100; if any score is below 85, rewrite before returning.'

  type AiCopyResponse = {
    subject?: string
    body?: string
    reason?: string
    selfScore?: Partial<SovereignConversationSelfScore>
  }

  const fallbackData: AiCopyResponse = {
    subject: fallbackSubject,
    body: fallbackText,
    reason: 'fallback_template',
  }
  const requestAiCopy = (rewriteInstruction?: string) =>
    tryXaviraAiJson<AiCopyResponse>({
        task: 'sovereign_outbound_copy',
        system: aiSystem,
        user: JSON.stringify({
          ...aiPayloadBase,
          rewriteInstruction,
        }),
        fallback: fallbackData,
        timeoutMs: 5_000,
      })

  let result = shouldUseXaviraAi
    ? await requestAiCopy()
    : {
        source: 'fallback' as const,
        provider: 'fallback' as const,
        data: fallbackData,
        error: 'xavira_ai_disabled',
  }

  let quality: SovereignConversationQualityResult | null = null
  if (result.source === 'xavira_ai') {
    quality = evaluateColdConversationQuality(
      String(result.data.body ?? ''),
      String(company),
      copyDecision.persona,
      result.data.selfScore
    )

    if (!quality.ok) {
      const retry = await requestAiCopy(
        `Previous draft failed quality gate: ${quality.reasons.join(', ')}. Regenerate from the buyer intelligence only. Keep one observation, one hypothesis, one Xavira sentence, and one discovery question.`
      )
      if (retry.source === 'xavira_ai') {
        const retryQuality = evaluateColdConversationQuality(
          String(retry.data.body ?? ''),
          String(company),
          copyDecision.persona,
          retry.data.selfScore
        )
        if (retryQuality.ok) {
          result = retry
          quality = retryQuality
        } else {
          quality = retryQuality
        }
      }
    }
  }

  if (result.source !== 'xavira_ai') {
    const text = options.includeBookingCta ? withSovereignBookingCta(fallbackText) : fallbackText.trim()
    return {
      subject: fallbackSubject,
      text,
      html: renderSovereignHtmlEmail(text),
      source: 'template',
      error: result.error,
    }
  }

  const rawAiBody = String(result.data.body ?? '').trim()
  quality = quality ?? evaluateColdConversationQuality(
    rawAiBody,
    String(company),
    copyDecision.persona,
    result.data.selfScore
  )
  if (!quality.ok) {
    const text = options.includeBookingCta ? withSovereignBookingCta(fallbackText) : fallbackText.trim()
    return {
      subject: fallbackSubject,
      text,
      html: renderSovereignHtmlEmail(text),
      source: 'template',
      error: `xavira_ai_quality_rejected:${quality.reasons.slice(0, 6).join(',')}`,
    }
  }

  const text = cleanBody(result.data.body, fallbackText, options.physicalAddress, {
    includeBookingCta: options.includeBookingCta,
  })
  return {
    subject: cleanSubject(result.data.subject, fallbackSubject),
    text,
    html: renderSovereignHtmlEmail(text),
    source: 'xavira_ai',
  }
}
