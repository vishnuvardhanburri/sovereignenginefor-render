import type { ContactInput } from '@/lib/backend'

export type LeadScoutIndustry =
  | 'saas'
  | 'agency'
  | 'cybersecurity'
  | 'ai'
  | 'devtools'
  | 'ecommerce'
  | 'fintech'

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
]

const PERSONA_MAILBOXES: Record<LeadScoutPersona, string[]> = {
  founder: ['founders', 'founder', 'hello', 'contact'],
  growth: ['growth', 'marketing', 'demandgen', 'hello'],
  partnerships: ['partnerships', 'partners', 'bizdev', 'hello'],
  sales: ['sales', 'revenue', 'hello', 'contact'],
  operations: ['ops', 'operations', 'admin', 'hello'],
}

function normalizeIndustry(input?: string): LeadScoutIndustry {
  const value = String(input || 'saas').trim().toLowerCase()
  if (value in INDUSTRY_ALIASES) return INDUSTRY_ALIASES[value]
  if (['saas', 'agency', 'cybersecurity', 'ai', 'devtools', 'ecommerce', 'fintech'].includes(value)) {
    return value as LeadScoutIndustry
  }
  return 'saas'
}

function normalizePersona(input?: string): LeadScoutPersona {
  const value = String(input || 'founder').trim().toLowerCase()
  if (['founder', 'growth', 'partnerships', 'sales', 'operations'].includes(value)) {
    return value as LeadScoutPersona
  }
  return 'founder'
}

function normalizeRegion(input?: string): string {
  return String(input || 'global').trim().toLowerCase()
}

function clampLimit(value?: number): number {
  const limit = Number(value ?? 25)
  if (!Number.isFinite(limit)) return 25
  return Math.min(Math.max(Math.trunc(limit), 1), 100)
}

function clampOffset(value?: number): number {
  const offset = Number(value ?? 0)
  if (!Number.isFinite(offset)) return 0
  return Math.max(Math.trunc(offset), 0)
}

function scoreSeed(seed: CompanySeed, industry: LeadScoutIndustry, region: string): number {
  let score = seed.industries.includes(industry) ? 76 : 45
  if (seed.region === region) score += 10
  if (seed.region === 'global') score += 8
  if (seed.industries.length > 1) score += 4
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
      lead_scout: true,
      fit_score: lead.fitScore,
      confidence: lead.confidence,
      reason_to_contact: lead.reason,
      approval_required: true,
      send_status: 'not_approved',
      data_source: 'owned_open_lead_graph',
    },
  }))
}
