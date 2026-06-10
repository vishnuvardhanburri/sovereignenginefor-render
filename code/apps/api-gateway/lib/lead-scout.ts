import { resolveMx } from 'node:dns/promises'
import type { ContactInput } from '@/lib/backend'
import {
  isTargetPayingMarketLead,
  normalizePayingMarketRegion,
  targetMarketScoreBonus,
} from '@/lib/target-market'

export type LeadScoutIndustry =
  | 'saas'
  | 'agency'
  | 'cybersecurity'
  | 'ai'
  | 'devtools'
  | 'ecommerce'
  | 'fintech'
  | 'automotive'

export type LeadScoutPersona =
  | 'founder'
  | 'growth'
  | 'partnerships'
  | 'sales'
  | 'operations'

export interface LeadScoutRequest {
  industry?: string
  region?: string
  persona?: string
  limit?: number
  offset?: number
}

export interface OpenLead {
  email: string
  company: string
  companyDomain: string
  title: string
  source: string
  fitScore: number
  reason: string
  confidence: 'high' | 'medium' | 'low'
  emailEvidence?:
    | 'business_domain_role_pattern'
    | 'public_page_email_match'
    | 'public_mailto_match'
    | 'public_domain_email'
    | 'synthetic_role_pattern'
  publicEvidenceUrl?: string
  autoApprovalEligible?: boolean
}

export interface VerifyOpenLeadEvidenceOptions {
  /**
   * Hard budget for the whole evidence verification batch. Cron must return
   * even when public websites are slow, offline, or blocking bots.
   */
  deadlineMs?: number
  maxPagesPerLead?: number
  requestTimeoutMs?: number
}

interface CompanySeed {
  company: string
  domain: string
  industries: LeadScoutIndustry[]
  region: 'us' | 'eu' | 'india' | 'global'
  signals: string[]
}

const INDUSTRY_ALIASES: Record<string, LeadScoutIndustry> = {
  b2b: 'saas',
  software: 'saas',
  startup: 'saas',
  startups: 'saas',
  outbound: 'saas',
  marketing: 'agency',
  agencies: 'agency',
  security: 'cybersecurity',
  cyber: 'cybersecurity',
  infosec: 'cybersecurity',
  genai: 'ai',
  llm: 'ai',
  ml: 'ai',
  developer: 'devtools',
  infrastructure: 'devtools',
  cloud: 'devtools',
  commerce: 'ecommerce',
  retail: 'ecommerce',
  finance: 'fintech',
  payments: 'fintech',
  auto: 'automotive',
  automotive: 'automotive',
  car: 'automotive',
  cars: 'automotive',
  dealer: 'automotive',
  dealership: 'automotive',
  dealerships: 'automotive',
  fleet: 'automotive',
}

const COMPANY_SEEDS: CompanySeed[] = [
  { company: 'HubSpot', domain: 'hubspot.com', industries: ['saas'], region: 'us', signals: ['crm', 'marketing automation', 'sales ops'] },
  { company: 'Pipedrive', domain: 'pipedrive.com', industries: ['saas'], region: 'eu', signals: ['crm', 'sales pipeline', 'growth teams'] },
  { company: 'Calendly', domain: 'calendly.com', industries: ['saas'], region: 'us', signals: ['meeting scheduling', 'sales workflow'] },
  { company: 'Gong', domain: 'gong.io', industries: ['saas'], region: 'us', signals: ['sales intelligence', 'revenue operations'] },
  { company: 'Salesloft', domain: 'salesloft.com', industries: ['saas'], region: 'us', signals: ['sales engagement', 'outbound teams'] },
  { company: 'Outreach', domain: 'outreach.io', industries: ['saas'], region: 'us', signals: ['sales engagement', 'outbound operations'] },
  { company: 'Apollo', domain: 'apollo.io', industries: ['saas'], region: 'us', signals: ['go-to-market', 'prospecting workflow'] },
  { company: 'Lemlist', domain: 'lemlist.com', industries: ['saas'], region: 'eu', signals: ['outbound campaigns', 'deliverability aware'] },
  { company: 'Clay', domain: 'clay.com', industries: ['saas', 'ai'], region: 'us', signals: ['data enrichment', 'growth infrastructure'] },
  { company: 'Intercom', domain: 'intercom.com', industries: ['saas'], region: 'global', signals: ['customer messaging', 'growth operations'] },
  { company: 'Zendesk', domain: 'zendesk.com', industries: ['saas'], region: 'global', signals: ['customer operations', 'support workflows'] },
  { company: 'Freshworks', domain: 'freshworks.com', industries: ['saas'], region: 'india', signals: ['crm', 'support software', 'global sales'] },
  { company: 'Chargebee', domain: 'chargebee.com', industries: ['saas', 'fintech'], region: 'global', signals: ['subscription billing', 'revenue infrastructure'] },
  { company: 'Paddle', domain: 'paddle.com', industries: ['saas', 'fintech'], region: 'eu', signals: ['merchant of record', 'software revenue'] },
  { company: 'Amplitude', domain: 'amplitude.com', industries: ['saas'], region: 'us', signals: ['product analytics', 'growth teams'] },
  { company: 'Mixpanel', domain: 'mixpanel.com', industries: ['saas'], region: 'us', signals: ['product analytics', 'retention'] },
  { company: 'ClickUp', domain: 'clickup.com', industries: ['saas'], region: 'us', signals: ['productivity', 'team operations'] },
  { company: 'Notion', domain: 'notion.so', industries: ['saas'], region: 'us', signals: ['workspace software', 'team collaboration'] },
  { company: 'Monday.com', domain: 'monday.com', industries: ['saas'], region: 'global', signals: ['work management', 'enterprise sales'] },
  { company: 'WebFX', domain: 'webfx.com', industries: ['agency'], region: 'us', signals: ['digital marketing', 'lead generation'] },
  { company: 'Single Grain', domain: 'singlegrain.com', industries: ['agency'], region: 'us', signals: ['growth marketing', 'b2b demand gen'] },
  { company: 'Directive Consulting', domain: 'directiveconsulting.com', industries: ['agency'], region: 'us', signals: ['saas marketing', 'demand generation'] },
  { company: 'KlientBoost', domain: 'klientboost.com', industries: ['agency'], region: 'us', signals: ['paid acquisition', 'conversion optimization'] },
  { company: 'Power Digital', domain: 'powerdigitalmarketing.com', industries: ['agency'], region: 'us', signals: ['growth marketing', 'digital strategy'] },
  { company: 'Thrive Agency', domain: 'thriveagency.com', industries: ['agency'], region: 'us', signals: ['digital marketing', 'seo'] },
  { company: 'SmartBug Media', domain: 'smartbugmedia.com', industries: ['agency'], region: 'us', signals: ['inbound marketing', 'revenue operations'] },
  { company: 'Ignite Visibility', domain: 'ignitevisibility.com', industries: ['agency'], region: 'us', signals: ['performance marketing', 'seo'] },
  { company: 'Belkins', domain: 'belkins.io', industries: ['agency'], region: 'us', signals: ['appointment setting', 'b2b lead generation'] },
  { company: 'SalesRoads', domain: 'salesroads.com', industries: ['agency'], region: 'us', signals: ['sales outsourcing', 'appointment setting'] },
  { company: 'DemandZEN', domain: 'demandzen.com', industries: ['agency'], region: 'us', signals: ['b2b demand generation', 'sales development'] },
  { company: 'SalesHive', domain: 'saleshive.com', industries: ['agency'], region: 'us', signals: ['sales development', 'lead generation'] },
  { company: 'MarketOne International', domain: 'marketone.com', industries: ['agency'], region: 'global', signals: ['demand generation', 'b2b marketing operations'] },
  { company: 'Martal Group', domain: 'martal.ca', industries: ['agency'], region: 'global', signals: ['b2b lead generation', 'sales outsourcing'] },
  { company: 'Callbox', domain: 'callboxinc.com', industries: ['agency'], region: 'global', signals: ['lead generation', 'appointment setting'] },
  { company: 'Leadium', domain: 'leadium.com', industries: ['agency'], region: 'us', signals: ['outbound sales', 'lead generation'] },
  { company: 'RevBoss', domain: 'revboss.com', industries: ['agency'], region: 'us', signals: ['sales development', 'outbound campaigns'] },
  { company: 'LeadGenius', domain: 'leadgenius.com', industries: ['agency'], region: 'us', signals: ['sales intelligence', 'lead generation'] },
  { company: 'Cience', domain: 'cience.com', industries: ['agency'], region: 'us', signals: ['outbound sales', 'b2b lead generation'] },
  { company: 'EBQ', domain: 'ebq.com', industries: ['agency'], region: 'us', signals: ['sales outsourcing', 'marketing support'] },
  { company: 'Abstrakt Marketing Group', domain: 'abstraktmg.com', industries: ['agency'], region: 'us', signals: ['b2b lead generation', 'sales development'] },
  { company: 'JumpCrew', domain: 'jumpcrew.com', industries: ['agency'], region: 'us', signals: ['sales growth', 'marketing services'] },
  { company: 'MarketJoy', domain: 'marketjoy.com', industries: ['agency'], region: 'us', signals: ['sales development', 'pipeline generation'] },
  { company: 'Bant.io', domain: 'bant.io', industries: ['agency'], region: 'eu', signals: ['b2b lead generation', 'sales automation'] },
  { company: 'Operatix', domain: 'operatix.net', industries: ['agency'], region: 'global', signals: ['sales development', 'technology marketing'] },
  { company: 'GrowthGenius', domain: 'growthgenius.com', industries: ['agency'], region: 'global', signals: ['b2b sales development', 'pipeline generation'] },
  { company: 'LeadCookie', domain: 'leadcookie.com', industries: ['agency'], region: 'us', signals: ['linkedin lead generation', 'outbound prospecting'] },
  { company: 'Cleverly', domain: 'cleverly.co', industries: ['agency'], region: 'us', signals: ['linkedin outreach', 'lead generation'] },
  { company: 'DemandScience', domain: 'demandscience.com', industries: ['agency'], region: 'us', signals: ['b2b demand generation', 'data-driven marketing'] },
  { company: 'PureB2B', domain: 'pureb2b.com', industries: ['agency'], region: 'us', signals: ['b2b demand generation', 'content syndication'] },
  { company: 'RevenueZen', domain: 'revenuezen.com', industries: ['agency'], region: 'us', signals: ['b2b growth marketing', 'seo and outbound'] },
  { company: 'Refine Labs', domain: 'refinelabs.com', industries: ['agency'], region: 'us', signals: ['demand generation', 'revenue strategy'] },
  { company: 'New Breed', domain: 'newbreedrevenue.com', industries: ['agency'], region: 'us', signals: ['revenue operations', 'hubspot consulting'] },
  { company: 'Aptitude 8', domain: 'aptitude8.com', industries: ['agency'], region: 'us', signals: ['revops consulting', 'hubspot operations'] },
  { company: 'RevPartners', domain: 'revpartners.io', industries: ['agency'], region: 'us', signals: ['revenue operations', 'hubspot consulting'] },
  { company: 'Go Nimbly', domain: 'go-nimbly.com', industries: ['agency'], region: 'us', signals: ['revops operations', 'salesforce consulting'] },
  { company: 'Six & Flow', domain: 'sixandflow.com', industries: ['agency'], region: 'eu', signals: ['hubspot consulting', 'growth marketing'] },
  { company: 'Winning by Design', domain: 'winningbydesign.com', industries: ['agency'], region: 'global', signals: ['revenue consulting', 'sales process'] },
  { company: 'Skaled Consulting', domain: 'skaled.com', industries: ['agency'], region: 'us', signals: ['sales consulting', 'revenue operations'] },
  { company: 'Tinuiti', domain: 'tinuiti.com', industries: ['agency'], region: 'us', signals: ['performance marketing', 'retail media'] },
  { company: 'Wpromote', domain: 'wpromote.com', industries: ['agency'], region: 'us', signals: ['performance marketing', 'digital growth'] },
  { company: 'Seer Interactive', domain: 'seerinteractive.com', industries: ['agency'], region: 'us', signals: ['search marketing', 'analytics'] },
  { company: 'Brafton', domain: 'brafton.com', industries: ['agency'], region: 'us', signals: ['content marketing', 'b2b marketing'] },
  { company: 'WebMechanix', domain: 'webmechanix.com', industries: ['agency'], region: 'us', signals: ['performance marketing', 'demand generation'] },
  { company: 'Ironpaper', domain: 'ironpaper.com', industries: ['agency'], region: 'us', signals: ['b2b marketing', 'lead generation'] },
  { company: 'Silverback Strategies', domain: 'silverbackstrategies.com', industries: ['agency'], region: 'us', signals: ['performance marketing', 'digital strategy'] },
  { company: '97th Floor', domain: '97thfloor.com', industries: ['agency'], region: 'us', signals: ['digital marketing', 'seo and content'] },
  { company: 'Straight North', domain: 'straightnorth.com', industries: ['agency'], region: 'us', signals: ['lead generation', 'seo'] },
  { company: 'Coalition Technologies', domain: 'coalitiontechnologies.com', industries: ['agency'], region: 'us', signals: ['seo', 'web design'] },
  { company: 'OuterBox', domain: 'outerboxdesign.com', industries: ['agency'], region: 'us', signals: ['ecommerce marketing', 'seo'] },
  { company: 'Victorious', domain: 'victorious.com', industries: ['agency'], region: 'us', signals: ['seo agency', 'organic growth'] },
  { company: 'Siege Media', domain: 'siegemedia.com', industries: ['agency'], region: 'us', signals: ['content marketing', 'seo'] },
  { company: 'Animalz', domain: 'animalz.co', industries: ['agency'], region: 'us', signals: ['content marketing', 'b2b saas'] },
  { company: 'Gorilla 76', domain: 'gorilla76.com', industries: ['agency'], region: 'us', signals: ['industrial marketing', 'b2b growth'] },
  { company: 'Altitude Marketing', domain: 'altitudemarketing.com', industries: ['agency'], region: 'us', signals: ['b2b marketing', 'lead generation'] },
  { company: 'Brainlabs', domain: 'brainlabsdigital.com', industries: ['agency'], region: 'eu', signals: ['performance marketing', 'paid media'] },
  { company: 'Croud', domain: 'croud.com', industries: ['agency'], region: 'eu', signals: ['digital marketing', 'performance media'] },
  { company: 'Jellyfish', domain: 'jellyfish.com', industries: ['agency'], region: 'eu', signals: ['digital marketing', 'platform services'] },
  { company: 'Impression', domain: 'impressiondigital.com', industries: ['agency'], region: 'eu', signals: ['performance marketing', 'digital pr'] },
  { company: 'Builtvisible', domain: 'builtvisible.com', industries: ['agency'], region: 'eu', signals: ['seo', 'content strategy'] },
  { company: 'Hallam', domain: 'hallam.agency', industries: ['agency'], region: 'eu', signals: ['digital marketing', 'strategy'] },
  { company: 'Connective3', domain: 'connective3.com', industries: ['agency'], region: 'eu', signals: ['performance marketing', 'digital pr'] },
  { company: 'Gravity Global', domain: 'gravityglobal.com', industries: ['agency'], region: 'global', signals: ['b2b marketing', 'brand and demand'] },
  { company: 'Found', domain: 'found.co.uk', industries: ['agency'], region: 'eu', signals: ['digital marketing', 'performance growth'] },
  { company: 'Passion Digital', domain: 'passion.digital', industries: ['agency'], region: 'eu', signals: ['performance marketing', 'seo'] },
  { company: 'Wiz', domain: 'wiz.io', industries: ['cybersecurity'], region: 'global', signals: ['cloud security', 'enterprise security'] },
  { company: 'Snyk', domain: 'snyk.io', industries: ['cybersecurity', 'devtools'], region: 'global', signals: ['developer security', 'software supply chain'] },
  { company: 'CrowdStrike', domain: 'crowdstrike.com', industries: ['cybersecurity'], region: 'us', signals: ['endpoint security', 'enterprise security'] },
  { company: 'SentinelOne', domain: 'sentinelone.com', industries: ['cybersecurity'], region: 'us', signals: ['endpoint security', 'soc operations'] },
  { company: 'Okta', domain: 'okta.com', industries: ['cybersecurity', 'saas'], region: 'us', signals: ['identity', 'enterprise security'] },
  { company: 'Cloudflare', domain: 'cloudflare.com', industries: ['cybersecurity', 'devtools'], region: 'global', signals: ['network security', 'edge infrastructure'] },
  { company: 'Zscaler', domain: 'zscaler.com', industries: ['cybersecurity'], region: 'global', signals: ['zero trust', 'enterprise security'] },
  { company: '1Password', domain: '1password.com', industries: ['cybersecurity'], region: 'global', signals: ['password management', 'security operations'] },
  { company: 'Bitwarden', domain: 'bitwarden.com', industries: ['cybersecurity'], region: 'global', signals: ['password management', 'security tools'] },
  { company: 'Anthropic', domain: 'anthropic.com', industries: ['ai'], region: 'us', signals: ['ai infrastructure', 'enterprise ai'] },
  { company: 'Mistral AI', domain: 'mistral.ai', industries: ['ai'], region: 'eu', signals: ['foundation models', 'enterprise ai'] },
  { company: 'Hugging Face', domain: 'huggingface.co', industries: ['ai', 'devtools'], region: 'global', signals: ['model hub', 'developer community'] },
  { company: 'Replicate', domain: 'replicate.com', industries: ['ai', 'devtools'], region: 'us', signals: ['model deployment', 'ai infra'] },
  { company: 'Modal', domain: 'modal.com', industries: ['ai', 'devtools'], region: 'us', signals: ['serverless compute', 'ai workloads'] },
  { company: 'LangChain', domain: 'langchain.com', industries: ['ai', 'devtools'], region: 'us', signals: ['agent framework', 'llm apps'] },
  { company: 'Pinecone', domain: 'pinecone.io', industries: ['ai', 'devtools'], region: 'us', signals: ['vector database', 'ai retrieval'] },
  { company: 'Weaviate', domain: 'weaviate.io', industries: ['ai', 'devtools'], region: 'eu', signals: ['vector search', 'ai data'] },
  { company: 'Vercel', domain: 'vercel.com', industries: ['devtools'], region: 'global', signals: ['frontend cloud', 'developer platform'] },
  { company: 'Netlify', domain: 'netlify.com', industries: ['devtools'], region: 'global', signals: ['web platform', 'developer workflow'] },
  { company: 'Render', domain: 'render.com', industries: ['devtools'], region: 'us', signals: ['cloud hosting', 'developer platform'] },
  { company: 'Railway', domain: 'railway.app', industries: ['devtools'], region: 'us', signals: ['developer cloud', 'deployments'] },
  { company: 'Fly.io', domain: 'fly.io', industries: ['devtools'], region: 'global', signals: ['edge compute', 'developer operations'] },
  { company: 'Supabase', domain: 'supabase.com', industries: ['devtools'], region: 'global', signals: ['database platform', 'developer backend'] },
  { company: 'Neon', domain: 'neon.tech', industries: ['devtools'], region: 'global', signals: ['serverless postgres', 'developer data'] },
  { company: 'Upstash', domain: 'upstash.com', industries: ['devtools'], region: 'global', signals: ['redis', 'serverless data'] },
  { company: 'Temporal', domain: 'temporal.io', industries: ['devtools'], region: 'global', signals: ['durable workflows', 'backend reliability'] },
  { company: 'PlanetScale', domain: 'planetscale.com', industries: ['devtools'], region: 'us', signals: ['database platform', 'developer infrastructure'] },
  { company: 'Shopify', domain: 'shopify.com', industries: ['ecommerce', 'saas'], region: 'global', signals: ['commerce platform', 'merchant growth'] },
  { company: 'BigCommerce', domain: 'bigcommerce.com', industries: ['ecommerce', 'saas'], region: 'global', signals: ['commerce platform', 'merchant operations'] },
  { company: 'Klaviyo', domain: 'klaviyo.com', industries: ['ecommerce', 'saas'], region: 'global', signals: ['email marketing', 'commerce growth'] },
  { company: 'Attentive', domain: 'attentive.com', industries: ['ecommerce', 'saas'], region: 'us', signals: ['sms marketing', 'commerce messaging'] },
  { company: 'Stripe', domain: 'stripe.com', industries: ['fintech', 'devtools'], region: 'global', signals: ['payments', 'developer platform'] },
  { company: 'Razorpay', domain: 'razorpay.com', industries: ['fintech'], region: 'india', signals: ['payments', 'india businesses'] },
  { company: 'Brex', domain: 'brex.com', industries: ['fintech', 'saas'], region: 'us', signals: ['spend management', 'startup finance'] },
  { company: 'Mercury', domain: 'mercury.com', industries: ['fintech'], region: 'us', signals: ['startup banking', 'founder operations'] },
  { company: 'DealerOn', domain: 'dealeron.com', industries: ['automotive', 'saas'], region: 'us', signals: ['dealer websites', 'automotive marketing'] },
  { company: 'Dealer Inspire', domain: 'dealerinspire.com', industries: ['automotive', 'agency'], region: 'us', signals: ['automotive digital retail', 'dealer marketing'] },
  { company: 'Cox Automotive', domain: 'coxautoinc.com', industries: ['automotive'], region: 'us', signals: ['vehicle marketplaces', 'dealer operations'] },
  { company: 'Cars Commerce', domain: 'carscommerce.inc', industries: ['automotive', 'saas'], region: 'us', signals: ['automotive commerce', 'dealer growth'] },
  { company: 'AutoLeadStar', domain: 'autoleadstar.com', industries: ['automotive', 'agency'], region: 'global', signals: ['automotive lead generation', 'dealer advertising'] },
  { company: 'Tekion', domain: 'tekion.com', industries: ['automotive', 'saas'], region: 'us', signals: ['dealer management systems', 'automotive cloud'] },
]

const PERSONA_MAILBOXES: Record<LeadScoutPersona, string[]> = {
  founder: ['business', 'sales', 'partnerships'],
  growth: ['growth', 'marketing', 'sales'],
  partnerships: ['partnerships', 'partners', 'business'],
  sales: ['sales', 'business', 'growth'],
  operations: ['operations', 'business', 'sales'],
}

const PUBLIC_EVIDENCE_PATHS = [
  '/',
  '/contact/',
  '/contact',
  '/contact-us',
  '/contact-us/',
  '/contact/sales',
  '/sales',
  '/sales/',
  '/demo',
  '/get-in-touch',
  '/connect',
  '/about',
  '/about-us',
  '/company',
  '/team',
  '/partners',
  '/partnerships',
  '/partner',
  '/connect',
]

const SITEMAP_PATHS = ['/sitemap.xml', '/sitemap_index.xml']

const PUBLIC_EVIDENCE_LINK_KEYWORDS = [
  'about',
  'bizdev',
  'business-development',
  'connect',
  'contact',
  'contact-us',
  'growth',
  'partner',
  'partnership',
  'sales',
  'team',
]

const HIGH_SIGNAL_PATH_RE =
  /\b(?:contact|contact-us|get-in-touch|sales|demo|partners?|partnerships?|team|about|company|connect)\b/i

const HIGH_SIGNAL_TEXT_RE =
  /\b(?:book\s+a\s+demo|contact\s+(?:sales|us)|get\s+in\s+touch|partner(?:ship)?s?|growth|sales\s+team|business\s+development|go[-\s]?to[-\s]?market|revenue\s+operations|outbound|lead\s+generation|deliverability|cybersecurity|ai\s+governance|compliance)\b/i

const BLOCKED_PUBLIC_EMAIL_PREFIXES = new Set([
  'abuse',
  'admin',
  'billing',
  'careers',
  'compliance',
  'copyright',
  'dmca',
  'dpo',
  'feedback',
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

const DOMAIN_MAIL_EXCHANGE_CACHE = new Map<string, Promise<boolean>>()

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeout: NodeJS.Timeout | undefined
  const timer = new Promise<T>((resolve) => {
    timeout = setTimeout(() => resolve(fallback), Math.max(25, timeoutMs))
  })

  return Promise.race([promise, timer]).finally(() => {
    if (timeout) clearTimeout(timeout)
  })
}

function normalizeIndustry(input?: string): LeadScoutIndustry {
  const value = String(input || 'agency').trim().toLowerCase()
  if (value in INDUSTRY_ALIASES) return INDUSTRY_ALIASES[value]
  if (['saas', 'agency', 'cybersecurity', 'ai', 'devtools', 'ecommerce', 'fintech', 'automotive'].includes(value)) {
    return value as LeadScoutIndustry
  }
  return 'agency'
}

function normalizePersona(input?: string): LeadScoutPersona {
  const value = String(input || 'founder').trim().toLowerCase()
  if (['founder', 'growth', 'partnerships', 'sales', 'operations'].includes(value)) {
    return value as LeadScoutPersona
  }
  return 'founder'
}

function normalizeRegion(input?: string): string {
  const value = normalizePayingMarketRegion(input).trim().toLowerCase()
  if (/united states|usa|u\.s\.|\bus\b|america/.test(value)) return 'us'
  if (/europe|eu|united kingdom|\buk\b|germany|netherlands|france|sweden|norway|denmark/.test(value)) return 'eu'
  return 'global'
}

function clampLimit(value?: number): number {
  const limit = Number(value ?? 25)
  if (!Number.isFinite(limit)) return 25
  return Math.min(Math.max(Math.trunc(limit), 1), 1_000)
}

function clampOffset(value?: number): number {
  const offset = Number(value ?? 0)
  if (!Number.isFinite(offset)) return 0
  return Math.max(Math.trunc(offset), 0)
}

function scoreSeed(seed: CompanySeed, industry: LeadScoutIndustry, region: string): number {
  if (
    !isTargetPayingMarketLead({
      domain: seed.domain,
      company: seed.company,
      region: seed.region,
      customFields: { signals: seed.signals.join(' ') },
    })
  ) {
    return 0
  }
  let score = seed.industries.includes(industry) ? 76 : 45
  if (seed.region === region) score += 10
  if (seed.region === 'global') score += 8
  if (seed.industries.length > 1) score += 4
  score += targetMarketScoreBonus(seed.company, seed.domain, seed.region, seed.signals.join(' '))
  return Math.min(score, 98)
}

function reasonFor(seed: CompanySeed, industry: LeadScoutIndustry): string {
  const signalText = seed.signals.slice(0, 2).join(', ')
  return `${seed.company} matches ${industry} outreach because it shows public signals around ${signalText}.`
}

function toEmail(domain: string, persona: LeadScoutPersona): string {
  const mailbox = PERSONA_MAILBOXES[persona][0] || 'hello'
  return `${mailbox}@${domain}`
}

function personaFromTitle(title: string): LeadScoutPersona {
  const value = title.toLowerCase()
  if (value.includes('partnership')) return 'partnerships'
  if (value.includes('growth')) return 'growth'
  if (value.includes('sales')) return 'sales'
  if (value.includes('operation')) return 'operations'
  return 'founder'
}

function publicUrl(domain: string, path: string): string {
  return `https://${domain}${path}`
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&commat;|&commat/gi, '@')
    .replace(/&period;|&period/gi, '.')
    .replace(/&dot;|&dot/gi, '.')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
}

function decodeJsEscapes(input: string): string {
  return input
    .replace(/\\u00([0-9a-f]{2})/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/%40/gi, '@')
    .replace(/%2e/gi, '.')
}

function safeDecodeURIComponent(input: string): string {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function decodeCloudflareEmail(hex: string): string | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4) return null
  const key = parseInt(hex.slice(0, 2), 16)
  let decoded = ''
  for (let index = 2; index < hex.length; index += 2) {
    decoded += String.fromCharCode(parseInt(hex.slice(index, index + 2), 16) ^ key)
  }
  return decoded.includes('@') ? decoded : null
}

function stripHtmlTags(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
}

function expandEvidenceText(html: string): string {
  const cloudflareEmails = Array.from(html.matchAll(/data-cfemail=["']([0-9a-f]+)["']/gi))
    .map((match) => decodeCloudflareEmail(String(match[1] || '')))
    .filter((email) => typeof email === 'string' && email.length > 0)
  const mailtoEmails = Array.from(html.matchAll(/mailto:([^"'\s?]+)/gi)).map((match) =>
    safeDecodeURIComponent(String(match[1] || ''))
  )
  const decoded = decodeJsEscapes(decodeHtmlEntities(html))
  const noTags = stripHtmlTags(decoded)
  const compacted = decoded.replace(/<\/?(?:span|strong|b|i|em|small|a|u)[^>]*>/gi, '')

  return [
    html,
    decoded,
    noTags,
    compacted,
    cloudflareEmails.join('\n'),
    mailtoEmails.join('\n'),
  ].join('\n')
}

function extractDomainEmails(html: string, domain: string): string[] {
  const normalizedDomain = domain.toLowerCase()
  const evidenceText = expandEvidenceText(html)
  const decodedHtml = evidenceText
    .replace(/\s*(?:\[at\]|\(at\)|\sat\s)\s*/gi, '@')
    .replace(/\s*(?:\[dot\]|\(dot\)|\sdot\s)\s*/gi, '.')
  const matches = `${evidenceText}\n${decodedHtml}`.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
  const unique = new Set<string>()

  for (const match of matches) {
    const email = match.trim().toLowerCase()
    const [prefix, emailDomain] = email.split('@')
    if (emailDomain !== normalizedDomain) continue
    if (!prefix || BLOCKED_PUBLIC_EMAIL_PREFIXES.has(prefix)) continue
    unique.add(email)
  }

  return Array.from(unique)
}

function extractMailtoEmails(html: string, domain: string): string[] {
  const normalizedDomain = domain.toLowerCase()
  return Array.from(html.matchAll(/mailto:([^"'\s?]+)/gi))
    .map((match) => safeDecodeURIComponent(String(match[1] || '')).toLowerCase())
    .filter((email) => {
      const [prefix, emailDomain] = email.split('@')
      return Boolean(prefix && emailDomain === normalizedDomain && !BLOCKED_PUBLIC_EMAIL_PREFIXES.has(prefix))
    })
}

function pickPublicEmail(emails: string[], persona: LeadScoutPersona): string | null {
  const preferred = PERSONA_MAILBOXES[persona]
  const exact = emails.find((email) => preferred.includes(email.split('@')[0] ?? ''))
  return exact ?? emails[0] ?? null
}

function isAllowedInferredBusinessInbox(email: string, persona: LeadScoutPersona): boolean {
  const [prefix = '', domain = ''] = email.toLowerCase().split('@')
  return Boolean(
    prefix &&
    domain &&
    PERSONA_MAILBOXES[persona].includes(prefix) &&
    !BLOCKED_PUBLIC_EMAIL_PREFIXES.has(prefix)
  )
}

function domainHasMailExchange(domain: string): Promise<boolean> {
  const normalized = domain.trim().toLowerCase().replace(/^www\./, '')
  if (!normalized) return Promise.resolve(false)

  const cached = DOMAIN_MAIL_EXCHANGE_CACHE.get(normalized)
  if (cached) return cached

  const lookup = withTimeout(resolveMx(normalized), 1_500, [])
    .then((records) => records.length > 0)
    .catch(() => false)
  DOMAIN_MAIL_EXCHANGE_CACHE.set(normalized, lookup)
  return lookup
}

function isSamePublicDomain(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '')
  const root = domain.toLowerCase().replace(/^www\./, '')
  return host === root || host.endsWith(`.${root}`)
}

function extractEvidenceLinks(html: string, domain: string): string[] {
  const urls = new Map<string, number>()
  const hrefs = html.matchAll(/(?:href|data-href)=["']([^"']+)["']/gi)

  for (const match of hrefs) {
    const rawHref = String(match[1] || '').trim()
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) {
      continue
    }

    try {
      const url = new URL(rawHref, publicUrl(domain, '/'))
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
      if (!isSamePublicDomain(url.hostname, domain)) continue

      const candidate = `${url.pathname}${url.search}`.toLowerCase()
      const nearbyText = html
        .slice(Math.max(0, (match.index ?? 0) - 160), Math.min(html.length, (match.index ?? 0) + 260))
        .toLowerCase()
      const keywordHit = PUBLIC_EVIDENCE_LINK_KEYWORDS.some((keyword) => candidate.includes(keyword))
      const signalHit = HIGH_SIGNAL_TEXT_RE.test(stripHtmlTags(nearbyText))
      if (!keywordHit && !signalHit) continue

      url.hash = ''
      const score =
        (keywordHit ? 20 : 0) +
        (signalHit ? 12 : 0) +
        (HIGH_SIGNAL_PATH_RE.test(candidate) ? 20 : 0) -
        Math.min(candidate.length / 80, 8)
      urls.set(url.toString(), Math.max(urls.get(url.toString()) ?? 0, score))
    } catch {
      // Ignore malformed marketing links; discovery should never block the operator flow.
    }
  }

  return Array.from(urls.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([url]) => url)
    .slice(0, 16)
}

function extractSitemapEvidenceLinks(xml: string, domain: string): string[] {
  const urls = new Map<string, number>()
  const locs = xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)

  for (const match of locs) {
    const rawUrl = decodeHtmlEntities(String(match[1] || '').trim())
    if (!rawUrl) continue

    try {
      const url = new URL(rawUrl)
      if (!isSamePublicDomain(url.hostname, domain)) continue
      const path = url.pathname.toLowerCase()
      if (!PUBLIC_EVIDENCE_LINK_KEYWORDS.some((keyword) => path.includes(keyword))) continue
      url.hash = ''
      const score = (HIGH_SIGNAL_PATH_RE.test(path) ? 30 : 10) - Math.min(path.length / 100, 6)
      urls.set(url.toString(), Math.max(urls.get(url.toString()) ?? 0, score))
    } catch {
      // Ignore malformed sitemap entries.
    }
  }

  return Array.from(urls.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([url]) => url)
    .slice(0, 20)
}

function scoreEvidencePage(url: string, html: string): number {
  const parsed = new URL(url)
  const pathScore = HIGH_SIGNAL_PATH_RE.test(parsed.pathname) ? 40 : 0
  const text = stripHtmlTags(expandEvidenceText(html)).slice(0, 20_000)
  const textScore = HIGH_SIGNAL_TEXT_RE.test(text) ? 25 : 0
  const mailtoScore = /mailto:/i.test(html) ? 20 : 0
  const emailScore = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(expandEvidenceText(html)) ? 30 : 0
  return pathScore + textScore + mailtoScore + emailScore
}

async function fetchEvidencePage(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.8',
        'User-Agent': 'SovereignEngineLeadVerifier/1.0',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) return null
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/html')) return null
    return await response.text()
  } catch {
    return null
  }
}

async function fetchTextResource(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/xml,text/xml,text/plain,*/*',
        'Accept-Language': 'en-US,en;q=0.8',
        'User-Agent': 'SovereignEngineLeadVerifier/1.0',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  }
}

async function discoverSitemapUrls(domain: string, deadlineAt: number, requestTimeoutMs: number): Promise<string[]> {
  const urls = new Set<string>()
  for (const path of SITEMAP_PATHS) {
    const remainingMs = deadlineAt - Date.now()
    if (remainingMs <= 0) break

    const xml = await fetchTextResource(publicUrl(domain, path), Math.min(requestTimeoutMs, remainingMs))
    if (!xml) continue
    for (const url of extractSitemapEvidenceLinks(xml, domain)) {
      urls.add(url)
    }
  }

  return Array.from(urls)
}

async function verifySingleOpenLeadEvidence(
  lead: OpenLead,
  input: {
    deadlineAt: number
    maxPagesPerLead: number
    requestTimeoutMs: number
  }
): Promise<OpenLead> {
  const persona = personaFromTitle(lead.title)
  const inferredEmail = lead.email.toLowerCase()
  const priorityQueue: string[] = []
  const normalQueue = PUBLIC_EVIDENCE_PATHS.map((path) => publicUrl(lead.companyDomain, path))
  const visited = new Set<string>()
  const queued = new Set<string>(normalQueue)
  let sitemapQueued = false
  let bestRelevantEvidenceUrl: string | null = null

  const enqueuePriority = (url: string) => {
    if (queued.has(url) || visited.has(url)) return
    queued.add(url)
    priorityQueue.push(url)
  }

  const nextUrl = () => priorityQueue.shift() ?? normalQueue.shift() ?? null
  const minPageScore = Math.max(
    0,
    Math.min(Number(process.env.LEAD_SCOUT_MIN_EVIDENCE_PAGE_SCORE ?? 0), 80)
  )

  for (let pagesChecked = 0; pagesChecked < input.maxPagesPerLead; pagesChecked += 1) {
    if (Date.now() >= input.deadlineAt) break

    const url = nextUrl()
    if (!url) break
    if (visited.has(url)) continue
    visited.add(url)

    const remainingMs = input.deadlineAt - Date.now()
    if (remainingMs <= 0) break

    const html = await fetchEvidencePage(url, Math.min(input.requestTimeoutMs, remainingMs))
    if (!html) continue

    const pageScore = scoreEvidencePage(url, html)
    if (pageScore >= 25 || url === publicUrl(lead.companyDomain, '/')) {
      bestRelevantEvidenceUrl = bestRelevantEvidenceUrl ?? url
    }
    if (pageScore < minPageScore && url !== publicUrl(lead.companyDomain, '/')) {
      continue
    }

    if (url === publicUrl(lead.companyDomain, '/')) {
      for (const discoveredUrl of extractEvidenceLinks(html, lead.companyDomain)) {
        enqueuePriority(discoveredUrl)
      }

      if (!sitemapQueued && input.maxPagesPerLead >= 4) {
        sitemapQueued = true
        const sitemapUrls = await discoverSitemapUrls(
          lead.companyDomain,
          input.deadlineAt,
          Math.min(input.requestTimeoutMs, 1_000)
        )
        for (const sitemapUrl of sitemapUrls) {
          enqueuePriority(sitemapUrl)
        }
      }
    }

    const expandedText = expandEvidenceText(html)
    const lowerHtml = expandedText.toLowerCase()
    if (lowerHtml.includes(inferredEmail)) {
      return {
        ...lead,
        emailEvidence: 'public_page_email_match',
        publicEvidenceUrl: url,
        autoApprovalEligible: true,
        reason: `${lead.reason} Public evidence confirms ${inferredEmail}.`,
      }
    }

    const mailtoEmail = pickPublicEmail(extractMailtoEmails(html, lead.companyDomain), persona)
    if (mailtoEmail) {
      return {
        ...lead,
        email: mailtoEmail,
        emailEvidence: 'public_mailto_match',
        publicEvidenceUrl: url,
        autoApprovalEligible: true,
        reason: `${lead.reason} Public mailto evidence found on ${url}.`,
      }
    }

    const publicEmail = pickPublicEmail(extractDomainEmails(html, lead.companyDomain), persona)
    if (publicEmail) {
      return {
        ...lead,
        email: publicEmail,
        emailEvidence: 'public_page_email_match',
        publicEvidenceUrl: url,
        autoApprovalEligible: true,
        reason: `${lead.reason} Public contact evidence found on ${url}.`,
      }
    }
  }

  const publicDomainEvidenceUrl = bestRelevantEvidenceUrl ?? lead.publicEvidenceUrl ?? publicUrl(lead.companyDomain, '/')
  if (
    publicDomainEvidenceUrl &&
    isAllowedInferredBusinessInbox(inferredEmail, persona) &&
    await domainHasMailExchange(lead.companyDomain)
  ) {
    return {
      ...lead,
      emailEvidence: 'public_domain_email',
      publicEvidenceUrl: publicDomainEvidenceUrl,
      autoApprovalEligible: true,
      reason: `${lead.reason} Public domain and MX records confirm the business domain; selected safe ${persona} inbox ${inferredEmail}.`,
    }
  }

  return {
    ...lead,
    emailEvidence: 'synthetic_role_pattern',
    autoApprovalEligible: false,
  }
}

export async function verifyOpenLeadEvidence(
  leads: OpenLead[],
  options: VerifyOpenLeadEvidenceOptions = {}
): Promise<OpenLead[]> {
  const deadlineMs = Math.max(100, Math.min(options.deadlineMs ?? 8_000, 60_000))
  const maxPagesPerLead = Math.max(1, Math.min(options.maxPagesPerLead ?? 4, 12))
  const requestTimeoutMs = Math.max(50, Math.min(options.requestTimeoutMs ?? 1_500, 5_000))
  const deadlineAt = Date.now() + deadlineMs
  const concurrency = Math.max(
    1,
    Math.min(Number(process.env.LEAD_SCOUT_VERIFY_CONCURRENCY ?? 6), 24)
  )
  const results = new Array<OpenLead>(leads.length)
  let cursor = 0

  async function worker() {
    while (cursor < leads.length && Date.now() < deadlineAt) {
      const index = cursor
      cursor += 1
      results[index] = await verifySingleOpenLeadEvidence(leads[index], {
        deadlineAt,
        maxPagesPerLead,
        requestTimeoutMs,
      })
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, leads.length) }, () => worker()))

  return results.map((result, index) => result ?? {
    ...leads[index],
    emailEvidence: 'synthetic_role_pattern',
    autoApprovalEligible: false,
  })
}

function unverifiedOpenLeads(leads: OpenLead[]): OpenLead[] {
  return leads.map((lead) => ({
    ...lead,
    emailEvidence: 'synthetic_role_pattern',
    autoApprovalEligible: false,
  }))
}

export async function verifyOpenLeadEvidenceTimeboxed(
  leads: OpenLead[],
  options: VerifyOpenLeadEvidenceOptions = {}
): Promise<OpenLead[]> {
  const fallback = unverifiedOpenLeads(leads)
  const deadlineMs = Math.max(100, Math.min(options.deadlineMs ?? 8_000, 60_000))
  return withTimeout(verifyOpenLeadEvidence(leads, options), deadlineMs + 250, fallback).catch(() => fallback)
}

export function scoutOpenLeads(input: LeadScoutRequest = {}): {
  industry: LeadScoutIndustry
  persona: LeadScoutPersona
  region: string
  leads: OpenLead[]
  model: string
  guardrails: string[]
} {
  const industry = normalizeIndustry(input.industry)
  const persona = normalizePersona(input.persona)
  const region = normalizeRegion(input.region)
  const limit = clampLimit(input.limit)
  const offset = clampOffset(input.offset)

  const rankedSeeds = COMPANY_SEEDS
    .filter((seed) => seed.industries.includes(industry) || industry === 'saas')
    .filter((seed) =>
      isTargetPayingMarketLead({
        domain: seed.domain,
        company: seed.company,
        region: seed.region,
        customFields: { signals: seed.signals.join(' ') },
      })
    )
    .map((seed) => ({
      seed,
      fitScore: scoreSeed(seed, industry, region),
    }))
    .sort((a, b) => b.fitScore - a.fitScore || a.seed.company.localeCompare(b.seed.company))
  const rotatedSeeds = rankedSeeds.length
    ? rankedSeeds.slice(offset % rankedSeeds.length).concat(rankedSeeds.slice(0, offset % rankedSeeds.length))
    : []
  const seeds = rotatedSeeds.slice(0, limit)

  const leads = seeds.map(({ seed, fitScore }) => ({
    email: toEmail(seed.domain, persona),
    company: seed.company,
    companyDomain: seed.domain,
    title: `${persona} team`,
    source: 'open_lead_graph',
    fitScore,
    reason: reasonFor(seed, industry),
    confidence: fitScore >= 85 ? 'high' : fitScore >= 70 ? 'medium' : 'low',
    emailEvidence: 'synthetic_role_pattern',
    publicEvidenceUrl: publicUrl(seed.domain, '/'),
    autoApprovalEligible: false,
  } satisfies OpenLead))

  return {
    industry,
    persona,
    region,
    leads,
    model: 'owned-open-lead-graph-v1',
    guardrails: [
      'No paid lead provider dependency',
      'Generic company inboxes only',
      'No personal email guessing',
      'Manual approval required before sending',
      'Suppression and opt-out remain enforced by sender pipeline',
    ],
  }
}

export function leadScoutToContacts(leads: OpenLead[]): ContactInput[] {
  return leads.map((lead) => ({
    email: lead.email,
    name: '',
    company: lead.company,
    title: lead.title,
    source: lead.source,
    companyDomain: lead.companyDomain,
    customFields: {
      auto_approval_eligible: Boolean(lead.autoApprovalEligible),
      data_source: 'owned_open_lead_graph',
      email_evidence: lead.emailEvidence ?? 'synthetic_role_pattern',
      lead_scout: true,
      target_market: true,
      target_region: 'us_foreign_paying_market',
      fit_score: lead.fitScore,
      confidence: lead.confidence,
      reason_to_contact: lead.reason,
      public_evidence_url: lead.publicEvidenceUrl ?? null,
      lead_quality_warning: lead.autoApprovalEligible
        ? 'Public evidence found; still monitor bounces and complaints.'
        : 'Role inbox inferred from company domain; requires business-safe validation and scoring before queueing.',
      approval_required: true,
      send_status: 'not_approved',
    },
  }))
}
