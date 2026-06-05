export const DEFAULT_TARGET_MARKETS = [
  'United States',
  'Canada',
  'United Kingdom',
  'Ireland',
  'Germany',
  'Netherlands',
  'France',
  'Switzerland',
  'Sweden',
  'Norway',
  'Denmark',
  'Finland',
  'Belgium',
  'Austria',
  'Australia',
  'New Zealand',
  'Singapore',
  'United Arab Emirates',
] as const

const INDIA_MARKET_RE =
  /\b(?:india|indian|bharat|bengaluru|bangalore|mumbai|delhi|new delhi|gurugram|gurgaon|hyderabad|chennai|pune|noida|ahmedabad|kolkata)\b/i

const HIGH_PAYING_MARKET_RE =
  /\b(?:united states|usa|u\.s\.|us market|america|canada|united kingdom|uk|britain|england|ireland|australia|new zealand|singapore|united arab emirates|uae|dubai|germany|netherlands|france|europe|european|eu|switzerland|sweden|norway|denmark|finland|belgium|austria)\b/i

const TARGET_COUNTRY_TLD_RE =
  /\.(?:us|ca|uk|ie|de|nl|fr|ch|se|no|dk|fi|be|at|au|nz|sg|ae)$/i

const GLOBAL_PAYING_TLD_RE =
  /\.(?:com|io|ai|co|net|org|dev|cloud|software|tech)$/i

function allowIndiaLeads(): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.ALLOW_INDIA_LEADS ?? '').toLowerCase())
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function envMarketList(): string[] {
  const raw = process.env.TARGET_CLIENT_MARKETS || process.env.LEAD_TARGET_MARKETS || ''
  const values = raw
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean)
  return values.length ? values : [...DEFAULT_TARGET_MARKETS]
}

export function targetMarketSearchRegions(): string[] {
  return envMarketList().filter((market) => !INDIA_MARKET_RE.test(market))
}

export function normalizePayingMarketRegion(input?: string | null): string {
  const value = String(input || '').trim()
  if (!value || /^(global|foreign|international|worldwide|all)$/i.test(value) || INDIA_MARKET_RE.test(value)) {
    return targetMarketSearchRegions()[0] || 'United States'
  }
  return value
}

export function isIndiaMarketDomain(domain: string): boolean {
  const normalized = domain.trim().toLowerCase().replace(/^www\./, '')
  return normalized === 'in' || normalized.endsWith('.in') || normalized.endsWith('.co.in')
}

function normalizedDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, '')
}

function hasExplicitTargetMarket(customFields?: Record<string, unknown> | null): boolean {
  if (!customFields) return false
  return (
    customFields.target_market === true ||
    customFields.target_market === 'true' ||
    customFields.target_region === 'us_foreign_paying_market'
  )
}

export function containsIndiaMarketSignal(...values: unknown[]): boolean {
  if (allowIndiaLeads()) return false
  const text = values
    .map((value) => {
      if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).join(' ')
      return asString(value)
    })
    .filter(Boolean)
    .join(' ')
  return INDIA_MARKET_RE.test(text)
}

export function isTargetPayingMarketLead(input: {
  email?: string | null
  domain?: string | null
  company?: string | null
  title?: string | null
  source?: string | null
  region?: string | null
  customFields?: Record<string, unknown> | null
}): boolean {
  if (allowIndiaLeads()) return true
  const emailDomain = String(input.email || '').split('@')[1] || ''
  const domain = normalizedDomain(input.domain || emailDomain)
  if (domain && isIndiaMarketDomain(domain)) return false
  const values = [
    input.company,
    input.title,
    input.source,
    input.region,
    input.customFields,
  ]
  if (containsIndiaMarketSignal(...values)) return false
  if (hasExplicitTargetMarket(input.customFields)) return true
  if (HIGH_PAYING_MARKET_RE.test(values.map((value) => {
    if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).join(' ')
    return asString(value)
  }).join(' '))) {
    return true
  }
  return Boolean(domain && (TARGET_COUNTRY_TLD_RE.test(`.${domain.split('.').pop() || ''}`) || GLOBAL_PAYING_TLD_RE.test(`.${domain.split('.').pop() || ''}`)))
}

export function targetMarketScoreBonus(...values: unknown[]): number {
  if (containsIndiaMarketSignal(...values)) return -100
  const text = values
    .map((value) => {
      if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).join(' ')
      return asString(value)
    })
    .filter(Boolean)
    .join(' ')
  return HIGH_PAYING_MARKET_RE.test(text) ? 10 : 0
}
