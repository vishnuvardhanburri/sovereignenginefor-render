import type { ContactInput } from '@/lib/backend'
import type { LeadScoutPersona, OpenLead } from '@/lib/lead-scout'
import {
  isIndiaMarketDomain,
  isTargetPayingMarketLead,
  normalizePayingMarketRegion,
  targetMarketScoreBonus,
} from '@/lib/target-market'

type PublicSearchProvider = 'serpapi' | 'bing_html' | 'duckduckgo_html'

type SerpApiOrganicResult = {
  title?: string
  link?: string
  displayed_link?: string
  snippet?: string
}

type SerpApiResponse = {
  error?: string
  search_metadata?: {
    status?: string
    error?: string
  }
  organic_results?: SerpApiOrganicResult[]
}

type SearchPageResult = {
  results: SerpApiOrganicResult[]
  error?: string
}

export type PublicSearchLeadSearchInput = {
  provider?: PublicSearchProvider
  apiKey?: string
  industry?: string | null
  persona?: string | null
  region?: string | null
  limit?: number
  timeoutMs?: number
  queries?: string[]
}

export type PublicSearchLeadSearchResult = {
  provider: PublicSearchProvider
  industry: string
  persona: LeadScoutPersona
  region: string
  leads: OpenLead[]
  scannedResults: number
  rejected: number
  queriesRun: number
  errors: string[]
  guardrails: string[]
}

const DEFAULT_LIMIT = 250
const MAX_LIMIT = 5_000
const DEFAULT_TIMEOUT_MS = 55_000

const PERSONA_MAILBOXES: Record<LeadScoutPersona, string[]> = {
  founder: ['business', 'sales', 'partnerships'],
  growth: ['growth', 'marketing', 'sales'],
  partnerships: ['partnerships', 'partners', 'business'],
  sales: ['sales', 'business', 'growth'],
  operations: ['operations', 'business', 'sales'],
}

const BLOCKED_HOSTS = new Set([
  'angel.co',
  'apollo.io',
  'apps.apple.com',
  'builtwith.com',
  'capterra.com',
  'clutch.co',
  'crunchbase.com',
  'facebook.com',
  'github.com',
  'glassdoor.com',
  'google.com',
  'g2.com',
  'coursera.org',
  'edx.org',
  'epicgames.com',
  'fandom.com',
  'geeksforgeeks.org',
  'indeed.com',
  'instagram.com',
  'ign.com',
  'investopedia.com',
  'javatpoint.com',
  'linkedin.com',
  'medium.com',
  'nintendo.com',
  'producthunt.com',
  'questdiagnostics.com',
  'reddit.com',
  'saasworthy.com',
  'sports.ndtv.com',
  'steampowered.com',
  'techcrunch.com',
  'thegamesedge.com',
  'theoutbound.com',
  'tutorialspoint.com',
  'twitter.com',
  'udemy.com',
  'wellfound.com',
  'wikily.gg',
  'wikipedia.org',
  'w3schools.com',
  'x.com',
  'xbox.com',
  'yelp.com',
  'youtube.com',
])

const BLOCKED_HOST_PATTERNS = [
  /(^|\.)annuaire\./,
  /(^|\.)fandom\.com$/,
  /(^|\.)findglocal\./,
  /(^|\.)ign\.com$/,
  /(^|\.)meilleursagents\.com$/,
  /(^|\.)ndtv\.com$/,
  /(^|\.)petitesaffiches\.fr$/,
  /(^|\.)rew\.ca$/,
  /(^|\.)zillow\.com$/,
  /(^|\.)zumper\.com$/,
]

const LOW_VALUE_PATH_RE =
  /\b(?:careers?|certification|course|developer-docs|docs?|help|jobs?|legal|login|privacy|signin|signup|support|terms|training)\b/i

const CONTENT_RESULT_RE =
  /\b(?:article|blog|case study|course|definition|explained|guide|how to|intro|introduction|learn|news|resources?|training|tutorial|types of|what is|whitepaper)\b/i

const NON_TARGET_RESULT_RE =
  /\b(?:admission|adventures?\s+near\s+you|adult|apartment|benchmark(?:s|ing)?|building\s+details|camping|classifieds?|cozy\s+open[-\s]?world|crafting|degree|fandom|free\s+porn|game(?:play|s|ing)?|hiking|ign|kickstarter|leaderboard|llm\s+degree|mls\s+listings?|nintendo\s+switch|open[-\s]?world|porn(?:o|hub|ography)?|property|rankings?|real\s+estate|rentals?|schedule\s+appointment|sex\s*(?:chat|dating|site|video|worker)?|sports?|steam|student|survival|template:infobox|traduci|translation|walkthrough|wiki|xnxx|xvideos)\b/i

const BUSINESS_RESULT_RE =
  /\b(?:agency|ai|automation|b2b|clients|cloud|compliance|consulting|cybersecurity|deliverability|demand generation|enterprise|get in touch|growth|infrastructure|lead generation|managed service|mssp|outbound|platform|private ai|revops|sales operations|security operations|services|software|solution|white[-\s]?label)\b/i

const AGENCY_TARGET_RE =
  /\b(?:abm|appointment\s+setting|b2b\s+(?:demand|lead|marketing|sales)|client\s+acquisition|demand\s+generation|done[-\s]?for[-\s]?you\s+outbound|go[-\s]?to[-\s]?market|gtm|lead\s+generation|outbound\s+(?:sales|agency|services?|operator|ops|operations)|revenue\s+operations|revops|sales\s+development|sdr\s+as\s+a\s+service|white[-\s]?label\s+(?:agency|outbound|lead))\b/i

const AI_TARGET_RE =
  /\b(?:agent\s+infrastructure|ai\s+(?:governance|infrastructure|ops|operations|platform|security)|enterprise\s+ai|llm\s+(?:governance|infrastructure|ops|platform)|model\s+governance|private\s+ai|rag\s+infrastructure)\b/i

const CYBERSECURITY_TARGET_RE =
  /\b(?:attack\s+surface|cybersecurity|incident\s+response|managed\s+security|mssp|security\s+(?:operations|platform)|soc|threat\s+(?:detection|intelligence))\b/i

const DEVTOOLS_TARGET_RE =
  /\b(?:cloud\s+infrastructure|developer\s+(?:platform|tools)|devops|infrastructure\s+(?:automation|platform)|observability|platform\s+engineering|workflow\s+orchestration)\b/i

const SAAS_TARGET_RE =
  /\b(?:b2b\s+saas|customer\s+engagement|enterprise\s+saas|revenue\s+operations|sales\s+engagement|workflow\s+platform)\b/i

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(Math.trunc(parsed), max))
}

function normalizePersona(input?: string | null): LeadScoutPersona {
  const value = String(input || 'founder').trim().toLowerCase()
  if (['founder', 'growth', 'partnerships', 'sales', 'operations'].includes(value)) {
    return value as LeadScoutPersona
  }
  return 'founder'
}

function normalizeIndustry(input?: string | null): string {
  const value = String(input || 'agency').trim().toLowerCase()
  if (!value) return 'agency'
  if (['b2b', 'marketing', 'revops', 'outbound', 'leadgen'].includes(value)) return 'agency'
  if (['security', 'cyber', 'infosec'].includes(value)) return 'cybersecurity'
  if (['developer', 'infrastructure', 'cloud'].includes(value)) return 'devtools'
  return value.replace(/[^a-z0-9 -]/g, '').slice(0, 48) || 'agency'
}

function normalizeRegion(input?: string | null): string {
  return normalizePayingMarketRegion(input)
}

function glForRegion(region: string): string {
  const value = region.toLowerCase()
  if (value.includes('india')) return 'in'
  if (value.includes('united kingdom') || value === 'uk') return 'uk'
  if (value.includes('canada')) return 'ca'
  if (value.includes('australia')) return 'au'
  return 'us'
}

function companyFromDomain(domain: string): string {
  return domain
    .split('.')[0]
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function looksLikeContentResult(result: Pick<SerpApiOrganicResult, 'title' | 'snippet' | 'link'>): boolean {
  const text = `${result.title || ''} ${result.snippet || ''} ${result.link || ''}`
  return CONTENT_RESULT_RE.test(text)
}

function searchResultText(result: Pick<SerpApiOrganicResult, 'title' | 'snippet' | 'link' | 'displayed_link'>): string {
  return `${result.title || ''} ${result.snippet || ''} ${result.link || ''} ${result.displayed_link || ''}`
}

function hasIndustryTargetSignal(text: string, industry: string): boolean {
  const normalized = text.toLowerCase()
  if (industry === 'agency') {
    return AGENCY_TARGET_RE.test(normalized)
  }
  if (industry === 'ai') {
    return AI_TARGET_RE.test(normalized)
  }
  if (industry === 'cybersecurity') {
    return CYBERSECURITY_TARGET_RE.test(normalized)
  }
  if (industry === 'devtools') {
    return DEVTOOLS_TARGET_RE.test(normalized)
  }
  if (industry === 'saas') {
    return SAAS_TARGET_RE.test(normalized)
  }
  return BUSINESS_RESULT_RE.test(normalized)
}

export function isPublicSearchResultQualifiedForTarget(
  result: Pick<SerpApiOrganicResult, 'title' | 'snippet' | 'link' | 'displayed_link'>,
  industry: string
): boolean {
  const text = searchResultText(result)
  if (NON_TARGET_RESULT_RE.test(text)) return false
  if (looksLikeContentResult(result) && !hasIndustryTargetSignal(text, industry)) return false
  return hasIndustryTargetSignal(text, industry)
}

function companyFromTitle(title: string, domain: string): string {
  const cleaned = title
    .split(/\s[|-]\s/)[0]
    .replace(/\b(contact|sales|demo|home|official site|homepage)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned && cleaned.length <= 80 && !CONTENT_RESULT_RE.test(cleaned) && !NON_TARGET_RESULT_RE.test(cleaned)) {
    return cleaned
  }

  return companyFromDomain(domain)
}

function isLowIntentSearchResult(result: SerpApiOrganicResult): boolean {
  const text = `${result.title || ''} ${result.snippet || ''} ${result.link || ''}`.toLowerCase()
  const contentSignals = CONTENT_RESULT_RE.test(text)
  const commercialSignals = BUSINESS_RESULT_RE.test(text)
  if (NON_TARGET_RESULT_RE.test(text)) return true
  return contentSignals && !commercialSignals
}

function normalizeDomainFromUrl(rawUrl: string, displayedLink?: string): string | null {
  try {
    const candidate = rawUrl || (displayedLink ? `https://${displayedLink}` : '')
    const url = new URL(candidate)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    if (!hostname || !hostname.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return null
    if (isIndiaMarketDomain(hostname)) return null
    const blocked = Array.from(BLOCKED_HOSTS).some((host) => hostname === host || hostname.endsWith(`.${host}`))
    if (blocked || BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) return null
    if (LOW_VALUE_PATH_RE.test(url.pathname)) return null
    return hostname
  } catch {
    if (!displayedLink) return null
    try {
      const fallback = displayedLink
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .split(/[/?#]/)[0]
      if (!fallback || !fallback.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(fallback)) return null
      if (isIndiaMarketDomain(fallback)) return null
      const blocked = Array.from(BLOCKED_HOSTS).some((host) => fallback === host || fallback.endsWith(`.${host}`))
      return blocked || BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(fallback)) ? null : fallback
    } catch {
      return null
    }
  }
}

function mailboxForPersona(domain: string, persona: LeadScoutPersona): string {
  const mailbox = PERSONA_MAILBOXES[persona][0] || 'hello'
  return `${mailbox}@${domain}`
}

function rootEvidenceUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    return `${url.protocol}//${url.hostname.replace(/^www\./, '')}/`
  } catch {
    return rawUrl
  }
}

function defaultQueries(industry: string, region: string): string[] {
  const queryGroups: Record<string, string[]> = {
    agency: [
      '"lead generation agency" "contact" "B2B"',
      '"outbound sales agency" "contact" "B2B"',
      '"appointment setting agency" "contact" "B2B"',
      '"RevOps agency" "contact" "sales operations"',
      '"B2B demand generation agency" "contact"',
    ],
    cybersecurity: [
      '"cybersecurity platform" "contact sales"',
      '"AI security" "enterprise" "contact"',
      '"MSSP" "managed security" "contact"',
      '"security operations platform" "contact sales"',
    ],
    ai: [
      '"AI infrastructure" "contact sales"',
      '"LLM infrastructure" "enterprise" "contact"',
      '"AI governance" "contact sales"',
      '"private AI" "enterprise" "contact"',
    ],
    devtools: [
      '"developer tools" "contact sales"',
      '"cloud infrastructure" "contact sales"',
      '"observability platform" "contact sales"',
      '"workflow orchestration" "contact sales"',
    ],
    saas: [
      '"B2B SaaS" "contact sales"',
      '"sales engagement" "contact sales"',
      '"revenue operations" "contact sales"',
      '"customer engagement platform" "contact sales"',
    ],
  }

  const selected = queryGroups[industry] ?? queryGroups.agency
  return selected.map((query) => `${query} ${region}`)
}

function scoreResult(result: SerpApiOrganicResult, industry: string): number {
  const text = `${result.title || ''} ${result.snippet || ''} ${result.link || ''}`.toLowerCase()
  let score = 50
  if (text.includes(industry)) score += 10
  if (/\b(outbound|lead generation|revops|sales operations|appointment setting|demand generation)\b/i.test(text)) score += 15
  if (/\b(agency|services|clients|b2b|marketing agency|growth agency|consulting|done-for-you)\b/i.test(text)) score += 12
  if (/\b(ai governance|cybersecurity|security operations|infrastructure|observability|compliance|enterprise)\b/i.test(text)) score += 12
  if (/\b(contact sales|book a demo|get in touch|sales team)\b/i.test(text)) score += 8
  if (/\b(blog|news|podcast|article|job|career)\b/i.test(text)) score -= 10
  if (/\b(what is|complete guide|best practices|ultimate guide|resources|learn|definition|introduction|tutorial|course|training|types of|explained)\b/i.test(text)) score -= 36
  if (BUSINESS_RESULT_RE.test(text)) score += 8
  score += targetMarketScoreBonus(text)
  return Math.max(0, Math.min(score, 98))
}

async function fetchSerpApiPage(input: {
  apiKey: string
  query: string
  region: string
  start: number
  timeoutMs: number
}): Promise<SearchPageResult> {
  try {
    const url = new URL('https://serpapi.com/search.json')
    url.searchParams.set('engine', 'google')
    url.searchParams.set('q', input.query)
    url.searchParams.set('api_key', input.apiKey)
    url.searchParams.set('hl', 'en')
    url.searchParams.set('gl', glForRegion(input.region))
    url.searchParams.set('location', input.region)
    url.searchParams.set('safe', 'active')
    url.searchParams.set('num', '10')
    url.searchParams.set('start', String(input.start))

    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(input.timeoutMs),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      return { results: [], error: `serpapi_http_${response.status}` }
    }
    const body = payload as SerpApiResponse
    return {
      results: body.organic_results ?? [],
      error: body.error || body.search_metadata?.error,
    }
  } catch (error) {
    return { results: [], error: `serpapi_fetch_${error instanceof Error ? error.name : 'error'}` }
  }
}

function decodeBasicHtml(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function stripHtml(input: string): string {
  return decodeBasicHtml(input.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

function normalizeDuckDuckGoLink(rawHref: string): string {
  const decoded = decodeBasicHtml(rawHref)
  try {
    const redirect = new URL(decoded, 'https://duckduckgo.com')
    const uddg = redirect.searchParams.get('uddg')
    return uddg ? decodeURIComponent(uddg) : redirect.toString()
  } catch {
    return decoded
  }
}

function parseDuckDuckGoHtml(html: string): SerpApiOrganicResult[] {
  const anchors = Array.from(
    html.matchAll(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)
  )
  const snippets = Array.from(html.matchAll(/<a[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi))
    .map((match) => stripHtml(String(match[1] || '')))

  return anchors
    .map((match, index) => {
      const link = normalizeDuckDuckGoLink(String(match[1] || ''))
      return {
        title: stripHtml(String(match[2] || '')),
        link,
        displayed_link: (() => {
          try {
            return new URL(link).hostname
          } catch {
            return ''
          }
        })(),
        snippet: snippets[index] || '',
      }
    })
    .filter((result) => Boolean(result.title && result.link))
}

function decodeBingRedirect(rawHref: string): string {
  const decodedHref = decodeBasicHtml(rawHref)
  try {
    const url = new URL(decodedHref, 'https://www.bing.com')
    const encodedTarget = url.searchParams.get('u')
    if (!encodedTarget) return url.toString()

    const payload = encodedTarget.startsWith('a1') ? encodedTarget.slice(2) : encodedTarget
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
    const target = Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8')
    return target || url.toString()
  } catch {
    return decodedHref
  }
}

function parseBingHtml(html: string): SerpApiOrganicResult[] {
  const blocks = html.match(/<li class=["']b_algo["'][\s\S]*?(?=<li class=["']b_algo["']|<li class=["']b_pag["']|<\/ol>)/gi) ?? []
  const results: SerpApiOrganicResult[] = []

  for (const block of blocks) {
    const titleMatch = block.match(/<h2[^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i)
    if (!titleMatch) continue

    const link = decodeBingRedirect(String(titleMatch[1] || ''))
    const title = stripHtml(String(titleMatch[2] || ''))
    if (!title || !link) continue

    const snippet = stripHtml(String(block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || ''))
    results.push({
      title,
      link,
      displayed_link: (() => {
        try {
          return new URL(link).hostname
        } catch {
          return ''
        }
      })(),
      snippet,
    })
  }

  return results
}

async function fetchBingPage(input: {
  query: string
  start: number
  timeoutMs: number
}): Promise<SearchPageResult> {
  try {
    const url = new URL('https://www.bing.com/search')
    url.searchParams.set('q', input.query)
    url.searchParams.set('first', String(input.start + 1))
    url.searchParams.set('setlang', 'en-US')
    url.searchParams.set('ensearch', '1')

    const response = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; SovereignEnginePublicResearch/1.0)',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(input.timeoutMs),
    })
    const html = await response.text().catch(() => '')
    if (!response.ok) {
      return { results: [], error: `bing_http_${response.status}` }
    }
    return { results: parseBingHtml(html) }
  } catch (error) {
    return { results: [], error: `bing_fetch_${error instanceof Error ? error.name : 'error'}` }
  }
}

async function fetchDuckDuckGoPage(input: {
  query: string
  start: number
  timeoutMs: number
}): Promise<SearchPageResult> {
  try {
    const url = new URL('https://html.duckduckgo.com/html/')
    url.searchParams.set('q', input.query)
    url.searchParams.set('s', String(input.start))

    const response = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.8',
        'User-Agent': 'SovereignEnginePublicResearch/1.0',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(input.timeoutMs),
    })
    const html = await response.text().catch(() => '')
    if (!response.ok) {
      return { results: [], error: `duckduckgo_http_${response.status}` }
    }
    return { results: parseDuckDuckGoHtml(html) }
  } catch (error) {
    return { results: [], error: `duckduckgo_fetch_${error instanceof Error ? error.name : 'error'}` }
  }
}

export async function searchPublicSearchLeads(input: PublicSearchLeadSearchInput): Promise<PublicSearchLeadSearchResult> {
  const apiKey = String(input.apiKey || '').trim()
  const provider: PublicSearchProvider = input.provider || (apiKey ? 'serpapi' : 'bing_html')
  if (provider === 'serpapi' && !apiKey) throw new Error('public_search_provider_key_missing')

  const industry = normalizeIndustry(input.industry)
  const persona = normalizePersona(input.persona)
  const region = normalizeRegion(input.region)
  const limit = clampInteger(input.limit, DEFAULT_LIMIT, 1, MAX_LIMIT)
  const deadlineAt = Date.now() + clampInteger(input.timeoutMs, DEFAULT_TIMEOUT_MS, 5_000, 120_000)
  const queryList = (input.queries?.length ? input.queries : defaultQueries(industry, region))
    .map((query) => query.trim())
    .filter(Boolean)
    .slice(0, 20)
  const byDomain = new Map<string, OpenLead>()
  const errors: string[] = []
  let scannedResults = 0
  let rejected = 0
  let queriesRun = 0

  for (const query of queryList) {
    if (Date.now() >= deadlineAt || byDomain.size >= limit) break
    queriesRun += 1

    for (let start = 0; start <= 90 && byDomain.size < limit; start += 10) {
      const remaining = deadlineAt - Date.now()
      if (remaining <= 0) break

      const timeoutMs = Math.min(8_000, Math.max(1_000, remaining))
      const response =
        provider === 'serpapi'
          ? await fetchSerpApiPage({
              apiKey,
              query,
              region,
              start,
              timeoutMs,
            })
          : provider === 'bing_html'
            ? await fetchBingPage({
                query,
                start,
                timeoutMs,
              })
            : await fetchDuckDuckGoPage({
                query,
                start,
                timeoutMs,
              })
      const error = response.error
      if (error) {
        errors.push(String(error).slice(0, 120))
        break
      }

      const organicResults = response.results
      if (organicResults.length === 0) break

      for (const result of organicResults) {
        scannedResults += 1
        const link = String(result.link || '').trim()
        const domain = normalizeDomainFromUrl(link, result.displayed_link)
        if (!domain || byDomain.has(domain)) {
          rejected += 1
          continue
        }
        if (
          !isTargetPayingMarketLead({
            domain,
            company: result.title,
            source: link,
            region,
            customFields: { snippet: result.snippet, displayed_link: result.displayed_link },
          })
        ) {
          rejected += 1
          continue
        }
        if (isLowIntentSearchResult(result) || !isPublicSearchResultQualifiedForTarget(result, industry)) {
          rejected += 1
          continue
        }

        const fitScore = scoreResult(result, industry)
        const hasBusinessSignal = BUSINESS_RESULT_RE.test(
          `${result.title || ''} ${result.snippet || ''} ${result.link || ''} ${result.displayed_link || ''}`
        )
        if (fitScore < 45 || (!hasBusinessSignal && fitScore < 58)) {
          rejected += 1
          continue
        }

        const businessRoleEligible =
          fitScore >= 68 &&
          hasBusinessSignal &&
          isPublicSearchResultQualifiedForTarget(result, industry)

        const contentResult = looksLikeContentResult(result)
        const company = companyFromTitle(String(result.title || ''), domain)
        const reason = contentResult
          ? `${company} matched a public ${industry} business-domain result; outreach should focus on infrastructure fit, not the page title.`
          : `Public search result matched ${industry} target profile: ${String(result.snippet || result.title || link).slice(0, 180)}`

        byDomain.set(domain, {
          email: mailboxForPersona(domain, persona),
          company,
          companyDomain: domain,
          title: `${persona} team`,
          source: 'public_search',
          fitScore,
          reason,
          confidence: fitScore >= 85 ? 'high' : fitScore >= 70 ? 'medium' : 'low',
          emailEvidence: businessRoleEligible ? 'business_domain_role_pattern' : 'synthetic_role_pattern',
          publicEvidenceUrl: rootEvidenceUrl(link),
          autoApprovalEligible: businessRoleEligible,
        })
      }

      if (organicResults.length < 10) break
    }
  }

  return {
    provider,
    industry,
    persona,
    region,
    leads: Array.from(byDomain.values()).slice(0, limit),
    scannedResults,
    rejected,
    queriesRun,
    errors,
    guardrails: [
      'Public search discovers company domains only',
      'No personal email guessing',
      'Only safe company role inboxes are inferred for scored business domains',
      'US/foreign paying markets are prioritized; India-market signals are rejected',
      'MX, provider validation, scoring, and approval gates still run before queueing',
      'Suppression, bounce, unsubscribe, and sender capacity gates remain enforced',
    ],
  }
}

export function publicSearchLeadsToContacts(leads: OpenLead[]): ContactInput[] {
  return leads.map((lead) => ({
    email: lead.email,
    name: '',
    company: lead.company,
    title: lead.title,
    source: 'public_search',
    companyDomain: lead.companyDomain,
    customFields: {
      auto_approval_eligible: Boolean(lead.autoApprovalEligible),
      data_source: 'public_search',
      email_evidence: lead.emailEvidence ?? 'synthetic_role_pattern',
      lead_scout: true,
      public_search: true,
      target_market: true,
      target_region: 'us_foreign_paying_market',
      fit_score: lead.fitScore,
      confidence: lead.confidence,
      reason_to_contact: lead.reason,
      public_evidence_url: lead.publicEvidenceUrl ?? null,
      lead_quality_warning: lead.autoApprovalEligible
        ? 'Business domain role inbox inferred from a high-fit public company result; validation and bounce controls remain active.'
        : 'Role inbox inferred from public search result; requires business-safe validation and scoring before queueing.',
      approval_required: true,
      send_status: 'not_approved',
    },
  }))
}
 
