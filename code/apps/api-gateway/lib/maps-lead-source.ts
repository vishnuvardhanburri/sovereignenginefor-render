import type { ContactInput } from './backend'
import {
  isTargetPayingMarketLead,
  targetMarketSearchRegions,
  targetMarketScoreBonus,
} from '@/lib/target-market'

export type MapsLeadRejected = {
  row: number
  email: string
  reason: string
}

export type PreparedMapsLeadImport = {
  contacts: ContactInput[]
  rejected: MapsLeadRejected[]
  summary: {
    rows: number
    valid: number
    rejected: number
    evidenceBacked: number
  }
}

export type MapsLeadItem = Record<string, unknown>
export type ApifyActorInput = Record<string, unknown>

type ApifyDatasetSummary = {
  id?: string
  name?: string
  itemCount?: number
  modifiedAt?: string
  createdAt?: string
}

export type ResolvedApifyMapsItems = {
  items: MapsLeadItem[]
  sourceType: 'apify_dataset' | 'apify_task' | 'apify_actor'
  sourceUrl: string
  datasetId?: string
  taskId?: string
  actorId?: string
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

const SAFE_BUSINESS_MAILBOX_PREFIXES = new Set([
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
  'partners',
  'partnership',
  'partnerships',
  'sales',
  'team',
])

const RELEVANT_BUSINESS_CATEGORY_RE =
  /\b(?:advertis(?:e|ing)|ai|automation|b2b|brand|business(?:\s+development)?|cloud|consult(?:ant|ing|ancy)?|crm|cyber(?:security)?|data|demand\s+gen(?:eration)?|digital\s+marketing|growth|gtm|information\s+technology|it\s+service|lead\s+gen(?:eration)?|marketing|performance\s+marketing|public\s+relations|revenue|revops|saas|sales|software|technology|web(?:site)?\s+design)\b/i

const IRRELEVANT_AGENCY_CATEGORY_RE =
  /\b(?:adoption|artist|auto|automotive|booking|bus|car\s+rental|charter|child\s+care|collection|dating|employment|estate|event|government|helicopter|home\s+health|insurance|modeling|news|nursing|real\s+estate|recruit(?:er|ing|ment)?|rental|staffing|tour|travel|wedding)\s+agency\b/i

const DEFAULT_HYBRID_MAPS_SEARCHES = [
  'lead generation agency',
  'b2b lead generation agency',
  'cold email agency',
  'outbound sales agency',
  'sales development agency',
  'appointment setting agency',
  'demand generation agency',
  'performance marketing agency b2b',
  'growth marketing agency saas',
  'revops agency',
  'revenue operations consulting',
  'gtm consulting firm',
  'sales consulting firm',
  'hubspot partner agency',
  'salesforce consulting partner',
  'marketing automation agency',
  'saas marketing agency',
  'b2b marketing agency',
  'account based marketing agency',
  'linkedin lead generation agency',
  'email deliverability consultant',
  'email marketing agency ecommerce',
  'ai automation agency',
  'ai consulting firm',
  'cybersecurity consulting firm',
  'data security consulting',
  'cloud security consulting',
  'software development agency saas',
  'product marketing agency b2b',
  'fractional cmo agency',
  'startup growth agency',
  'enterprise sales consulting',
]

const DEFAULT_HYBRID_MARKETS = targetMarketSearchRegions()

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => asStringArray(item))
      .map((item) => item.trim())
      .filter(Boolean)
  }

  const text = asString(value)
  if (!text) return []

  return text
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function buildApifyGoogleMapsActorInput(input?: {
  searches?: unknown
  location?: unknown
  limit?: unknown
  inputJson?: unknown
  placesPerSearch?: unknown
  explicitOnly?: unknown
}): ApifyActorInput {
  if (input?.inputJson && typeof input.inputJson === 'object' && !Array.isArray(input.inputJson)) {
    return input.inputJson as ApifyActorInput
  }

  const inputJson = asString(input?.inputJson)
  if (inputJson) {
    const parsed = JSON.parse(inputJson)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('APIFY_GOOGLE_MAPS_ACTOR_INPUT_JSON must be a JSON object')
    }
    return parsed as ApifyActorInput
  }

  const explicitSearches = asStringArray(input?.searches)
  const explicitOnly = ['1', 'true', 'yes', 'on'].includes(
    asString(input?.explicitOnly || process.env.APIFY_GOOGLE_MAPS_USE_EXPLICIT_ONLY).toLowerCase()
  )
  const rawLocations = asStringArray(input?.location)
  const primaryLocation = rawLocations[0] || 'United States'
  const marketBoosts = rawLocations.length > 1 ? rawLocations : DEFAULT_HYBRID_MARKETS
  const hybridSearches = [
    ...DEFAULT_HYBRID_MAPS_SEARCHES,
    ...DEFAULT_HYBRID_MAPS_SEARCHES.slice(0, 12).flatMap((query) =>
      marketBoosts.slice(0, 4).map((market) => `${query} ${market}`)
    ),
  ]
  const searches =
    explicitSearches.length > 0 && explicitOnly
      ? explicitSearches
      : Array.from(new Set([...explicitSearches, ...hybridSearches]))
  const totalLimit = Math.max(1, Math.min(Number(input?.limit ?? 100), 500))
  const placesPerSearch = Math.max(
    1,
    Math.min(
      Number(input?.placesPerSearch ?? process.env.APIFY_GOOGLE_MAPS_PLACES_PER_SEARCH ?? 8),
      50
    )
  )

  return {
    searchStringsArray: searches,
    locationQuery: primaryLocation,
    maxCrawledPlacesPerSearch: Math.min(totalLimit, placesPerSearch),
    language: 'en',
    website: 'withWebsite',
    scrapeContacts: true,
    skipClosedPlaces: true,
  }
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0]
}

function cleanUrl(value: unknown): string {
  const text = asString(value)
  if (!text || /^\[.*\]$/.test(text)) return ''
  if (!/^https?:\/\//i.test(text)) return ''
  return text
}

function hostnameFromUrl(value: string): string {
  try {
    return normalizeDomain(new URL(value).hostname)
  } catch {
    return normalizeDomain(value)
  }
}

function domainsAlign(emailDomain: string, websiteDomain: string): boolean {
  if (!emailDomain || !websiteDomain) return false
  if (emailDomain === websiteDomain) return true
  return emailDomain.endsWith(`.${websiteDomain}`) || websiteDomain.endsWith(`.${emailDomain}`)
}

function blockedReason(email: string): string | null {
  if (!isEmail(email)) return 'invalid_email'

  const [prefix, domain] = email.toLowerCase().split('@')
  if (!domain || domain === 'example.com' || domain === 'example.org' || domain.endsWith('.test')) {
    return 'placeholder_or_test_domain'
  }

  if (PERSONAL_EMAIL_DOMAINS.has(domain)) return 'personal_email_domain'
  if (BLOCKED_MAILBOX_PREFIXES.has(prefix)) return 'blocked_mailbox_prefix'
  if (prefix.includes('+')) return 'tagged_or_test_address'

  return null
}

function pickFirst(input: MapsLeadItem, keys: string[]): string {
  for (const key of keys) {
    const value = asString(input[key])
    if (value) return value
  }
  return ''
}

function collectEmails(input: MapsLeadItem): string[] {
  const emails = [
    ...asStringArray(input.email),
    ...asStringArray(input.emails),
    ...asStringArray(input.emailAddress),
    ...asStringArray(input.email_addresses),
    ...asStringArray(input.contactEmails),
  ]

  return Array.from(new Set(emails.map((email) => email.toLowerCase()).filter(Boolean)))
}

function categoryText(input: MapsLeadItem): string {
  return [
    asString(input.categoryName),
    asString(input.category),
    ...asStringArray(input.categories),
    ...asStringArray(input.additionalCategories),
  ]
    .filter(Boolean)
    .join(', ')
}

function fitScoreFor(input: {
  mailbox: string
  categories: string
  industry?: string
  hasAlignedWebsite: boolean
}): number {
  let score = input.hasAlignedWebsite ? 82 : 68
  if (SAFE_BUSINESS_MAILBOX_PREFIXES.has(input.mailbox)) score += 8
  if (input.categories && /agency|marketing|sales|revenue|saas|software|consult/i.test(input.categories)) {
    score += 6
  }
  if (input.industry && input.categories.toLowerCase().includes(input.industry.toLowerCase())) {
    score += 4
  }
  score += targetMarketScoreBonus(input.categories, input.industry)
  return Math.max(50, Math.min(score, 98))
}

function isRelevantMapsBusiness(input: {
  company: string
  categories: string
  website: string
  industry?: string
}): boolean {
  const haystack = [
    input.company,
    input.categories,
    input.website,
    input.industry ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  if (IRRELEVANT_AGENCY_CATEGORY_RE.test(haystack)) return false
  return RELEVANT_BUSINESS_CATEGORY_RE.test(haystack)
}

export function prepareMapsLeadContacts(
  items: MapsLeadItem[],
  opts?: {
    sourceUrl?: string
    sourceName?: string
    limit?: number
    dedupeByDomain?: boolean
    industry?: string
    region?: string
  }
): PreparedMapsLeadImport {
  const limit = Math.max(1, Math.min(Number(opts?.limit ?? 100), 500))
  const contacts: ContactInput[] = []
  const rejected: MapsLeadRejected[] = []
  const seenEmails = new Set<string>()
  const seenDomains = new Set<string>()
  const sourceName = opts?.sourceName || 'google_maps_scraper_export'

  for (const [index, item] of items.entries()) {
    if (contacts.length >= limit) break

    const row = index + 1
    const emails = collectEmails(item)
    if (emails.length === 0) {
      rejected.push({ row, email: '', reason: 'missing_email' })
      continue
    }

    const company = pickFirst(item, ['title', 'name', 'company', 'businessName']) || 'Unknown business'
    const website = cleanUrl(item.website || item.urlWebsite || item.companyWebsite)
    const placeUrl = cleanUrl(item.url || item.placeUrl || item.googleMapsUrl)
    const evidenceUrl = website || placeUrl
    const websiteDomain = website ? hostnameFromUrl(website) : ''
    const categories = categoryText(item)
    const location = [
      pickFirst(item, ['city', 'addressCity']),
      pickFirst(item, ['state', 'addressState', 'region']),
      pickFirst(item, ['country', 'addressCountry']),
      pickFirst(item, ['address', 'street', 'fullAddress']),
    ]
      .filter(Boolean)
      .join(' ')

    for (const email of emails) {
      if (contacts.length >= limit) break

      const reason = blockedReason(email)
      if (reason) {
        rejected.push({ row, email, reason })
        continue
      }

      if (!evidenceUrl) {
        rejected.push({ row, email, reason: 'missing_public_evidence_url' })
        continue
      }

      if (seenEmails.has(email)) {
        rejected.push({ row, email, reason: 'duplicate_email' })
        continue
      }

      const [mailbox = '', emailDomain = ''] = email.split('@')
      const companyDomain = websiteDomain || emailDomain
      const alignedWebsite = websiteDomain ? domainsAlign(emailDomain, websiteDomain) : false

      if (
        !isTargetPayingMarketLead({
          email,
          domain: companyDomain,
          company,
          source: evidenceUrl,
          region: opts?.region || location,
          customFields: { categories, location },
        })
      ) {
        rejected.push({ row, email, reason: 'not_tier1_paying_market_or_india_signal' })
        continue
      }

      if (websiteDomain && !alignedWebsite) {
        rejected.push({ row, email, reason: 'email_domain_mismatch' })
        continue
      }

      if (opts?.dedupeByDomain && seenDomains.has(emailDomain)) {
        rejected.push({ row, email, reason: 'duplicate_domain' })
        continue
      }

      if (!isRelevantMapsBusiness({ company, categories, website, industry: opts?.industry })) {
        rejected.push({ row, email, reason: 'irrelevant_maps_category' })
        continue
      }

      seenEmails.add(email)
      seenDomains.add(emailDomain)

      const fitScore = fitScoreFor({
        mailbox,
        categories,
        industry: opts?.industry,
        hasAlignedWebsite: alignedWebsite,
      })
      const reasonToContact = `${company} appears relevant to ${opts?.industry || 'outbound'} infrastructure based on public business listing signals${categories ? ` (${categories})` : ''}.`

      contacts.push({
        email,
        company,
        companyDomain,
        title: categories || 'business team',
        source: 'google_maps_apify',
        customFields: {
          maps_import: true,
          data_source: sourceName,
          source_url: opts?.sourceUrl ?? null,
          consent_source: sourceName,
          public_evidence_url: evidenceUrl,
          research_evidence_url: evidenceUrl,
          maps_place_url: placeUrl || null,
          maps_website: website || null,
          maps_phone: pickFirst(item, ['phone', 'phoneUnformatted', 'phoneNumber']) || null,
          maps_address: pickFirst(item, ['address', 'street', 'fullAddress']) || null,
          maps_category: categories || null,
          maps_region: opts?.region || null,
          target_market: true,
          target_region: 'us_foreign_paying_market',
          fit_score: fitScore,
          confidence: alignedWebsite ? 'high' : 'medium',
          reason_to_contact: reasonToContact,
          send_status: 'not_approved',
          approval_required: true,
          auto_approval_eligible: Boolean(evidenceUrl && (!websiteDomain || alignedWebsite)),
          email_evidence: alignedWebsite
            ? 'maps_public_business_domain_match'
            : 'maps_public_business_evidence',
        },
      })
    }
  }

  return {
    contacts,
    rejected,
    summary: {
      rows: items.length,
      valid: contacts.length,
      rejected: rejected.length,
      evidenceBacked: contacts.filter((contact) => contact.customFields?.auto_approval_eligible).length,
    },
  }
}

export function buildApifyDatasetItemsUrl(input: {
  datasetId: string
  token: string
  limit?: number
  offset?: number
}): string {
  const limit = Math.max(1, Math.min(Number(input.limit ?? 100), 500))
  const offset = Math.max(0, Math.trunc(Number(input.offset ?? 0) || 0))
  const url = new URL(`https://api.apify.com/v2/datasets/${encodeURIComponent(input.datasetId)}/items`)
  url.searchParams.set('clean', 'true')
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('offset', String(offset))
  url.searchParams.set('token', input.token)
  return url.toString()
}

export function buildApifyDatasetsUrl(input: {
  token: string
  limit?: number
}): string {
  const limit = Math.max(1, Math.min(Number(input.limit ?? 20), 100))
  const url = new URL('https://api.apify.com/v2/datasets')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('desc', '1')
  url.searchParams.set('unnamed', 'true')
  url.searchParams.set('token', input.token)
  return url.toString()
}

export function buildApifyTaskRunItemsUrl(input: {
  taskId: string
  token: string
  limit?: number
  timeoutSecs?: number
}): string {
  const limit = Math.max(1, Math.min(Number(input.limit ?? 100), 500))
  const timeoutSecs = Math.max(30, Math.min(Number(input.timeoutSecs ?? 120), 300))
  const url = new URL(
    `https://api.apify.com/v2/actor-tasks/${encodeURIComponent(input.taskId)}/run-sync-get-dataset-items`
  )
  url.searchParams.set('clean', 'true')
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('timeout', String(timeoutSecs))
  url.searchParams.set('token', input.token)
  return url.toString()
}

function normalizeApifyActorId(actorId: string): string {
  return actorId.trim().replace(/\//g, '~')
}

export function buildApifyActorRunItemsUrl(input: {
  actorId: string
  token: string
  limit?: number
  timeoutSecs?: number
}): string {
  const limit = Math.max(1, Math.min(Number(input.limit ?? 100), 500))
  const timeoutSecs = Math.max(30, Math.min(Number(input.timeoutSecs ?? 120), 300))
  const actorId = normalizeApifyActorId(input.actorId)
  const url = new URL(
    `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items`
  )
  url.searchParams.set('clean', 'true')
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('timeout', String(timeoutSecs))
  url.searchParams.set('token', input.token)
  return url.toString()
}

function extractDatasets(data: unknown): ApifyDatasetSummary[] {
  if (Array.isArray(data)) return data as ApifyDatasetSummary[]
  if (
    data &&
    typeof data === 'object' &&
    'data' in data &&
    (data as { data?: unknown }).data &&
    typeof (data as { data?: unknown }).data === 'object'
  ) {
    const nested = (data as { data: { items?: unknown } }).data.items
    if (Array.isArray(nested)) return nested as ApifyDatasetSummary[]
  }
  return []
}

export async function fetchLatestApifyDatasetId(input: {
  token: string
  limit?: number
  fetchImpl?: typeof fetch
}): Promise<string> {
  const fetcher = input.fetchImpl ?? fetch
  const response = await fetcher(buildApifyDatasetsUrl(input), {
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  })

  if (!response.ok) {
    throw new Error(`Apify datasets list returned HTTP ${response.status}`)
  }

  const datasets = extractDatasets(await response.json())
    .filter((dataset) => dataset.id && Number(dataset.itemCount ?? 0) > 0)
    .sort((left, right) => {
      const leftTime = Date.parse(left.modifiedAt || left.createdAt || '')
      const rightTime = Date.parse(right.modifiedAt || right.createdAt || '')
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0)
    })

  const latest = datasets[0]?.id
  if (!latest) {
    throw new Error('No non-empty Apify dataset found. Run the Google Maps scraper once first.')
  }

  return latest
}

export async function fetchApifyTaskDatasetItems(input: {
  taskId: string
  token: string
  limit?: number
  timeoutSecs?: number
  fetchImpl?: typeof fetch
}): Promise<MapsLeadItem[]> {
  const fetcher = input.fetchImpl ?? fetch
  const response = await fetcher(
    buildApifyTaskRunItemsUrl({
      taskId: input.taskId,
      token: input.token,
      limit: input.limit,
      timeoutSecs: input.timeoutSecs,
    }),
    {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(Math.max(35_000, Math.min(Number(input.timeoutSecs ?? 120) * 1000 + 5_000, 305_000))),
    }
  )

  if (!response.ok) {
    throw new Error(`Apify task run returned HTTP ${response.status}`)
  }

  const data = await response.json()
  if (!Array.isArray(data)) {
    throw new Error('Apify task run did not return a dataset item array')
  }

  return data as MapsLeadItem[]
}

export async function fetchApifyActorDatasetItems(input: {
  actorId: string
  token: string
  input?: Record<string, unknown>
  limit?: number
  timeoutSecs?: number
  fetchImpl?: typeof fetch
}): Promise<MapsLeadItem[]> {
  const fetcher = input.fetchImpl ?? fetch
  const response = await fetcher(
    buildApifyActorRunItemsUrl({
      actorId: input.actorId,
      token: input.token,
      limit: input.limit,
      timeoutSecs: input.timeoutSecs,
    }),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(input.input ?? {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(Math.max(35_000, Math.min(Number(input.timeoutSecs ?? 120) * 1000 + 5_000, 305_000))),
    }
  )

  if (!response.ok) {
    throw new Error(`Apify actor run returned HTTP ${response.status}`)
  }

  const data = await response.json()
  if (!Array.isArray(data)) {
    throw new Error('Apify actor run did not return a dataset item array')
  }

  return data as MapsLeadItem[]
}

export async function fetchApifyDatasetItems(input: {
  datasetId: string
  token: string
  limit?: number
  offset?: number
  fetchImpl?: typeof fetch
}): Promise<MapsLeadItem[]> {
  const fetcher = input.fetchImpl ?? fetch
  const response = await fetcher(
    buildApifyDatasetItemsUrl({
      datasetId: input.datasetId,
      token: input.token,
      limit: input.limit,
      offset: input.offset,
    }),
    {
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    }
  )

  if (!response.ok) {
    throw new Error(`Apify dataset returned HTTP ${response.status}`)
  }

  const data = await response.json()
  if (!Array.isArray(data)) {
    throw new Error('Apify dataset did not return an item array')
  }

  return data as MapsLeadItem[]
}

function isNoDatasetError(error: unknown): boolean {
  return error instanceof Error && /No non-empty Apify dataset found/i.test(error.message)
}

export async function resolveApifyMapsItems(input: {
  token: string
  requestedDatasetId?: string
  taskId?: string
  actorId?: string
  actorInput?: Record<string, unknown>
  limit?: number
  offset?: number
  datasetDiscoveryLimit?: number
  taskTimeoutSecs?: number
  fetchImpl?: typeof fetch
}): Promise<ResolvedApifyMapsItems> {
  const datasetId = String(input.requestedDatasetId || '').trim()
  const taskId = String(input.taskId || '').trim()
  const actorId = String(input.actorId || '').trim()

  if (datasetId) {
    return {
      items: await fetchApifyDatasetItems({
        datasetId,
        token: input.token,
        limit: input.limit,
        offset: input.offset,
        fetchImpl: input.fetchImpl,
      }),
      sourceType: 'apify_dataset',
      sourceUrl: `apify:dataset:${datasetId}`,
      datasetId,
    }
  }

  if (taskId) {
    return {
      items: await fetchApifyTaskDatasetItems({
        taskId,
        token: input.token,
        limit: input.limit,
        timeoutSecs: input.taskTimeoutSecs,
        fetchImpl: input.fetchImpl,
      }),
      sourceType: 'apify_task',
      sourceUrl: `apify:task:${taskId}`,
      taskId,
    }
  }

  if (actorId) {
    return {
      items: await fetchApifyActorDatasetItems({
        actorId,
        token: input.token,
        input: input.actorInput,
        limit: input.limit,
        timeoutSecs: input.taskTimeoutSecs,
        fetchImpl: input.fetchImpl,
      }),
      sourceType: 'apify_actor',
      sourceUrl: `apify:actor:${actorId}`,
      actorId,
    }
  }

  try {
    const latestDatasetId = await fetchLatestApifyDatasetId({
      token: input.token,
      limit: input.datasetDiscoveryLimit,
      fetchImpl: input.fetchImpl,
    })

    return {
      items: await fetchApifyDatasetItems({
        datasetId: latestDatasetId,
        token: input.token,
        limit: input.limit,
        offset: input.offset,
        fetchImpl: input.fetchImpl,
      }),
      sourceType: 'apify_dataset',
      sourceUrl: `apify:dataset:${latestDatasetId}`,
      datasetId: latestDatasetId,
    }
  } catch (error) {
    if (!isNoDatasetError(error)) throw error
    if (!taskId && !actorId) {
      throw new Error(
        'No non-empty Apify dataset found and no saved Google Maps task or actor is configured. Set APIFY_GOOGLE_MAPS_TASK_ID or APIFY_GOOGLE_MAPS_ACTOR_ID in Render, or pass taskId=/actorId= in the cron URL.'
      )
    }
  }

  throw new Error('Unable to resolve Apify Google Maps input source')
}
