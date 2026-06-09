import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { Queue } from 'bullmq'
import { appEnv } from '@/lib/env'
import { query } from '@/lib/db'
import { importContacts, runDailyMaintenance, type ContactInput } from '@/lib/backend'
import { resolveSystemApprovalWindow } from '@/lib/contact-approval-window'
import { applyDailyVolumeBand, buildDailyOutboundPlan } from '@/lib/daily-outbound'
import { searchDomainWithHunter, type HunterDomainEmail } from '@/lib/integrations/hunter'
import { validateBusinessEmailSyntax } from '@/lib/email-address'
import {
  buildApifyGoogleMapsActorInput,
  prepareMapsLeadContacts,
  resolveApifyMapsItems,
} from '@/lib/maps-lead-source'
import { buildGoogleSheetCsvUrl, prepareSheetContacts } from '@/lib/sheet-import'
import {
  publicSearchLeadsToContacts,
  searchPublicSearchLeads,
} from '@/lib/public-search-lead-source'
import {
  approvedContactQueueBlockers,
  enrichProspectWithProviderValidation,
  enrichProspectWithPublicEmailEvidence,
  prospectNeedsExactPublicEmailEvidence,
  scoreProspectForResearchApproval,
  type ProspectResearchContact,
  type ProspectResearchDecision,
} from '@/lib/prospect-research'
import { leadScoutToContacts, scoutOpenLeads, verifyOpenLeadEvidenceTimeboxed } from '@/lib/lead-scout'
import { notifyTelegramEvent } from '@/lib/telegram-notifications'
import { getOutboundTelegramDigest } from '@/lib/outbound-telegram-digest'
import { runOutboundEventRetention } from '@/lib/outbound-event-retention'
import {
  compactCycleBody,
  runOutboundCycleDirect,
  shouldRunOutboundCycleDirect,
} from '@/lib/outbound-cycle-direct'
import { enqueueOutboundCycleJob } from '@/lib/outbound-cycle-queue'
import { requestPublicOrigin } from '@/lib/request-origin'
import { reconcileBootstrapSendingDomain } from '@/lib/bootstrap-sending-domain'
import {
  buildSovereignCopyForLead,
  balanceSovereignOfferMix,
  inferSovereignOfferType,
  sovereignDealValueUsd,
  type SovereignCopyRagContext,
} from '@/lib/outbound-copy'
import { getSendingCapacityDiagnosis } from '@/lib/sending-capacity-diagnostics'

type StageResult = {
  stage:
    | 'lead_scout'
    | 'public_search'
    | 'maps_import'
    | 'sheet_import'
    | 'hunter_domain_search'
    | 'research_approval'
    | 'queue_outbound'
    | 'run_followups'
    | 'event_retention'
    | 'sender_reconcile'
  ok: boolean
  status: number
  skipped?: string
  data?: Record<string, unknown>
  error?: string
}

type ApprovedLead = {
  contact_id?: number
  email: string
  first_name: string
  company: string
  title?: string
  company_domain?: string
  consent_source: string
  reason_to_contact: string
  offer_type: 'direct' | 'agency'
  deal_value_usd: number
  customFields?: Record<string, unknown> | null
}

type ApprovedContactRow = {
  id: string
  email: string
  email_domain: string | null
  first_name: string | null
  company: string | null
  company_domain: string | null
  title: string | null
  source: string | null
  reason_to_contact: string | null
  custom_fields: Record<string, unknown> | null
  verification_status: string | null
  status: string | null
  bounced_at: string | null
  unsubscribed_at: string | null
}

type DiscoveryStageInput = {
  clientId: number
  dryRun: boolean
  limit: number
  industry?: string | null
  persona?: string | null
  region?: string | null
  evidenceDeadlineMs?: string | null
  evidenceMaxPagesPerLead?: string | null
  evidenceRequestTimeoutMs?: string | null
  skipEvidenceVerification?: boolean
}

const DIRECT_DISCOVERY_INDUSTRIES = ['ai', 'cybersecurity', 'devtools', 'saas']

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorize(request: NextRequest): boolean {
  const expected = appEnv.cronSecret()
  const provided =
    request.headers.get('x-cron-secret') ||
    request.nextUrl.searchParams.get('secret') ||
    ''
  return Boolean(expected && provided && provided === expected)
}

function safeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function requireExactPublicEmailEvidence(): boolean {
  return envBool(process.env.DAILY_OUTBOUND_REQUIRE_EXACT_PUBLIC_EMAIL_EVIDENCE, false)
}

function skipLeadEvidenceVerification(raw?: string | null): boolean {
  return envBool(raw || process.env.DAILY_OUTBOUND_SKIP_LEAD_EVIDENCE_VERIFICATION, false)
}

function isSmallMemoryRuntime(): boolean {
  const profile = String(process.env.WEB_MEMORY_PROFILE ?? '').trim().toLowerCase()
  if (profile) return profile === 'small' || profile === 'free'
  return envBool(process.env.RENDER, false)
}

function boundedEvidenceParam(raw: string | null, fallback: number, max: number): string | null {
  if (!isSmallMemoryRuntime()) return raw
  const parsed = Number.parseInt(raw ?? '', 10)
  const value = Number.isFinite(parsed) ? parsed : fallback
  return String(Math.max(1, Math.min(Math.trunc(value), max)))
}

function clampThreshold(value: unknown): number {
  const parsed = Number(value ?? 72)
  if (!Number.isFinite(parsed)) return 72
  return Math.max(50, Math.min(Math.trunc(parsed), 95))
}

function researchApprovalThreshold(growthMode: boolean): number {
  const fallback = growthMode ? 65 : 72
  return clampThreshold(process.env.DAILY_OUTBOUND_APPROVAL_THRESHOLD ?? fallback)
}

function getNumericField(data: unknown, key: string): number {
  if (!data || typeof data !== 'object') return 0
  const value = (data as Record<string, unknown>)[key]
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function getRecordCounts(data: unknown, key: string): Record<string, number> | undefined {
  if (!data || typeof data !== 'object') return undefined
  const value = (data as Record<string, unknown>)[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const counts: Record<string, number> = {}
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const safeKey = rawKey.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 80) || 'unknown'
    const parsed = Number(rawValue)
    if (Number.isFinite(parsed) && parsed > 0) {
      counts[safeKey] = Math.trunc(parsed)
    }
  }

  return Object.keys(counts).length > 0 ? counts : undefined
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(Math.trunc(parsed), max))
}

function resolveTargetDailyVolume(params: URLSearchParams): number {
  return Math.max(
    1,
    clampLimit(
      params.get('targetDailyVolume') ||
        process.env.DAILY_OUTBOUND_TARGET_DAILY_VOLUME ||
        process.env.TARGET_DAILY_VOLUME ||
        process.env.INFRASTRUCTURE_TARGET_DAILY_VOLUME,
      800,
      1_000_000
    )
  )
}

async function getSentToday(clientId: number): Promise<number> {
  const result = await query<{ sent_today: string }>(
    `SELECT COUNT(*)::text AS sent_today
     FROM events
     WHERE client_id = $1
       AND event_type = 'sent'
       AND created_at >= CURRENT_DATE`,
    [clientId]
  )

  return Number(result.rows[0]?.sent_today ?? 0)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function compactRagFact(value: unknown, max = 220): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max - 3)}...` : text
}

function pushRagFact(target: string[], label: string, value: unknown, max?: number) {
  const fact = compactRagFact(value, max)
  if (fact) target.push(`${label}: ${fact}`)
}

type CopyRagContactRow = {
  id: string
  email: string
  email_domain: string | null
  name: string | null
  company: string | null
  company_domain: string | null
  title: string | null
  source: string | null
  reason_to_contact: string | null
  verification_status: string | null
  custom_fields: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

type CopyRagEventRow = {
  contact_id: string | null
  event_type: string
  created_at: string
  metadata: Record<string, unknown> | null
}

async function loadCopyRagContexts(
  clientId: number,
  contactIds: number[]
): Promise<Map<number, SovereignCopyRagContext>> {
  const ids = Array.from(new Set(contactIds.filter((id) => Number.isSafeInteger(id))))
  const contexts = new Map<number, SovereignCopyRagContext>()
  if (ids.length === 0) return contexts

  const [contacts, events] = await Promise.all([
    query<CopyRagContactRow>(
      `SELECT
         id::text,
         email,
         email_domain,
         name,
         company,
         company_domain,
         title,
         source,
         custom_fields->>'reason_to_contact' AS reason_to_contact,
         verification_status,
         custom_fields,
         created_at::text,
         updated_at::text
       FROM contacts
       WHERE client_id = $1
         AND id = ANY($2::bigint[])`,
      [clientId, ids]
    ),
    query<CopyRagEventRow>(
      `SELECT
         contact_id::text,
         event_type,
         created_at::text,
         metadata
       FROM events
       WHERE client_id = $1
         AND contact_id = ANY($2::bigint[])
       ORDER BY created_at DESC
       LIMIT 300`,
      [clientId, ids]
    ),
  ])

  const eventsByContact = new Map<number, CopyRagEventRow[]>()
  for (const event of events.rows) {
    const contactId = Number(event.contact_id)
    if (!Number.isSafeInteger(contactId)) continue
    const bucket = eventsByContact.get(contactId) ?? []
    bucket.push(event)
    eventsByContact.set(contactId, bucket)
  }

  for (const contact of contacts.rows) {
    const contactId = Number(contact.id)
    if (!Number.isSafeInteger(contactId)) continue

    const customFields = contact.custom_fields ?? {}
    const evidenceFacts: string[] = []
    const accountSignals: string[] = []
    const riskSignals: string[] = []

    pushRagFact(evidenceFacts, 'reason', contact.reason_to_contact, 260)
    pushRagFact(evidenceFacts, 'public evidence', customFields.public_evidence_url)
    pushRagFact(evidenceFacts, 'research evidence', customFields.research_evidence_url)
    pushRagFact(evidenceFacts, 'linkedin', customFields.linkedin_url || customFields.linkedin_profile_url)
    pushRagFact(evidenceFacts, 'website', customFields.website || customFields.website_url || contact.company_domain)
    pushRagFact(accountSignals, 'fit score', customFields.fit_score)
    pushRagFact(accountSignals, 'email evidence', customFields.email_evidence)
    pushRagFact(accountSignals, 'validation verdict', customFields.email_validation_verdict || contact.verification_status)
    pushRagFact(accountSignals, 'source', contact.source)
    pushRagFact(accountSignals, 'offer path', customFields.offer_type || customFields.commercial_motion)
    pushRagFact(riskSignals, 'approval blocker', customFields.approval_blocked_reason)
    pushRagFact(riskSignals, 'queue status', customFields.send_status)

    const eventHistory = (eventsByContact.get(contactId) ?? []).slice(0, 8).map((event) => {
      const metadata = event.metadata ?? {}
      const subject = asString(metadata.subject)
      const offerType = asString(metadata.offer_type)
      const source = asString(metadata.copy_source)
      const detail = [subject && `subject=${subject}`, offerType && `offer=${offerType}`, source && `copy=${source}`]
        .filter(Boolean)
        .join('; ')
      return compactRagFact(`${event.created_at} ${event.event_type}${detail ? ` (${detail})` : ''}`, 240)
    })
    const replySignals = (eventsByContact.get(contactId) ?? [])
      .filter((event) => /reply|replied|positive|negative|unsubscribe/i.test(event.event_type))
      .slice(0, 5)
      .map((event) => {
        const metadata = event.metadata ?? {}
        return compactRagFact(
          `${event.created_at} ${event.event_type}: ${asString(metadata.intent) || asString(metadata.subject) || asString(metadata.summary)}`,
          240
        )
      })

    contexts.set(contactId, {
      contactFacts: {
        email: contact.email,
        emailDomain: contact.email_domain,
        name: contact.name,
        company: contact.company,
        companyDomain: contact.company_domain,
        title: contact.title,
        source: contact.source,
        verificationStatus: contact.verification_status,
        createdAt: contact.created_at,
        updatedAt: contact.updated_at,
      },
      evidenceFacts,
      eventHistory,
      replySignals,
      accountSignals,
      riskSignals,
    })
  }

  return contexts
}

function splitDiscoveryLimit(limit: number): { agency: number; direct: number } {
  const normalized = Math.max(0, Math.trunc(limit))
  if (normalized <= 1) return { agency: normalized, direct: 0 }
  const agency = Math.ceil(normalized / 2)
  return { agency, direct: normalized - agency }
}

function resolveDirectDiscoveryIndustry(): string {
  const configured = (process.env.DAILY_OUTBOUND_DIRECT_INDUSTRIES || process.env.LEAD_SCOUT_DIRECT_INDUSTRIES || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => DIRECT_DISCOVERY_INDUSTRIES.includes(value))
  const industries = configured.length > 0 ? configured : DIRECT_DISCOVERY_INDUSTRIES
  const rotationIndex = Math.floor(Date.now() / 3_600_000) % industries.length
  return industries[rotationIndex] || 'ai'
}

function combineDiscoveryStages(
  stageName: 'lead_scout' | 'public_search',
  stages: StageResult[],
  input: { limit: number; directIndustry: string }
): StageResult {
  const sum = (field: string) =>
    stages.reduce((total, stage) => total + Number(stage.data?.[field] ?? 0), 0)
  const firstError = stages.find((stage) => !stage.ok)?.error

  return {
    stage: stageName,
    ok: stages.every((stage) => stage.ok),
    status: firstError ? 207 : 200,
    error: firstError,
    data: {
      balancedDiscovery: true,
      mixPolicy: 'target_50_50_source_supply',
      limit: input.limit,
      agencyIndustry: 'agency',
      directIndustry: input.directIndustry,
      imported: sum('imported'),
      scanned: sum('scanned'),
      prepared: sum('prepared'),
      rejected: sum('rejected'),
      evidenceBacked: sum('evidenceBacked'),
      blockedUnverified: sum('blockedUnverified'),
      agency: stages[0]?.data ?? null,
      direct: stages[1]?.data ?? null,
    },
  }
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

function isSameRootDomain(left: string, right: string): boolean {
  return Boolean(left && right && rootDomain(left) === rootDomain(right))
}

const SAFE_HUNTER_MAILBOX_PREFIXES = new Set([
  'bd',
  'business',
  'contact',
  'growth',
  'hello',
  'hi',
  'info',
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

const BLOCKED_HUNTER_MAILBOX_PREFIXES = new Set([
  'abuse',
  'admin',
  'accounting',
  'billing',
  'career',
  'careers',
  'compliance',
  'copyright',
  'customer',
  'customerservice',
  'dmca',
  'donotreply',
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
  'media',
  'news',
  'no-reply',
  'noreply',
  'orders',
  'payroll',
  'postmaster',
  'pr',
  'press',
  'privacy',
  'security',
  'support',
  'tax',
  'webmaster',
])

const VALIDATION_PRIORITY_PREFIXES = new Set([
  'business',
  'contact',
  'growth',
  'hello',
  'hi',
  'info',
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

function firstHunterSourceUrl(email: HunterDomainEmail): string {
  return email.sources.find((source) => asString(source.uri))?.uri || ''
}

function hunterEmailRejectionReason(input: {
  email: HunterDomainEmail
  domain: string
  minConfidence: number
}): string | null {
  const value = input.email.value.trim().toLowerCase()
  if (!validateBusinessEmailSyntax(value).valid) return 'invalid_email'
  const [prefix = '', emailDomain = ''] = value.split('@')
  if (!isSameRootDomain(emailDomain, input.domain)) return 'domain_mismatch'
  if (input.email.confidence < input.minConfidence) return 'low_confidence'
  if (BLOCKED_HUNTER_MAILBOX_PREFIXES.has(prefix)) return 'blocked_mailbox'
  if (!firstHunterSourceUrl(input.email)) return 'missing_public_source'

  if (SAFE_HUNTER_MAILBOX_PREFIXES.has(prefix)) return null

  // Hunter can return source-backed named corporate contacts. Permit only
  // high-confidence named contacts; never guessed/pattern-only addresses.
  const isNamedCorporate =
    input.email.type === 'personal' &&
    Boolean(input.email.firstName && input.email.lastName) &&
    input.email.confidence >= Math.max(input.minConfidence, 90)

  return isNamedCorporate ? null : 'unsafe_mailbox_role'
}

function hunterName(email: HunterDomainEmail): string | undefined {
  return [email.firstName, email.lastName].filter(Boolean).join(' ') || undefined
}

async function maybeRunDailyMaintenance(clientId: number): Promise<{
  ran: boolean
  reason: string
  lastResetAt: string | null
  domainsProcessed?: number
}> {
  if (!envBool(process.env.DAILY_OUTBOUND_AUTO_MAINTENANCE, true)) {
    return { ran: false, reason: 'auto_maintenance_disabled', lastResetAt: null }
  }

  const row = await query<{ last_reset_at: string | null }>(
    `SELECT MAX(last_reset_at)::text AS last_reset_at
     FROM domains
     WHERE client_id = $1`,
    [clientId]
  )
  const lastResetAt = row.rows[0]?.last_reset_at ?? null
  const now = new Date()
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const lastResetTime = lastResetAt ? new Date(lastResetAt).getTime() : 0

  if (lastResetAt && Number.isFinite(lastResetTime) && lastResetTime >= todayUtc) {
    return { ran: false, reason: 'already_reset_today', lastResetAt }
  }

  const result = await runDailyMaintenance(clientId)

  return {
    ran: true,
    reason: lastResetAt ? 'stale_daily_reset' : 'missing_daily_reset',
    lastResetAt,
    domainsProcessed: result.domainsProcessed,
  }
}

function leadScoutOffset(limit: number): number {
  const rotationMinutes = clampLimit(process.env.LEAD_SCOUT_ROTATION_MINUTES, 60, 1_440)
  const windowMs = Math.max(rotationMinutes, 15) * 60_000
  return Math.floor(Date.now() / windowMs) * limit
}

function resolvePublicSearchQueries(value: string | null | undefined): string[] | undefined {
  const raw = String(value || process.env.PUBLIC_SEARCH_QUERIES || process.env.SERPAPI_SEARCHES || '').trim()
  if (!raw) return undefined
  return raw
    .split(/\n|,/)
    .map((query) => query.trim())
    .filter(Boolean)
    .slice(0, 20)
}

function numberFromValue(value: unknown, fallback: number): number {
  const raw = typeof value === 'string' ? value.trim() : value
  if (raw === '' || raw === undefined || raw === null) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function resolveLeadScoutEvidenceOptions(input: {
  deadlineMs?: unknown
  maxPagesPerLead?: unknown
  requestTimeoutMs?: unknown
}) {
  return {
    deadlineMs: Math.max(
      5_000,
      Math.min(
        numberFromValue(input.deadlineMs, numberFromValue(process.env.LEAD_SCOUT_EVIDENCE_DEADLINE_MS, 25_000)),
        55_000
      )
    ),
    maxPagesPerLead: Math.max(
      3,
      Math.min(
        numberFromValue(input.maxPagesPerLead, numberFromValue(process.env.LEAD_SCOUT_EVIDENCE_MAX_PAGES, 8)),
        12
      )
    ),
    requestTimeoutMs: Math.max(
      800,
      Math.min(
        numberFromValue(
          input.requestTimeoutMs,
          numberFromValue(process.env.LEAD_SCOUT_EVIDENCE_REQUEST_TIMEOUT_MS, 2_000)
        ),
        4_000
      )
    ),
  }
}

function compactStage(stage: StageResult): StageResult {
  if (!stage.data) return stage
  const data = stage.data
  return {
    ...stage,
    data: {
      imported: getNumericField(data, 'imported'),
      prepared: getNumericField(data, 'prepared'),
      rejected: getNumericField(data, 'rejected'),
      scanned: getNumericField(data, 'scanned'),
      evidenceFetches: getNumericField(data, 'evidenceFetches'),
      evidenceMatches: getNumericField(data, 'evidenceMatches'),
      queriesRun: getNumericField(data, 'queriesRun'),
      providerValidationChecks: getNumericField(data, 'providerValidationChecks'),
      providerValidationValid: getNumericField(data, 'providerValidationValid'),
      providerValidationInvalid: getNumericField(data, 'providerValidationInvalid'),
      providerValidationRisky: getNumericField(data, 'providerValidationRisky'),
      providerValidationUnknown: getNumericField(data, 'providerValidationUnknown'),
      providerValidationBlocked: getNumericField(data, 'providerValidationBlocked'),
      staleInvalidBlocked: getNumericField(data, 'staleInvalidBlocked'),
      hunterErrors: getNumericField(data, 'hunterErrors'),
      errorCounts: getRecordCounts(data, 'errorCounts'),
      rejectionCounts: getRecordCounts(data, 'rejectionCounts'),
      providerValidationProviderCounts: getRecordCounts(data, 'providerValidationProviderCounts'),
      providerValidationErrorCounts: getRecordCounts(data, 'providerValidationErrorCounts'),
      approved: getNumericField(data, 'approved'),
      queued: getNumericField(data, 'queued'),
      blockedUnverified: getNumericField(data, 'blockedUnverified'),
      skipped: typeof data.skipped === 'string' ? data.skipped : undefined,
      queue: typeof data.queue === 'string' ? data.queue : undefined,
      datasetId: typeof data.datasetId === 'string' ? data.datasetId : undefined,
      taskId: typeof data.taskId === 'string' ? data.taskId : undefined,
      actorId: typeof data.actorId === 'string' ? data.actorId : undefined,
      provider: typeof data.provider === 'string' ? data.provider : undefined,
      sourceType: typeof data.sourceType === 'string' ? data.sourceType : undefined,
      estimatedPipelineValueUsd: getNumericField(data, 'estimatedPipelineValueUsd'),
      agencyQueued: getNumericField(data, 'agencyQueued'),
      directQueued: getNumericField(data, 'directQueued'),
      processed: getNumericField(data, 'processed'),
      emailsSent: getNumericField(data, 'emailsSent'),
      sequencesCompleted: getNumericField(data, 'sequencesCompleted'),
      errorsCount: getNumericField(data, 'errorsCount'),
      brevoFailuresDeleted: getNumericField(data, 'brevoFailuresDeleted'),
      staleGuardrailFailuresDeleted: getNumericField(data, 'staleGuardrailFailuresDeleted'),
      staleFailuresDeleted: getNumericField(data, 'staleFailuresDeleted'),
      bodiesRedacted: getNumericField(data, 'bodiesRedacted'),
      bootstrapped: getNumericField(data, 'bootstrapped'),
    },
  }
}

async function runEventRetentionStage(clientId: number): Promise<StageResult> {
  try {
    const data = await runOutboundEventRetention(clientId)
    return {
      stage: 'event_retention',
      ok: true,
      status: 200,
      data,
    }
  } catch (error) {
    return {
      stage: 'event_retention',
      ok: false,
      status: 500,
      error: safeError(error),
    }
  }
}

async function runSenderReconcileStage(clientId: number): Promise<StageResult> {
  try {
    const data = await reconcileBootstrapSendingDomain({ clientId })
    return {
      stage: 'sender_reconcile',
      ok: true,
      status: data.enabled ? 200 : 204,
      skipped: data.enabled ? undefined : data.reason,
      data: {
        enabled: data.enabled,
        markAuthValid: data.markAuthValid,
        domainDailyLimit: data.domainDailyLimit,
        identityDailyLimit: data.identityDailyLimit,
        bootstrapped: data.bootstrapped.length,
        domains: Array.from(new Set(data.bootstrapped.map((item) => item.domain))),
        identities: data.bootstrapped.map((item) => item.email),
      },
    }
  } catch (error) {
    return {
      stage: 'sender_reconcile',
      ok: false,
      status: 500,
      error: safeError(error),
    }
  }
}

async function runLeadScoutStage(input: DiscoveryStageInput): Promise<StageResult> {
  try {
    const defaultIndustry =
      process.env.DAILY_OUTBOUND_PRIMARY_INDUSTRY ||
      process.env.DAILY_OUTBOUND_RESEARCH_INDUSTRY ||
      'agency'
    const result = scoutOpenLeads({
      industry: input.industry || defaultIndustry,
      persona: input.persona || process.env.LEAD_SCOUT_PERSONA || 'partnerships',
      region: input.region || process.env.LEAD_SCOUT_REGION || 'global',
      limit: input.limit,
      offset: leadScoutOffset(input.limit),
    })
    const skippedEvidenceVerification = Boolean(input.skipEvidenceVerification)
    const verifiedLeads = skippedEvidenceVerification
      ? result.leads
      : await verifyOpenLeadEvidenceTimeboxed(result.leads, {
          ...resolveLeadScoutEvidenceOptions({
            deadlineMs: input.evidenceDeadlineMs,
            maxPagesPerLead: input.evidenceMaxPagesPerLead,
            requestTimeoutMs: input.evidenceRequestTimeoutMs,
          }),
        })
    const importableLeads = requireExactPublicEmailEvidence()
      ? verifiedLeads.filter((lead) => lead.autoApprovalEligible)
      : verifiedLeads
    const evidenceBacked = verifiedLeads.filter((lead) => lead.autoApprovalEligible).length
    const contacts = input.dryRun
      ? []
      : await importContacts(input.clientId, {
          contacts: leadScoutToContacts(importableLeads),
          verify: false,
          enrich: false,
          dedupeByDomain: true,
        })

    if (!input.dryRun) {
      void notifyTelegramEvent({
        type: 'lead_scout',
        imported: contacts.length,
        scanned: result.leads.length,
        evidenceBacked,
        blockedUnverified: requireExactPublicEmailEvidence() ? verifiedLeads.length - importableLeads.length : 0,
        industry: result.industry,
        persona: result.persona,
      })
    }

    return {
      stage: 'lead_scout',
      ok: true,
      status: 200,
      data: {
        dryRun: input.dryRun,
        imported: contacts.length,
        scanned: result.leads.length,
        evidenceBacked,
        blockedUnverified: requireExactPublicEmailEvidence() ? verifiedLeads.length - importableLeads.length : 0,
        skippedEvidenceVerification,
        industry: result.industry,
        persona: result.persona,
        region: result.region,
        guardrails: result.guardrails,
      },
    }
  } catch (error) {
    return {
      stage: 'lead_scout',
      ok: false,
      status: 0,
      error: safeError(error),
    }
  }
}

async function runBalancedLeadScoutStage(input: DiscoveryStageInput): Promise<StageResult> {
  if (asString(input.industry)) {
    return runLeadScoutStage(input)
  }

  const limits = splitDiscoveryLimit(input.limit)
  const directIndustry = resolveDirectDiscoveryIndustry()
  const stages = [
    await runLeadScoutStage({ ...input, limit: limits.agency, industry: 'agency' }),
    ...(limits.direct > 0
      ? [await runLeadScoutStage({ ...input, limit: limits.direct, industry: directIndustry })]
      : []),
  ]

  return combineDiscoveryStages('lead_scout', stages, {
    limit: input.limit,
    directIndustry,
  })
}

async function runPublicSearchStage(input: DiscoveryStageInput & { queries?: string[] | undefined }): Promise<StageResult> {
  try {
    const apiKey = process.env.SERPAPI_API_KEY || process.env.PUBLIC_SEARCH_SERPAPI_KEY || ''
    const defaultIndustry =
      process.env.DAILY_OUTBOUND_PRIMARY_INDUSTRY ||
      process.env.DAILY_OUTBOUND_RESEARCH_INDUSTRY ||
      'agency'

    const result = await searchPublicSearchLeads({
      provider: apiKey ? 'serpapi' : 'bing_html',
      apiKey,
      industry: input.industry || defaultIndustry,
      persona: input.persona || process.env.LEAD_SCOUT_PERSONA || 'founder',
      region: input.region || process.env.LEAD_SCOUT_REGION || process.env.APIFY_GOOGLE_MAPS_LOCATION || 'United States',
      limit: input.limit,
      timeoutMs: numberFromValue(process.env.PUBLIC_SEARCH_TIMEOUT_MS, 55_000),
      queries: input.queries,
    })
    const skippedEvidenceVerification = Boolean(input.skipEvidenceVerification)
    const verifiedLeads = skippedEvidenceVerification
      ? result.leads
      : await verifyOpenLeadEvidenceTimeboxed(result.leads, {
          ...resolveLeadScoutEvidenceOptions({
            deadlineMs: input.evidenceDeadlineMs,
            maxPagesPerLead: input.evidenceMaxPagesPerLead,
            requestTimeoutMs: input.evidenceRequestTimeoutMs,
          }),
        })
    const importableLeads = requireExactPublicEmailEvidence()
      ? verifiedLeads.filter((lead) => lead.autoApprovalEligible)
      : verifiedLeads
    const evidenceBacked = verifiedLeads.filter((lead) => lead.autoApprovalEligible).length
    const contacts = input.dryRun
      ? []
      : await importContacts(input.clientId, {
          contacts: publicSearchLeadsToContacts(importableLeads),
          verify: false,
          enrich: false,
          dedupeByDomain: true,
        })

    if (!input.dryRun) {
      void notifyTelegramEvent({
        type: 'lead_scout',
        imported: contacts.length,
        scanned: result.scannedResults,
        evidenceBacked,
        blockedUnverified: requireExactPublicEmailEvidence() ? verifiedLeads.length - importableLeads.length : 0,
        industry: result.industry,
        persona: result.persona,
      })
    }

    return {
      stage: 'public_search',
      ok: true,
      status: 200,
      data: {
        dryRun: input.dryRun,
        provider: result.provider,
        imported: contacts.length,
        scanned: result.scannedResults,
        prepared: result.leads.length,
        rejected: result.rejected,
        evidenceBacked,
        blockedUnverified: requireExactPublicEmailEvidence() ? verifiedLeads.length - importableLeads.length : 0,
        skippedEvidenceVerification,
        queriesRun: result.queriesRun,
        errorsCount: result.errors.length,
        errorCounts: result.errors.reduce<Record<string, number>>((acc, error) => {
          acc[error] = (acc[error] ?? 0) + 1
          return acc
        }, {}),
        industry: result.industry,
        persona: result.persona,
        region: result.region,
        guardrails: result.guardrails,
      },
    }
  } catch (error) {
    return {
      stage: 'public_search',
      ok: false,
      status: 0,
      error: safeError(error),
    }
  }
}

async function runBalancedPublicSearchStage(
  input: DiscoveryStageInput & { queries?: string[] | undefined }
): Promise<StageResult> {
  if (asString(input.industry) || input.queries?.length) {
    return runPublicSearchStage(input)
  }

  const limits = splitDiscoveryLimit(input.limit)
  const directIndustry = resolveDirectDiscoveryIndustry()
  const stages = [
    await runPublicSearchStage({ ...input, limit: limits.agency, industry: 'agency' }),
    ...(limits.direct > 0
      ? [await runPublicSearchStage({ ...input, limit: limits.direct, industry: directIndustry })]
      : []),
  ]

  return combineDiscoveryStages('public_search', stages, {
    limit: input.limit,
    directIndustry,
  })
}

async function runSheetImport(input: {
  clientId: number
  dryRun: boolean
  sheetUrl: string
  sheetLimit: number
}): Promise<StageResult> {
  try {
    const csvUrl = buildGoogleSheetCsvUrl(input.sheetUrl)
    const response = await fetch(csvUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })

    if (!response.ok) {
      return {
        stage: 'sheet_import',
        ok: false,
        status: response.status,
        error: `Google Sheet CSV export returned HTTP ${response.status}`,
      }
    }

    const csv = await response.text()
    if (/<!doctype html|<html/i.test(csv.slice(0, 500))) {
      return {
        stage: 'sheet_import',
        ok: false,
        status: 400,
        error: 'Google Sheet did not return CSV. Share it as "Anyone with the link can view".',
      }
    }

    const prepared = prepareSheetContacts(csv, {
      sourceUrl: input.sheetUrl,
      limit: input.sheetLimit,
      dedupeByDomain: true,
    })
    const imported = input.dryRun
      ? []
      : await importContacts(input.clientId, {
          contacts: prepared.contacts,
          verify: false,
          enrich: false,
          dedupeByDomain: true,
        })

    if (!input.dryRun) {
      void notifyTelegramEvent({
        type: 'sheet_import',
        imported: imported.length,
        prepared: prepared.contacts.length,
        rejected: prepared.rejected.length,
        evidenceBacked: prepared.summary.evidenceBacked,
        sheetUrl: input.sheetUrl,
      })
    }

    return {
      stage: 'sheet_import',
      ok: true,
      status: 200,
      data: {
        dryRun: input.dryRun,
        imported: imported.length,
        prepared: prepared.contacts.length,
        rejected: prepared.rejected.length,
        summary: prepared.summary,
      },
    }
  } catch (error) {
    return {
      stage: 'sheet_import',
      ok: false,
      status: 0,
      error: safeError(error),
    }
  }
}

async function runMapsImport(input: {
  clientId: number
  dryRun: boolean
  datasetId: string
  mapsLimit: number
  taskId?: string
  actorId?: string
  actorInput?: Record<string, unknown>
  industry?: string | null
  region?: string | null
}): Promise<StageResult> {
  try {
    const token = process.env.APIFY_API_TOKEN || ''
    if (!token) {
      return {
        stage: 'maps_import',
        ok: false,
        status: 400,
        error: 'APIFY_API_TOKEN is not configured',
      }
    }

    const taskId =
      input.taskId ||
      process.env.APIFY_GOOGLE_MAPS_TASK_ID ||
      process.env.GOOGLE_MAPS_APIFY_TASK_ID ||
      ''
    const actorId =
      input.actorId ||
      process.env.APIFY_GOOGLE_MAPS_ACTOR_ID ||
      process.env.GOOGLE_MAPS_APIFY_ACTOR_ID ||
      ''
    const preferLiveRun = envBool(process.env.APIFY_GOOGLE_MAPS_PREFER_LIVE_RUN, true)

    const resolved = await resolveApifyMapsItems({
      // Fresh actor/task runs must win over stale datasets. Dataset fallback stays available
      // for cheap recovery when no live Apify runner is configured.
      requestedDatasetId: preferLiveRun && (taskId || actorId) ? '' : input.datasetId,
      taskId,
      actorId,
      actorInput: input.actorInput,
      token,
      limit: input.mapsLimit,
      datasetDiscoveryLimit: Math.max(1, Math.min(Number(process.env.APIFY_DATASET_DISCOVERY_LIMIT ?? 20), 100)),
      taskTimeoutSecs: Math.max(30, Math.min(Number(process.env.APIFY_TASK_TIMEOUT_SECONDS ?? 120), 300)),
    })
    const prepared = prepareMapsLeadContacts(resolved.items, {
      sourceName: 'apify_google_maps',
      sourceUrl: resolved.sourceUrl,
      limit: input.mapsLimit,
      dedupeByDomain: true,
      industry: input.industry || process.env.GOOGLE_MAPS_INDUSTRY || 'agency',
      region: input.region || process.env.GOOGLE_MAPS_REGION || 'global',
    })
    const imported = input.dryRun
      ? []
      : await importContacts(input.clientId, {
          contacts: prepared.contacts,
          verify: false,
          enrich: false,
          dedupeByDomain: true,
        })
    const rejectionReasons = prepared.rejected.reduce<Record<string, number>>((acc, item) => {
      const reason = String(item.reason || 'unknown')
      acc[reason] = (acc[reason] || 0) + 1
      return acc
    }, {})

    if (!input.dryRun) {
      void notifyTelegramEvent({
        type: 'maps_import',
        imported: imported.length,
        prepared: prepared.contacts.length,
        rejected: prepared.rejected.length,
        evidenceBacked: prepared.summary.evidenceBacked,
        datasetId: resolved.datasetId || resolved.taskId || null,
        source: 'apify_google_maps',
        rejectionReasons,
      })
    }

    return {
      stage: 'maps_import',
      ok: true,
      status: 200,
      data: {
        dryRun: input.dryRun,
        imported: imported.length,
        scanned: resolved.items.length,
        prepared: prepared.contacts.length,
        rejected: prepared.rejected.length,
        evidenceBacked: prepared.summary.evidenceBacked,
        datasetId: resolved.datasetId || null,
        taskId: resolved.taskId || null,
        actorId: resolved.actorId || null,
        sourceType: resolved.sourceType,
        sourceUrl: resolved.sourceUrl,
        liveRunPreferred: preferLiveRun,
        staleDatasetBypassed: Boolean(preferLiveRun && (taskId || actorId) && input.datasetId),
        duplicateOrSkipped: Math.max(0, prepared.contacts.length - imported.length),
        rejectionReasons,
      },
    }
  } catch (error) {
    return {
      stage: 'maps_import',
      ok: false,
      status: 0,
      error: safeError(error),
    }
  }
}

async function loadHunterSearchDomains(clientId: number, limit: number) {
  const result = await query<{
    domain: string
    company: string | null
    evidence_url: string | null
  }>(
    `SELECT
       LOWER(COALESCE(NULLIF(company_domain, ''), NULLIF(email_domain, ''))) AS domain,
       MAX(NULLIF(company, '')) AS company,
       MAX(NULLIF(COALESCE(custom_fields->>'public_evidence_url', custom_fields->>'research_evidence_url', custom_fields->>'source_url'), '')) AS evidence_url
     FROM contacts
     WHERE client_id = $1
       AND status = 'active'
       AND bounced_at IS NULL
       AND unsubscribed_at IS NULL
       AND COALESCE(NULLIF(company_domain, ''), NULLIF(email_domain, '')) IS NOT NULL
       AND COALESCE(custom_fields->>'send_status', 'not_approved') <> 'queued'
     GROUP BY LOWER(COALESCE(NULLIF(company_domain, ''), NULLIF(email_domain, '')))
     HAVING LOWER(COALESCE(NULLIF(company_domain, ''), NULLIF(email_domain, ''))) !~ '(example|localhost|\\.local)$'
     ORDER BY MAX(updated_at) DESC
     LIMIT $2`,
    [clientId, limit]
  )

  return result.rows
}

async function runHunterDomainSearch(input: {
  clientId: number
  dryRun: boolean
  domainLimit: number
  emailsPerDomain: number
  minConfidence: number
}): Promise<StageResult> {
  try {
    if (!process.env.HUNTER_API_KEY) {
      return {
        stage: 'hunter_domain_search',
        ok: false,
        status: 400,
        error: 'HUNTER_API_KEY is not configured',
      }
    }

    const domains = await loadHunterSearchDomains(input.clientId, input.domainLimit)
    const contacts: ContactInput[] = []
    let searched = 0
    let rejected = 0
    let hunterErrors = 0
    const errorCounts: Record<string, number> = {}
    const rejectionCounts: Record<string, number> = {}

    const count = (bucket: Record<string, number>, key: string) => {
      bucket[key] = (bucket[key] ?? 0) + 1
    }

    for (const row of domains) {
      const domain = normalizeDomain(row.domain)
      if (!domain) continue
      searched += 1

      const result = await searchDomainWithHunter(domain, {
        limit: input.emailsPerDomain,
        timeoutMs: 10_000,
      })

      if (result.error) {
        hunterErrors += 1
        count(errorCounts, result.error)
        continue
      }

      for (const email of result.emails) {
        const rejectionReason = hunterEmailRejectionReason({
          email,
          domain,
          minConfidence: input.minConfidence,
        })
        if (rejectionReason) {
          rejected += 1
          count(rejectionCounts, rejectionReason)
          continue
        }

        const sourceUrl = firstHunterSourceUrl(email)
        const company = result.organization || row.company || domain
        contacts.push({
          email: email.value,
          name: hunterName(email),
          company,
          companyDomain: domain,
          title: email.position || email.department || 'business team',
          source: 'hunter_domain_search',
          customFields: {
            hunter_domain_search: true,
            data_source: 'hunter_domain_search',
            consent_source: 'hunter_public_domain_search',
            public_evidence_url: sourceUrl,
            research_evidence_url: sourceUrl,
            source_url: sourceUrl,
            email_evidence: 'hunter_domain_search',
            email_validation_provider: 'hunter_domain_search',
            email_validation_score: Number((email.confidence / 100).toFixed(2)),
            email_validation_verdict: 'valid',
            hunter_confidence: email.confidence,
            hunter_type: email.type,
            hunter_department: email.department,
            hunter_seniority: email.seniority,
            hunter_linkedin: email.linkedin,
            auto_approval_eligible: true,
            fit_score: Math.max(70, Math.min(98, email.confidence)),
            reason_to_contact: `${company} has public Hunter-sourced business contact evidence and appears relevant to outbound infrastructure or AI security risk review.`,
          },
        })
      }
    }

    const imported = input.dryRun
      ? []
      : await importContacts(input.clientId, {
          contacts,
          verify: false,
          enrich: false,
          dedupeByDomain: false,
        })

    if (!input.dryRun) {
      void notifyTelegramEvent({
        type: 'hunter_domain_search',
        imported: imported.length,
        scanned: searched,
        rejected,
        failures: hunterErrors,
      })
    }

    return {
      stage: 'hunter_domain_search',
      ok: true,
      status: 200,
      data: {
        dryRun: input.dryRun,
        scanned: searched,
        prepared: contacts.length,
        imported: imported.length,
        rejected,
        hunterErrors,
        errorCounts,
        rejectionCounts,
        minConfidence: input.minConfidence,
      },
    }
  } catch (error) {
    return {
      stage: 'hunter_domain_search',
      ok: false,
      status: 0,
      error: safeError(error),
    }
  }
}

async function getResearchPool(clientId: number) {
  const result = await query<ProspectResearchContact & { created_at: string }>(
    `SELECT
       id,
       email,
       email_domain,
       company,
       company_domain,
       title,
       source,
       custom_fields,
       verification_status,
       status,
       unsubscribed_at,
       bounced_at,
       created_at
     FROM contacts
     WHERE client_id = $1
       AND status = 'active'
       AND bounced_at IS NULL
       AND unsubscribed_at IS NULL
       AND COALESCE(custom_fields->>'send_status', 'not_approved') NOT IN ('approved', 'queued', 'blocked', 'review')
       AND COALESCE(verification_status, 'pending') NOT IN ('invalid', 'do_not_mail')
       AND (
         source IN ('google_sheet_import', 'google_maps_apify', 'hunter_domain_search', 'open_lead_graph', 'owned_open_lead_graph', 'public_search')
         OR COALESCE(custom_fields->>'sheet_import', 'false') = 'true'
         OR COALESCE(custom_fields->>'maps_import', 'false') = 'true'
         OR COALESCE(custom_fields->>'hunter_domain_search', 'false') = 'true'
         OR COALESCE(custom_fields->>'lead_scout', 'false') = 'true'
         OR COALESCE(custom_fields->>'public_search', 'false') = 'true'
       )
     ORDER BY
       CASE
         WHEN verification_status = 'valid' THEN 0
         WHEN COALESCE(custom_fields->>'email_validation_verdict', '') = 'valid' THEN 1
         WHEN COALESCE(custom_fields->>'email_evidence', '') IN ('provider_validated', 'hunter_domain_search', 'public_page_email_match', 'public_mailto_match', 'public_domain_email') THEN 2
         ELSE 3
       END,
       CASE
         WHEN COALESCE(custom_fields->>'fit_score', '') ~ '^[0-9]+$'
         THEN (custom_fields->>'fit_score')::int
         ELSE 0
       END DESC,
       updated_at ASC,
       created_at ASC
     LIMIT 5000`,
    [clientId]
  )

  return result.rows
}

function researchValidationPriority(contact: ProspectResearchContact): number {
  const customFields = contact.custom_fields ?? {}
  const email = contact.email.trim().toLowerCase()
  const [prefix = ''] = email.split('@')
  const verificationStatus = String(contact.verification_status ?? 'pending').toLowerCase()
  let score = 0

  if (verificationStatus === 'valid') score += 1_000
  if (asString(customFields.email_validation_verdict) === 'valid') score += 500
  if (asString(customFields.email_evidence)) score += 150
  if (asString(customFields.public_evidence_url) || asString(customFields.research_evidence_url)) {
    score += 100
  }
  if (VALIDATION_PRIORITY_PREFIXES.has(prefix)) score += 80
  if (asBool(customFields.auto_approval_eligible)) score += 60
  score += Math.min(Number(customFields.fit_score) || 0, 100)

  return score
}

function rankResearchPool(pool: ProspectResearchContact[]): ProspectResearchContact[] {
  return [...pool].sort(
    (left, right) =>
      researchValidationPriority(right) - researchValidationPriority(left) ||
      left.email.localeCompare(right.email)
  )
}

function balanceResearchApprovalMix(
  decisions: ProspectResearchDecision[],
  contactById: Map<number, ProspectResearchContact>,
  limit: number
): ProspectResearchDecision[] {
  const normalizedLimit = Math.max(0, Math.trunc(limit))
  if (normalizedLimit <= 0) return []

  const ranked = [...decisions].sort((a, b) => b.score - a.score || a.email.localeCompare(b.email))
  const agency = ranked.filter((decision) => {
    const contact = contactById.get(decision.id)
    if (!contact) return false
    return inferSovereignOfferType({
      company: contact.company,
      companyDomain: contact.company_domain,
      title: contact.title,
      source: contact.source,
      reasonToContact: asString(contact.custom_fields?.reason_to_contact),
      customFields: contact.custom_fields,
    }) === 'agency'
  })
  const direct = ranked.filter((decision) => !agency.includes(decision))
  const balancedPairs = Math.min(Math.floor(normalizedLimit / 2), agency.length, direct.length)
  const targetAgency = balancedPairs
  const targetDirect = balancedPairs
  const selected = [
    ...agency.slice(0, targetAgency),
    ...direct.slice(0, targetDirect),
  ]

  return selected
}

function decorateProviderValidationUpdate(contact: ProspectResearchContact): ProspectResearchContact {
  const verificationStatus = String(contact.verification_status ?? '').toLowerCase()
  const customFields = contact.custom_fields ?? {}

  if (!['invalid', 'do_not_mail'].includes(verificationStatus)) {
    return contact
  }

  return {
    ...contact,
    custom_fields: {
      ...customFields,
      send_status: 'blocked',
      approval_required: true,
      approval_blocked_reason: `provider_verification_${verificationStatus}`,
      blocked_by: 'daily_provider_validation_gate',
      blocked_at: new Date().toISOString(),
    },
  }
}

async function blockPreviouslyInvalidContacts(clientId: number): Promise<number> {
  const result = await query(
    `UPDATE contacts
     SET custom_fields = COALESCE(custom_fields, '{}'::jsonb)
       || jsonb_build_object(
         'send_status', 'blocked',
         'approval_required', true,
         'approval_blocked_reason', 'existing_invalid_verification',
         'blocked_by', 'daily_provider_validation_gate',
         'blocked_at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       ),
       updated_at = CURRENT_TIMESTAMP
     WHERE client_id = $1
       AND status = 'active'
       AND COALESCE(verification_status, 'pending') IN ('invalid', 'do_not_mail')
       AND COALESCE(custom_fields->>'send_status', 'not_approved') NOT IN ('blocked', 'queued')
       AND bounced_at IS NULL
       AND unsubscribed_at IS NULL`,
    [clientId]
  )

  return result.rowCount ?? 0
}

async function runResearchApproval(input: {
  clientId: number
  dryRun: boolean
  approveLimit: number
  evidenceFetchLimit?: number
  providerValidationLimit?: number
  recoveryMode?: boolean
  growthMode?: boolean
}): Promise<StageResult> {
  try {
    const threshold = researchApprovalThreshold(Boolean(input.growthMode))
    const recoveryMode = Boolean(input.recoveryMode)
    const staleInvalidBlocked = input.dryRun ? 0 : await blockPreviouslyInvalidContacts(input.clientId)
    const pool = rankResearchPool(await getResearchPool(input.clientId))
    const evidenceFetchLimit = clampLimit(
      input.evidenceFetchLimit ??
        (input.dryRun ? 0 : process.env.DAILY_OUTBOUND_EVIDENCE_FETCH_LIMIT),
      input.dryRun ? 0 : recoveryMode ? 10 : 5,
      input.dryRun ? (recoveryMode ? 20 : 5) : recoveryMode ? 40 : 20
    )
    const providerValidationLimit = clampLimit(
      input.providerValidationLimit ??
        (input.dryRun ? 0 : process.env.DAILY_OUTBOUND_PROVIDER_VALIDATION_LIMIT),
      input.dryRun
        ? recoveryMode || input.growthMode
          ? 10
          : 0
        : recoveryMode || input.growthMode
          ? 100
          : 5,
      input.dryRun
        ? recoveryMode || input.growthMode
          ? 50
          : 5
        : recoveryMode || input.growthMode
          ? 250
          : 20
    )
    const networkDeadlineMs = input.dryRun ? (recoveryMode ? 20_000 : 8_000) : 45_000
    const networkDeadlineAt = Date.now() + networkDeadlineMs
    let evidenceFetches = 0
    let evidenceMatches = 0
    let providerValidationChecks = 0
    let providerValidationValid = 0
    let providerValidationInvalid = 0
    let providerValidationRisky = 0
    let providerValidationUnknown = 0
    let providerValidationBlocked = 0
    const providerValidationProviderCounts: Record<string, number> = {}
    const providerValidationErrorCounts: Record<string, number> = {}
    const enrichedPool: ProspectResearchContact[] = []
    const providerValidationUpdates: ProspectResearchContact[] = []
    const count = (bucket: Record<string, number>, key: string) => {
      bucket[key] = (bucket[key] ?? 0) + 1
    }

    for (const contact of pool) {
      let candidate: ProspectResearchContact = contact
      const hasNetworkBudget = () => Date.now() < networkDeadlineAt

      if (
        hasNetworkBudget() &&
        prospectNeedsExactPublicEmailEvidence(contact) &&
        evidenceFetches < evidenceFetchLimit
      ) {
        evidenceFetches += 1
        const result = await enrichProspectWithPublicEmailEvidence(contact)
        if (result.matched) evidenceMatches += 1
        candidate = result.contact
      }

      if (hasNetworkBudget() && providerValidationChecks < providerValidationLimit) {
        const validation = await enrichProspectWithProviderValidation(candidate)
        if (validation.checked) {
          providerValidationChecks += 1
          if (validation.verdict === 'valid') providerValidationValid += 1
          if (validation.verdict === 'invalid') providerValidationInvalid += 1
          if (validation.verdict === 'risky') providerValidationRisky += 1
          if (validation.verdict === 'unknown') providerValidationUnknown += 1
          candidate = validation.contact
          const validationFields = candidate.custom_fields ?? {}
          count(
            providerValidationProviderCounts,
            asString(validationFields.email_validation_provider) || 'unknown_provider'
          )
          const validationError = asString(validationFields.email_validation_error)
          if (validationError) {
            count(providerValidationErrorCounts, validationError)
          }
          const update = decorateProviderValidationUpdate(candidate)
          if (asString(update.custom_fields?.send_status) === 'blocked') {
            providerValidationBlocked += 1
          }
          providerValidationUpdates.push(update)
          candidate = update
        }
      }

      enrichedPool.push(candidate)
    }

    if (!input.dryRun && providerValidationUpdates.length > 0) {
      await query(
        `UPDATE contacts
         SET verification_status = COALESCE(NULLIF(updates.verification_status, ''), contacts.verification_status),
             custom_fields = COALESCE(contacts.custom_fields, '{}'::jsonb) || updates.custom_fields,
             updated_at = CURRENT_TIMESTAMP
         FROM jsonb_to_recordset($2::jsonb) AS updates(id bigint, verification_status text, custom_fields jsonb)
         WHERE contacts.client_id = $1
           AND contacts.id = updates.id`,
        [
          input.clientId,
          JSON.stringify(
            providerValidationUpdates.map((contact) => ({
              id: Number(contact.id),
              verification_status: asString(contact.verification_status),
              custom_fields: contact.custom_fields ?? {},
            }))
          ),
        ]
      )
    }

    const contactById = new Map(enrichedPool.map((contact) => [Number(contact.id), contact]))
    const decisions = enrichedPool.map((contact) =>
      scoreProspectForResearchApproval(contact, { threshold })
    )
    const approvedDecisions = decisions.filter((decision) => decision.approved)
    const approvedCandidates = balanceResearchApprovalMix(
      approvedDecisions,
      contactById,
      input.approveLimit
    )
    const blocked = decisions
      .filter((decision) => !decision.approved)
      .sort((a, b) => b.score - a.score || a.email.localeCompare(b.email))
      .slice(0, 25)

    if (!input.dryRun) {
      const reviewRecords = decisions
        .filter((decision) => !decision.approved)
        .map((decision) => ({
          id: decision.id,
          send_status:
            decision.blockers.length > 0 ||
            decision.recommendation === 'hold' ||
            decision.bounceRisk === 'high'
              ? 'blocked'
              : 'review',
          approval_required: true,
          approval_blocked_reason: decision.blockers[0] ?? 'research_score_below_threshold',
          research_score: decision.score,
          hunter_confidence: decision.confidence,
          hunter_verdict: decision.verdict,
          hunter_bounce_risk: decision.bounceRisk,
          hunter_buyer_fit: decision.buyerFit,
          hunter_recommendation: decision.recommendation,
          hunter_verification_label: decision.verificationLabel,
          hunter_source_proof_label: decision.sourceProof.label,
          hunter_source_proof_url: decision.sourceProof.url,
          hunter_mailbox_quality: decision.mailboxQuality,
          hunter_source_strength: decision.sourceStrength,
          hunter_decision_summary: decision.decisionSummary,
          hunter_reasons: decision.reasons,
          hunter_blockers: decision.blockers,
          research_evidence_url: decision.evidenceUrl,
        }))

      if (reviewRecords.length > 0) {
        await query(
          `UPDATE contacts
           SET custom_fields = COALESCE(contacts.custom_fields, '{}'::jsonb)
             || jsonb_build_object(
               'send_status', updates.send_status,
               'approval_required', updates.approval_required,
               'approval_blocked_reason', updates.approval_blocked_reason,
               'research_score', updates.research_score,
               'hunter_confidence', updates.hunter_confidence,
               'hunter_verdict', updates.hunter_verdict,
               'hunter_bounce_risk', updates.hunter_bounce_risk,
               'hunter_buyer_fit', updates.hunter_buyer_fit,
               'hunter_recommendation', updates.hunter_recommendation,
               'hunter_verification_label', updates.hunter_verification_label,
               'hunter_source_proof_label', updates.hunter_source_proof_label,
               'hunter_source_proof_url', updates.hunter_source_proof_url,
               'hunter_mailbox_quality', updates.hunter_mailbox_quality,
               'hunter_source_strength', updates.hunter_source_strength,
               'hunter_decision_summary', updates.hunter_decision_summary,
               'hunter_reasons', updates.hunter_reasons,
               'hunter_blockers', updates.hunter_blockers,
               'research_evidence_url', updates.research_evidence_url,
               'hunter_checked_at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
             ),
             updated_at = CURRENT_TIMESTAMP
           FROM jsonb_to_recordset($2::jsonb) AS updates(
             id bigint,
             send_status text,
             approval_required boolean,
             approval_blocked_reason text,
             research_score int,
             hunter_confidence int,
             hunter_verdict text,
             hunter_bounce_risk text,
             hunter_buyer_fit text,
             hunter_recommendation text,
             hunter_verification_label text,
             hunter_source_proof_label text,
             hunter_source_proof_url text,
             hunter_mailbox_quality text,
             hunter_source_strength text,
             hunter_decision_summary text,
             hunter_reasons jsonb,
             hunter_blockers jsonb,
             research_evidence_url text
           )
           WHERE contacts.client_id = $1
             AND contacts.id = updates.id
             AND COALESCE(contacts.custom_fields->>'send_status', 'not_approved') <> 'queued'`,
          [input.clientId, JSON.stringify(reviewRecords)]
        )
      }
    }

    if (input.dryRun) {
      return {
        stage: 'research_approval',
        ok: true,
        status: 200,
        data: {
          dryRun: true,
          recoveryMode,
          scanned: decisions.length,
          evidenceFetches,
          evidenceMatches,
          providerValidationChecks,
          providerValidationValid,
          providerValidationInvalid,
          providerValidationRisky,
          providerValidationUnknown,
          providerValidationBlocked,
          providerValidationProviderCounts,
          providerValidationErrorCounts,
          staleInvalidBlocked,
          providerValidationLimit,
          approvalReady: approvedCandidates.length,
          approved: 0,
          candidates: approvedCandidates,
          blocked,
        },
      }
    }

    const candidateIds = approvedCandidates.map((candidate) => candidate.id)
    if (candidateIds.length === 0) {
      return {
        stage: 'research_approval',
        ok: true,
        status: 200,
        data: {
          approved: 0,
          recoveryMode,
          scanned: decisions.length,
          evidenceFetches,
          evidenceMatches,
          providerValidationChecks,
          providerValidationValid,
          providerValidationInvalid,
          providerValidationRisky,
          providerValidationUnknown,
          providerValidationBlocked,
          providerValidationProviderCounts,
          providerValidationErrorCounts,
          staleInvalidBlocked,
          providerValidationLimit,
          skipped: 'no_research_verified_prospects',
          blocked,
        },
      }
    }

    const result = await query(
      `UPDATE contacts
       SET custom_fields = COALESCE(custom_fields, '{}'::jsonb)
         || jsonb_build_object(
           'send_status', 'approved',
           'approval_required', false,
           'approved_at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'approved_by', 'daily_research_approval_gate',
         'approval_batch', 'daily_research_verified_best',
         'research_score', scores.score,
         'research_reasons', scores.reasons,
         'hunter_confidence', scores.confidence,
         'hunter_verdict', 'approved',
         'hunter_bounce_risk', scores.bounce_risk,
         'hunter_buyer_fit', scores.buyer_fit,
         'hunter_recommendation', scores.recommendation,
         'hunter_verification_label', scores.verification_label,
         'hunter_source_proof_label', scores.source_proof_label,
         'hunter_source_proof_url', scores.source_proof_url,
         'hunter_mailbox_quality', scores.mailbox_quality,
         'hunter_source_strength', scores.source_strength,
         'hunter_decision_summary', scores.decision_summary,
         'research_evidence_url', scores.evidence_url,
         'email_evidence', COALESCE(NULLIF(scores.email_evidence, ''), contacts.custom_fields->>'email_evidence')
       ),
         verification_status = COALESCE(NULLIF(scores.verification_status, ''), contacts.verification_status),
         updated_at = CURRENT_TIMESTAMP
       FROM (
         SELECT *
         FROM jsonb_to_recordset($3::jsonb) AS x(
           id bigint,
           score int,
           confidence int,
           reasons jsonb,
           evidence_url text,
           email_evidence text,
           verification_status text,
           bounce_risk text,
           buyer_fit text,
           recommendation text,
           verification_label text,
           source_proof_label text,
           source_proof_url text,
           mailbox_quality text,
           source_strength text,
           decision_summary text
         )
       ) AS scores
       WHERE contacts.client_id = $1
         AND contacts.id = ANY($2::bigint[])
         AND contacts.id = scores.id
         AND contacts.status = 'active'
         AND contacts.bounced_at IS NULL
         AND contacts.unsubscribed_at IS NULL
       RETURNING contacts.id, contacts.email, contacts.company, contacts.custom_fields`,
      [
        input.clientId,
        candidateIds,
        JSON.stringify(
          approvedCandidates.map((candidate) => ({
            id: candidate.id,
            score: candidate.score,
            confidence: candidate.confidence,
            reasons: candidate.reasons,
            evidence_url: candidate.evidenceUrl,
            email_evidence: asString(contactById.get(candidate.id)?.custom_fields?.email_evidence),
            verification_status: asString(contactById.get(candidate.id)?.verification_status),
            bounce_risk: candidate.bounceRisk,
            buyer_fit: candidate.buyerFit,
            recommendation: candidate.recommendation,
            verification_label: candidate.verificationLabel,
            source_proof_label: candidate.sourceProof.label,
            source_proof_url: candidate.sourceProof.url,
            mailbox_quality: candidate.mailboxQuality,
            source_strength: candidate.sourceStrength,
            decision_summary: candidate.decisionSummary,
          }))
        ),
      ]
    )
    const approved = result.rowCount ?? result.rows.length

    void notifyTelegramEvent({
      type: 'contacts_approved',
      approved,
      mode: 'daily_research_verified_best',
    })

    return {
      stage: 'research_approval',
      ok: true,
      status: 200,
      data: {
        approved,
        recoveryMode,
        scanned: decisions.length,
        evidenceFetches,
        evidenceMatches,
        providerValidationChecks,
        providerValidationValid,
        providerValidationInvalid,
        providerValidationRisky,
        providerValidationUnknown,
        providerValidationBlocked,
        providerValidationProviderCounts,
        providerValidationErrorCounts,
        staleInvalidBlocked,
        providerValidationLimit,
        contacts: result.rows,
        blocked,
      },
    }
  } catch (error) {
    return {
      stage: 'research_approval',
      ok: false,
      status: 0,
      error: safeError(error),
    }
  }
}

function approvedRowToResearchContact(row: ApprovedContactRow): ProspectResearchContact {
  return {
    id: row.id,
    email: row.email,
    email_domain: row.email_domain,
    company: row.company,
    company_domain: row.company_domain,
    title: row.title,
    source: row.source,
    custom_fields: row.custom_fields,
    verification_status: row.verification_status,
    status: row.status,
    bounced_at: row.bounced_at,
    unsubscribed_at: row.unsubscribed_at,
  }
}

async function quarantineApprovedContacts(
  clientId: number,
  blockedRows: Array<{ row: ApprovedContactRow; blockers: string[] }>
): Promise<number> {
  if (blockedRows.length === 0) return 0

  const result = await query(
    `UPDATE contacts
     SET custom_fields = COALESCE(contacts.custom_fields, '{}'::jsonb)
       || jsonb_build_object(
         'send_status', 'blocked',
         'approval_required', true,
         'approval_blocked_reason', updates.approval_blocked_reason,
         'blocked_by', 'approved_queue_recheck',
         'blocked_at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'queue_gate_checked_at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'hunter_verdict', 'blocked',
         'hunter_bounce_risk', 'high',
         'hunter_recommendation', 'hold',
         'hunter_verification_label', 'risky',
         'hunter_blockers', updates.hunter_blockers
       ),
       updated_at = CURRENT_TIMESTAMP
     FROM jsonb_to_recordset($2::jsonb) AS updates(
       id bigint,
       approval_blocked_reason text,
       hunter_blockers jsonb
     )
     WHERE contacts.client_id = $1
       AND contacts.id = updates.id
       AND COALESCE(contacts.custom_fields->>'send_status', 'not_approved') = 'approved'`,
    [
      clientId,
      JSON.stringify(
        blockedRows.map(({ row, blockers }) => ({
          id: Number(row.id),
          approval_blocked_reason: blockers[0] ?? 'approved_queue_recheck_failed',
          hunter_blockers: blockers,
        }))
      ),
    ]
  )

  return result.rowCount ?? 0
}

async function loadApprovedContacts(
  clientId: number,
  limit: number
): Promise<{
  leads: ApprovedLead[]
  quarantinedApprovedContacts: number
  eligibleAgencyContacts: number
  eligibleDirectContacts: number
  agencyShortfall: number
  directShortfall: number
}> {
  const recentMixResult = await query<{ agency_sent: string; direct_sent: string }>(
    `SELECT
       COUNT(*) FILTER (
         WHERE e.event_type = 'sent'
           AND e.created_at >= NOW() - INTERVAL '24 hours'
           AND COALESCE(e.metadata->>'offer_type','') = 'agency'
       )::text AS agency_sent,
       COUNT(*) FILTER (
         WHERE e.event_type = 'sent'
           AND e.created_at >= NOW() - INTERVAL '24 hours'
           AND COALESCE(e.metadata->>'offer_type','direct') <> 'agency'
       )::text AS direct_sent
     FROM events e
     WHERE e.client_id = $1`,
    [clientId]
  )
  const agencySent24h = Number(recentMixResult.rows[0]?.agency_sent ?? 0)
  const directSent24h = Number(recentMixResult.rows[0]?.direct_sent ?? 0)
  const preferredOfferType =
    agencySent24h < directSent24h
      ? 'agency'
      : directSent24h < agencySent24h
        ? 'direct'
        : undefined
  const preferredSlots = Math.abs(agencySent24h - directSent24h)
  const scanLimit = Math.min(Math.max(limit * 50, 500), 10_000)
  const result = await query<ApprovedContactRow>(
    `SELECT
       c.id::text,
       c.email,
       c.email_domain,
       COALESCE(NULLIF(c.name, ''), split_part(c.email, '@', 1)) AS first_name,
       COALESCE(NULLIF(c.company, ''), c.company_domain, c.email_domain, 'your team') AS company,
       c.company_domain,
       c.title,
       c.source,
       COALESCE(c.custom_fields->>'reason_to_contact', 'reviewed approved business prospect') AS reason_to_contact,
       c.custom_fields,
       c.verification_status,
       c.status,
       c.bounced_at,
       c.unsubscribed_at
     FROM contacts c
     WHERE c.client_id = $1
       AND c.status = 'active'
       AND c.bounced_at IS NULL
       AND c.unsubscribed_at IS NULL
       AND COALESCE(c.custom_fields->>'send_status', 'not_approved') = 'approved'
       AND NOT EXISTS (
         SELECT 1
         FROM suppression_list s
         WHERE s.client_id = c.client_id
           AND LOWER(s.email) = LOWER(c.email)
       )
       AND NOT EXISTS (
         SELECT 1
         FROM events e
         WHERE e.client_id = c.client_id
           AND e.contact_id = c.id
           AND e.event_type IN ('sent', 'failed', 'bounce', 'bounced')
       )
     ORDER BY
       CASE
         WHEN COALESCE(c.custom_fields->>'fit_score', '') ~ '^[0-9]+$'
         THEN (c.custom_fields->>'fit_score')::int
         ELSE 0
       END DESC,
       c.updated_at ASC,
       c.created_at ASC
     LIMIT $2`,
    [clientId, scanLimit]
  )

  const reviewedRows = result.rows.map((row) => ({
    row,
    blockers: approvedContactQueueBlockers(approvedRowToResearchContact(row)),
  }))
  const blockedRows = reviewedRows.filter(({ blockers }) => blockers.length > 0)
  const quarantinedApprovedContacts = await quarantineApprovedContacts(clientId, blockedRows)
  const eligibleRows = reviewedRows
    .filter(({ blockers }) => blockers.length === 0)
    .map(({ row }) => row)

  const preparedLeads = eligibleRows.map((row) => {
      const leadBase = {
        company: row.company,
        companyDomain: row.company_domain,
        title: row.title,
        source: row.source,
        reasonToContact: row.reason_to_contact,
        customFields: row.custom_fields,
      }
      const offerType = inferSovereignOfferType(leadBase)

      return {
        contact_id: Number(row.id),
        email: row.email,
        first_name: row.first_name || row.email.split('@')[0] || 'there',
        company: row.company || row.email.split('@')[1] || 'your team',
        title: row.title || undefined,
        company_domain: row.company_domain || undefined,
        consent_source: 'operator_approved_business_outreach',
        reason_to_contact: row.reason_to_contact || 'reviewed approved business prospect',
        offer_type: offerType,
        deal_value_usd: sovereignDealValueUsd({ ...leadBase, offerType }),
        customFields: row.custom_fields,
      }
    })
  const eligibleAgencyContacts = preparedLeads.filter((lead) => lead.offer_type === 'agency').length
  const eligibleDirectContacts = preparedLeads.length - eligibleAgencyContacts
  const targetPerSide = Math.floor(Math.max(0, Math.trunc(limit)) / 2)
  const leads = balanceSovereignOfferMix(preparedLeads, limit, {
    allowRemainderFill: true,
    preferredOfferType,
    preferredSlots,
  })

  return {
    leads,
    quarantinedApprovedContacts,
    eligibleAgencyContacts,
    eligibleDirectContacts,
    agencyShortfall: Math.max(0, targetPerSide - eligibleAgencyContacts),
    directShortfall: Math.max(0, targetPerSide - eligibleDirectContacts),
  }
}

async function repairTerminalQueuedContacts(clientId: number): Promise<number> {
  const result = await query<{ repaired: string }>(
    `WITH latest_terminal_events AS (
       SELECT DISTINCT ON (e.contact_id)
         e.contact_id,
         e.event_type,
         e.created_at
       FROM events e
       JOIN contacts c
         ON c.client_id = e.client_id
        AND c.id = e.contact_id
       WHERE e.client_id = $1
         AND e.contact_id IS NOT NULL
         AND COALESCE(c.custom_fields->>'send_status', '') = 'queued'
         AND e.event_type IN ('sent', 'failed', 'bounce', 'bounced')
       ORDER BY e.contact_id, e.created_at DESC
     ),
     repaired AS (
       UPDATE contacts c
       SET custom_fields = COALESCE(c.custom_fields, '{}'::jsonb)
         || jsonb_build_object(
           'send_status',
           CASE
             WHEN l.event_type = 'sent' THEN 'sent'
             WHEN l.event_type IN ('bounce', 'bounced') THEN 'bounced'
             ELSE 'failed'
           END,
           'terminal_event_type', l.event_type,
           'terminal_event_at', to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         ),
         updated_at = CURRENT_TIMESTAMP
       FROM latest_terminal_events l
       WHERE c.client_id = $1
         AND c.id = l.contact_id
       RETURNING c.id
     )
     SELECT COUNT(*)::text AS repaired
     FROM repaired`,
    [clientId]
  )
  return Number(result.rows[0]?.repaired ?? 0)
}

async function repairOrphanedQueuedContacts(clientId: number, queue: Queue): Promise<number> {
  const queuedContacts = await query<{ id: string }>(
    `SELECT c.id::text
     FROM contacts c
     WHERE c.client_id = $1
       AND c.status = 'active'
       AND c.bounced_at IS NULL
       AND c.unsubscribed_at IS NULL
       AND COALESCE(c.custom_fields->>'send_status', '') = 'queued'
       AND NOT EXISTS (
         SELECT 1
         FROM events e
         WHERE e.client_id = c.client_id
           AND e.contact_id = c.id
           AND e.event_type IN ('sent', 'failed', 'bounce', 'bounced')
       )
     ORDER BY c.updated_at ASC
     LIMIT 1000`,
    [clientId]
  )

  if (queuedContacts.rows.length === 0) return 0

  const liveJobs = await queue.getJobs(['waiting', 'active', 'delayed'], 0, 5000, true)
  const liveContactIds = new Set(
    liveJobs
      .map((job) => Number(job.data?.contactId))
      .filter((id) => Number.isSafeInteger(id))
  )

  const orphanedIds = queuedContacts.rows
    .map((row) => Number(row.id))
    .filter((id) => Number.isSafeInteger(id) && !liveContactIds.has(id))

  if (orphanedIds.length === 0) return 0

  const result = await query<{ repaired: string }>(
    `WITH repaired AS (
       UPDATE contacts c
       SET custom_fields = COALESCE(c.custom_fields, '{}'::jsonb)
         || jsonb_build_object(
           'send_status', 'approved',
           'queue_orphan_repaired_at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         ),
         updated_at = CURRENT_TIMESTAMP
       WHERE c.client_id = $1
         AND c.id = ANY($2::bigint[])
       RETURNING c.id
     )
     SELECT COUNT(*)::text AS repaired
     FROM repaired`,
    [clientId, orphanedIds]
  )

  return Number(result.rows[0]?.repaired ?? 0)
}

async function runQueue(input: {
  clientId: number
  sendLimit: number
  phase?: 'before_research' | 'after_research'
  notifySkipped?: boolean
}): Promise<StageResult> {
  let queue: Queue | null = null
  try {
    const queueName = process.env.SEND_QUEUE ?? 'xv-send-queue'
    queue = new Queue(queueName, { connection: { url: appEnv.redisUrl() } })
    const repairedQueuedContacts = await repairTerminalQueuedContacts(input.clientId)
    const repairedOrphanedQueuedContacts = await repairOrphanedQueuedContacts(input.clientId, queue)
    const {
      leads,
      quarantinedApprovedContacts,
      eligibleAgencyContacts,
      eligibleDirectContacts,
      agencyShortfall,
      directShortfall,
    } = await loadApprovedContacts(input.clientId, input.sendLimit)

    if (leads.length === 0) {
      if (input.notifySkipped !== false) {
        void notifyTelegramEvent({
          type: 'queue_skipped',
          reason: 'no_verified_approved_leads',
          source: 'daily_approved_contacts_only',
        })
      }

      return {
        stage: 'queue_outbound',
        ok: true,
        status: 200,
        data: {
          queued: 0,
          source: 'daily_approved_contacts_only',
          skipped: 'no_verified_approved_leads',
          repairedQueuedContacts,
          repairedOrphanedQueuedContacts,
          quarantinedApprovedContacts,
          eligibleAgencyContacts,
          eligibleDirectContacts,
          agencyShortfall,
          directShortfall,
          mixPolicy: 'target_50_50_fill_best_available',
          phase: input.phase || 'after_research',
        },
      }
    }

    const physicalAddress = process.env.SENDER_PHYSICAL_ADDRESS || 'Xavira Tech Labs, India'
    const allowCopyOverride = envBool(process.env.OUTBOUND_CRON_ALLOW_COPY_OVERRIDE, false)
    const today = new Date().toISOString().slice(0, 10)
    const ragContexts = await loadCopyRagContexts(
      input.clientId,
      leads.map((lead) => lead.contact_id).filter((id) => Number.isSafeInteger(id)) as number[]
    )

    const jobs = await Promise.all(leads.map(async (lead) => {
      const copy = await buildSovereignCopyForLead(lead, {
        physicalAddress,
        subjectOverride:
          allowCopyOverride && process.env.OUTBOUND_CRON_SUBJECT
            ? process.env.OUTBOUND_CRON_SUBJECT
            : undefined,
        bodyOverride:
          allowCopyOverride && process.env.OUTBOUND_CRON_BODY
            ? process.env.OUTBOUND_CRON_BODY
            : undefined,
        ragContext: lead.contact_id ? ragContexts.get(lead.contact_id) : undefined,
      })
      const idempotencyKey = crypto
        .createHash('sha256')
        .update(`daily:${today}:${input.clientId}:${lead.email}:${copy.subject}`)
        .digest('hex')

      return {
        name: 'cron_outbound_sales',
        data: {
          clientId: input.clientId,
          contactId: lead.contact_id,
          toEmail: lead.email,
          subject: copy.subject,
          text: copy.text,
          html: copy.html,
          offerType: lead.offer_type,
          dealValueUsd: lead.deal_value_usd,
          copySource: copy.source,
          copyError: copy.error,
          idempotencyKey,
        },
        opts: {
          jobId: idempotencyKey,
          attempts: 1,
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      }
    }))

    const addStartedAt = Date.now()
    const added = await queue.addBulk(jobs)
    const jobStates = await Promise.all(
      added.map(async (job, index) => ({
        index,
        job,
        state: await job.getState(),
        isFresh: Number(job.timestamp ?? 0) >= addStartedAt - 1_000,
      }))
    )
    const liveAdded = jobStates.filter(
      (item) =>
        item.isFresh &&
        ['waiting', 'waiting-children', 'delayed', 'prioritized', 'active'].includes(item.state)
    )
    const terminalDuplicates = jobStates.filter(
      (item) => !item.isFresh && ['completed', 'failed'].includes(item.state)
    )
    const queuedLeads = liveAdded.map((item) => leads[item.index]).filter(Boolean)
    const duplicateOrTerminalJobs = added.length - liveAdded.length
    const terminalDuplicateContacts = terminalDuplicates
      .map((item) => {
        const lead = leads[item.index]
        if (!lead?.contact_id) return null
        return {
          id: lead.contact_id,
          state: item.state,
          job_id: item.job.id === undefined ? null : String(item.job.id),
        }
      })
      .flatMap((item) => (item ? [item] : []))
    const estimatedPipelineValueUsd = queuedLeads.reduce(
      (sum, lead) => sum + lead.deal_value_usd,
      0
    )
    const agencyQueued = queuedLeads.filter((lead) => lead.offer_type === 'agency').length
    const directQueued = queuedLeads.length - agencyQueued
    const contactIds = queuedLeads
      .map((lead) => lead.contact_id)
      .filter((id) => Number.isSafeInteger(id))
      .map((id) => id as number)

    if (contactIds.length > 0 && added.length > 0) {
      await query(
        `UPDATE contacts
         SET custom_fields = COALESCE(custom_fields, '{}'::jsonb)
           || jsonb_build_object(
             'send_status', 'queued',
             'queued_at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           ),
           updated_at = CURRENT_TIMESTAMP
         WHERE client_id = $1
           AND id = ANY($2::bigint[])`,
        [input.clientId, contactIds]
      )
    }

    if (terminalDuplicateContacts.length > 0) {
      await query(
        `UPDATE contacts c
         SET custom_fields = COALESCE(c.custom_fields, '{}'::jsonb)
           || jsonb_build_object(
             'send_status',
             CASE WHEN updates.state = 'completed' THEN 'sent' ELSE 'failed' END,
             'terminal_queue_state', updates.state,
             'terminal_queue_job_id', updates.job_id,
             'terminal_queue_repaired_at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           ),
           updated_at = CURRENT_TIMESTAMP
         FROM jsonb_to_recordset($2::jsonb) AS updates(
           id bigint,
           state text,
           job_id text
         )
         WHERE c.client_id = $1
           AND c.id = updates.id`,
        [input.clientId, JSON.stringify(terminalDuplicateContacts)]
      )
    }

    void notifyTelegramEvent({
      type: 'queue_batch',
      queued: liveAdded.length,
      source: 'daily_approved_contacts',
      queue: queueName,
      limit: input.sendLimit,
      estimatedPipelineValueUsd,
      agencyQueued,
      directQueued,
    })

    return {
      stage: 'queue_outbound',
      ok: true,
      status: 200,
      data: {
        queue: queueName,
        queued: liveAdded.length,
        limit: input.sendLimit,
        estimatedPipelineValueUsd,
        agencyQueued,
        directQueued,
        duplicateOrTerminalJobs,
        terminalDuplicateContactsRepaired: terminalDuplicateContacts.length,
        firstJobId: liveAdded[0]?.job.id ?? null,
        lastJobId: liveAdded.at(-1)?.job.id ?? null,
        repairedQueuedContacts,
        repairedOrphanedQueuedContacts,
        quarantinedApprovedContacts,
        eligibleAgencyContacts,
        eligibleDirectContacts,
        agencyShortfall,
        directShortfall,
        mixPolicy: 'target_50_50_fill_best_available',
        phase: input.phase || 'after_research',
      },
    }
  } catch (error) {
    return {
      stage: 'queue_outbound',
      ok: false,
      status: 0,
      error: safeError(error),
    }
  } finally {
    await queue?.close()
  }
}

async function runFollowupsStage(input: {
  clientId: number
  dryRun: boolean
}): Promise<StageResult> {
  try {
    const tableCheck = await query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'sequence_executions'
       ) AS exists`
    )
    const hasSequenceExecutions = Boolean(tableCheck.rows[0]?.exists)
    if (!hasSequenceExecutions) {
      return {
        stage: 'run_followups',
        ok: true,
        status: 204,
        data: {
          processed: 0,
          emailsSent: 0,
          sequencesCompleted: 0,
          errorsCount: 0,
          skipped: 'sequence_executions table is not installed yet',
        },
      }
    }

    if (input.dryRun) {
      const dueCountRes = await query<{ cnt: string }>(
        `SELECT COUNT(*) as cnt
         FROM sequence_executions
         WHERE status = 'active'
           AND next_email_scheduled_at <= NOW()`
      )
      const dueCount = Number(dueCountRes.rows[0]?.cnt ?? 0)
      return {
        stage: 'run_followups',
        ok: true,
        status: 200,
        data: {
          processed: 0,
          emailsSent: 0,
          sequencesCompleted: 0,
          errorsCount: 0,
          skipped: `dry_run: would process ${dueCount} pending followups`,
        },
      }
    }

    const { processAllSequences } = await import('@/lib/sequence-engine')
    const result = await processAllSequences()
    return {
      stage: 'run_followups',
      ok: result.errors.length === 0,
      status: 200,
      data: {
        processed: result.processed,
        emailsSent: result.emailsSent,
        sequencesCompleted: result.sequencesCompleted,
        errorsCount: result.errors.length,
        errors: result.errors,
      },
    }
  } catch (error) {
    return {
      stage: 'run_followups',
      ok: false,
      status: 0,
      error: safeError(error),
    }
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}

export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const kick =
    envBool(
      request.nextUrl.searchParams.get('kick') ||
        request.nextUrl.searchParams.get('background') ||
        undefined,
      false
    )
  if (kick) {
    try {
      const clientId = Number(request.nextUrl.searchParams.get('client_id') || process.env.DEFAULT_CLIENT_ID || 1)
      const runUrl = new URL(request.nextUrl.pathname + request.nextUrl.search, requestPublicOrigin(request))
      runUrl.searchParams.delete('kick')
      runUrl.searchParams.delete('background')
      runUrl.searchParams.delete('direct')
      runUrl.searchParams.delete('directRun')
      runUrl.searchParams.delete('runInline')
      runUrl.searchParams.delete('inline')
      runUrl.searchParams.delete('sync')
      runUrl.searchParams.delete('secret')
      runUrl.searchParams.set('compact', '1')
      runUrl.searchParams.set('cronCompact', '1')

      if (shouldRunOutboundCycleDirect(request)) {
        const result = await runOutboundCycleDirect({
          publicRunUrl: runUrl.toString(),
          secret: appEnv.cronSecret(),
        })

        return new Response(
          [
            `ok=${result.ok ? 1 : 0}`,
            'cycleQueued=0',
            'directRun=1',
            `client=${clientId}`,
            'worker=direct-fallback',
            `cycleStatus=${result.status}`,
            `elapsedMs=${result.elapsedMs}`,
            `publicFallback=${result.usedPublicFallback ? 1 : 0}`,
            `body=${compactCycleBody(result.body)}`,
            `ts=${new Date().toISOString()}`,
          ].join(' '),
          {
            status: result.ok ? 200 : 502,
            headers: {
              'content-type': 'text/plain; charset=utf-8',
              'cache-control': 'no-store',
            },
          }
        )
      }

      const queued = await enqueueOutboundCycleJob({
        clientId,
        runUrl: runUrl.toString(),
      })

      return new Response(
        [
          'ok=1',
          'cycleQueued=1',
          `client=${clientId}`,
          `queue=${queued.queue}`,
          `job=${queued.jobId ?? queued.dedupeKey}`,
          `replacedCompleted=${queued.replacedCompleted ? 1 : 0}`,
          `replacedFailed=${queued.replacedFailed ? 1 : 0}`,
          'worker=embedded',
          `ts=${new Date().toISOString()}`,
        ].join(' '),
        {
          status: 202,
          headers: {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store',
          },
        }
      )
    } catch (error) {
      console.error('[api/cron/daily-outbound] cycle enqueue failed', error)
      return new Response(`ok=0 cycleQueued=0 error=${safeError(error).slice(0, 240)}`, {
        status: 500,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        },
      })
    }
  }

  try {
    const params = request.nextUrl.searchParams
    const clientId = Number(params.get('client_id') || process.env.DEFAULT_CLIENT_ID || 1)
    const targetDailyVolume = resolveTargetDailyVolume(params)
    const maintenance = await maybeRunDailyMaintenance(clientId)
    const stages: StageResult[] = []
    stages.push(await runSenderReconcileStage(clientId))
    const approvalWindow = await resolveSystemApprovalWindow(clientId)
    const plan = buildDailyOutboundPlan({
      approvalWindow,
      env: process.env,
      query: {
        clientId: String(clientId),
        dryRun: params.get('dryRun') || params.get('preview'),
        sheetUrl: params.get('sheetUrl'),
        sheetLimit: params.get('sheetLimit'),
        mapsDatasetId: params.get('mapsDatasetId') || params.get('datasetId'),
        mapsLimit: params.get('mapsLimit'),
        mapsImport: params.get('mapsImport'),
        publicSearch: params.get('publicSearch') || params.get('serpApi'),
        publicSearchLimit: params.get('publicSearchLimit') || params.get('serpApiLimit'),
        serpApi: params.get('serpApi'),
        serpApiLimit: params.get('serpApiLimit'),
        leadScout: params.get('leadScout'),
        leadScoutLimit: params.get('leadScoutLimit'),
        approveLimit: params.get('approveLimit'),
        researchApproveLimit: params.get('researchApproveLimit'),
        researchUnlimited: params.get('researchUnlimited') || params.get('research_unlimited'),
        researchLimit: params.get('researchLimit'),
        readyInventoryTarget: params.get('readyInventoryTarget') || params.get('ready_inventory_target'),
        mapsResearchLimit: params.get('mapsResearchLimit'),
        publicSearchResearchLimit: params.get('publicSearchResearchLimit'),
        leadScoutResearchLimit: params.get('leadScoutResearchLimit'),
        sendLimit: params.get('sendLimit'),
        mode: params.get('mode'),
        recoveryMode: params.get('recoveryMode'),
      },
    })
    const volumeAdjustment = applyDailyVolumeBand({
      plan,
      approvalWindow,
      sentToday: await getSentToday(clientId),
      env: process.env,
      query: {
        minDailyVolume: params.get('minDailyVolume') || params.get('dailyFloor'),
        maxDailyVolume: params.get('maxDailyVolume') || params.get('dailyCeiling'),
      },
    })
    plan.sendLimit = volumeAdjustment.sendLimit
    plan.runQueue = volumeAdjustment.runQueue
    plan.guardrails.push(...volumeAdjustment.guardrails)
    const verbose = envBool(params.get('verbose') || process.env.DAILY_OUTBOUND_VERBOSE_RESPONSE, false)
    const compactResponse = envBool(
      params.get('compact') ||
        params.get('cronCompact') ||
        process.env.DAILY_OUTBOUND_COMPACT_RESPONSE,
      false
    )
    const queueOnly = envBool(
      params.get('queueOnly') ||
        params.get('queue_only') ||
        process.env.DAILY_OUTBOUND_QUEUE_ONLY,
      false
    )
    const evidenceDeadlineMs = boundedEvidenceParam(
      params.get('leadScoutEvidenceDeadlineMs') || params.get('evidenceDeadlineMs'),
      25_000,
      30_000
    )
    const evidenceMaxPages = boundedEvidenceParam(
      params.get('leadScoutEvidenceMaxPages') || params.get('evidenceMaxPages'),
      6,
      6
    )
    const evidenceRequestTimeoutMs = boundedEvidenceParam(
      params.get('leadScoutEvidenceRequestTimeoutMs') || params.get('evidenceRequestTimeoutMs'),
      2_500,
      3_000
    )
    const skipEvidenceVerification = skipLeadEvidenceVerification(
      params.get('skipLeadEvidence') || params.get('skipEvidence')
    )
    const runHunterSearch = envBool(
      params.get('hunterSearch') || process.env.DAILY_OUTBOUND_RUN_HUNTER,
      false
    )
    const recoveryMode = plan.recoveryMode
    const mapsActorId =
      params.get('mapsActorId') ||
      params.get('actorId') ||
      process.env.APIFY_GOOGLE_MAPS_ACTOR_ID ||
      process.env.GOOGLE_MAPS_APIFY_ACTOR_ID ||
      ''
    let queuedBeforeResearch = false
    let sendSlotsAlreadyQueued = false

    if (!plan.enabled) {
      return NextResponse.json({
        ok: true,
        enabled: false,
        daily: true,
        plan,
        stages,
      })
    }

    if (plan.runQueue) {
      const preResearchQueueStage = await runQueue({
        clientId: plan.clientId,
        sendLimit: plan.sendLimit,
        phase: 'before_research',
        notifySkipped: false,
      })
      stages.push(preResearchQueueStage)

      const preResearchQueued = getNumericField(preResearchQueueStage.data, 'queued')
      if (preResearchQueued > 0) {
        sendSlotsAlreadyQueued = true
      }

      if (preResearchQueued > 0 || queueOnly) {
        const continueResearchAfterQueue = plan.researchUnlimited && !queueOnly
        if (continueResearchAfterQueue) {
          plan.guardrails.push(
            'This cycle already queued send slots, but autonomous research will continue to build future ready inventory'
          )
        } else {
          queuedBeforeResearch = true
          const skipped = queueOnly ? 'queue_only_fast_path' : 'deferred_after_immediate_queue'
          stages.push({
            stage: 'public_search',
            ok: true,
            status: 204,
            skipped,
          })
          stages.push({
            stage: 'lead_scout',
            ok: true,
            status: 204,
            skipped,
          })
          stages.push({
            stage: 'maps_import',
            ok: true,
            status: 204,
            skipped,
          })
          stages.push({
            stage: 'sheet_import',
            ok: true,
            status: 204,
            skipped,
          })
          stages.push({
            stage: 'hunter_domain_search',
            ok: true,
            status: 204,
            skipped,
          })
          stages.push({
            stage: 'research_approval',
            ok: true,
            status: 204,
            skipped,
          })
        }
      }
    }

    if (!queuedBeforeResearch && plan.runResearchApproval) {
      const fastApprovalStage = await runResearchApproval({
        clientId: plan.clientId,
        dryRun: plan.dryRun,
        approveLimit: plan.approveLimit,
        recoveryMode,
        growthMode: plan.mode === 'growth',
        evidenceFetchLimit: 0,
        providerValidationLimit: 0,
      })
      stages.push(fastApprovalStage)

      if (plan.runQueue && !sendSlotsAlreadyQueued) {
        const fastQueueStage = await runQueue({
          clientId: plan.clientId,
          sendLimit: plan.sendLimit,
          phase: 'before_research',
        })
        stages.push(fastQueueStage)

        if (getNumericField(fastQueueStage.data, 'queued') > 0) {
          sendSlotsAlreadyQueued = true
          if (plan.researchUnlimited) {
            plan.guardrails.push(
              'Fast approval queued send slots, but autonomous research will continue for future inventory'
            )
          } else {
            queuedBeforeResearch = true
            const skipped = 'deferred_after_fast_approval_queue'
            stages.push({
              stage: 'public_search',
              ok: true,
              status: 204,
              skipped,
            })
            stages.push({
              stage: 'lead_scout',
              ok: true,
              status: 204,
              skipped,
            })
            stages.push({
              stage: 'maps_import',
              ok: true,
              status: 204,
              skipped,
            })
            stages.push({
              stage: 'sheet_import',
              ok: true,
              status: 204,
              skipped,
            })
            stages.push({
              stage: 'hunter_domain_search',
              ok: true,
              status: 204,
              skipped,
            })
          }
        }
      } else if (plan.runQueue && sendSlotsAlreadyQueued) {
        stages.push({
          stage: 'queue_outbound',
          ok: true,
          status: 204,
          skipped: 'send_slots_already_queued_research_continues',
        })
      }
    }

    if (!queuedBeforeResearch && plan.runPublicSearch) {
      stages.push(
        await runBalancedPublicSearchStage({
          clientId: plan.clientId,
          dryRun: plan.dryRun,
          limit: plan.publicSearchLimit,
          industry: params.get('industry') || params.get('publicSearchIndustry') || params.get('leadScoutIndustry'),
          persona: params.get('persona') || params.get('publicSearchPersona') || params.get('leadScoutPersona'),
          region: params.get('region') || params.get('publicSearchRegion') || params.get('leadScoutRegion'),
          queries: resolvePublicSearchQueries(params.get('publicSearchQueries') || params.get('serpApiQueries')),
          evidenceDeadlineMs,
          evidenceMaxPagesPerLead: evidenceMaxPages,
          evidenceRequestTimeoutMs,
          skipEvidenceVerification,
        })
      )
    } else if (!queuedBeforeResearch) {
      stages.push({
        stage: 'public_search',
        ok: true,
        status: 204,
        skipped: 'public_search_disabled_or_no_provider_key',
      })
    }

    if (!queuedBeforeResearch && plan.runLeadScout) {
      stages.push(
        await runBalancedLeadScoutStage({
          clientId: plan.clientId,
          dryRun: plan.dryRun,
          limit: plan.leadScoutLimit,
          industry: params.get('industry') || params.get('leadScoutIndustry'),
          persona: params.get('persona') || params.get('leadScoutPersona'),
          region: params.get('region') || params.get('leadScoutRegion'),
          evidenceDeadlineMs,
          evidenceMaxPagesPerLead: evidenceMaxPages,
          evidenceRequestTimeoutMs,
          skipEvidenceVerification,
        })
      )
    } else if (!queuedBeforeResearch) {
      stages.push({
        stage: 'lead_scout',
        ok: true,
        status: 204,
        skipped: 'lead_scout_disabled',
      })
    }

    if (!queuedBeforeResearch && plan.runResearchApproval) {
      stages.push(
        await runResearchApproval({
          clientId: plan.clientId,
          dryRun: plan.dryRun,
          approveLimit: plan.approveLimit,
          recoveryMode,
          growthMode: plan.mode === 'growth',
          evidenceFetchLimit: 0,
          providerValidationLimit: 0,
        })
      )
    }

    if (!queuedBeforeResearch && plan.runQueue && !sendSlotsAlreadyQueued) {
      const fastQueueStage = await runQueue({
        clientId: plan.clientId,
        sendLimit: plan.sendLimit,
        phase: 'after_research',
      })
      stages.push(fastQueueStage)
      if (getNumericField(fastQueueStage.data, 'queued') > 0) {
        sendSlotsAlreadyQueued = true
        if (plan.researchUnlimited) {
          plan.guardrails.push(
            'Research-stage queue filled send slots, but later discovery sources will still run'
          )
        } else {
          queuedBeforeResearch = true
        }
      }
    } else if (!queuedBeforeResearch && plan.runQueue && sendSlotsAlreadyQueued) {
      stages.push({
        stage: 'queue_outbound',
        ok: true,
        status: 204,
        skipped: 'send_slots_already_queued_research_continues',
      })
    }

    if (!queuedBeforeResearch && plan.runMapsImport) {
      stages.push(
        await runMapsImport({
          clientId: plan.clientId,
          dryRun: plan.dryRun,
          datasetId: plan.mapsDatasetId,
          mapsLimit: plan.mapsLimit,
          taskId: params.get('mapsTaskId') || params.get('taskId') || undefined,
          actorId: mapsActorId || undefined,
          actorInput: mapsActorId
            ? buildApifyGoogleMapsActorInput({
                inputJson: params.get('actorInputJson') || process.env.APIFY_GOOGLE_MAPS_ACTOR_INPUT_JSON,
                searches:
                  params.get('mapsSearches') ||
                  params.get('searches') ||
                  process.env.APIFY_GOOGLE_MAPS_SEARCHES,
                location:
                  params.get('mapsLocation') ||
                  params.get('location') ||
                  process.env.APIFY_GOOGLE_MAPS_LOCATION ||
                  params.get('mapsRegion') ||
                  params.get('region') ||
                  process.env.GOOGLE_MAPS_REGION,
                limit: plan.mapsLimit,
                placesPerSearch:
                  params.get('mapsPlacesPerSearch') ||
                  params.get('placesPerSearch') ||
                  process.env.APIFY_GOOGLE_MAPS_PLACES_PER_SEARCH,
              })
            : undefined,
          industry: params.get('mapsIndustry') || params.get('industry'),
          region: params.get('mapsRegion') || params.get('region'),
        })
      )
    } else if (!queuedBeforeResearch) {
      stages.push({
        stage: 'maps_import',
        ok: true,
        status: 204,
        skipped: 'maps_import_disabled_or_no_dataset',
      })
    }

    if (!queuedBeforeResearch && plan.runSheetImport) {
      stages.push(
        await runSheetImport({
          clientId: plan.clientId,
          dryRun: plan.dryRun,
          sheetUrl: plan.sheetUrl,
          sheetLimit: plan.sheetLimit,
        })
      )
    } else if (!queuedBeforeResearch) {
      stages.push({
        stage: 'sheet_import',
        ok: true,
        status: 204,
        skipped: 'no_sheet_configured_existing_contacts_only',
      })
    }

    if (!queuedBeforeResearch && runHunterSearch) {
      stages.push(
        await runHunterDomainSearch({
          clientId: plan.clientId,
          dryRun: plan.dryRun,
          domainLimit: clampLimit(
            params.get('hunterDomainLimit') || process.env.HUNTER_DOMAIN_SEARCH_DAILY_LIMIT,
            10,
            50
          ),
          emailsPerDomain: clampLimit(
            params.get('hunterEmailsPerDomain') || process.env.HUNTER_EMAILS_PER_DOMAIN,
            5,
            25
          ),
          minConfidence: clampLimit(
            params.get('hunterMinConfidence') || process.env.HUNTER_MIN_CONFIDENCE,
            80,
            100
          ),
        })
      )
    } else if (!queuedBeforeResearch) {
      stages.push({
        stage: 'hunter_domain_search',
        ok: true,
        status: 204,
        skipped: 'hunter_domain_search_disabled',
      })
    }

    if (!queuedBeforeResearch && plan.runResearchApproval) {
      stages.push(
        await runResearchApproval({
          clientId: plan.clientId,
          dryRun: plan.dryRun,
          approveLimit: plan.approveLimit,
          recoveryMode,
          growthMode: plan.mode === 'growth',
          evidenceFetchLimit: params.has('evidenceFetchLimit')
            ? clampLimit(params.get('evidenceFetchLimit'), 0, recoveryMode ? 40 : 20)
            : undefined,
          providerValidationLimit: params.has('providerValidationLimit')
            ? clampLimit(
                params.get('providerValidationLimit'),
                0,
                recoveryMode || plan.mode === 'growth' ? 250 : 20
              )
            : undefined,
        })
      )
    }

    if (!queuedBeforeResearch && plan.runQueue && !sendSlotsAlreadyQueued) {
      stages.push(
        await runQueue({
          clientId: plan.clientId,
          sendLimit: plan.sendLimit,
          phase: 'after_research',
        })
      )
    } else if (!queuedBeforeResearch && plan.runQueue && sendSlotsAlreadyQueued) {
      stages.push({
        stage: 'queue_outbound',
        ok: true,
        status: 204,
        skipped: 'send_slots_already_queued_research_continues',
      })
    } else if (!queuedBeforeResearch) {
      stages.push({
        stage: 'queue_outbound',
        ok: true,
        status: 204,
        skipped: plan.dryRun ? 'dry_run_no_email_queued' : 'send_limit_or_capacity_blocked',
      })
    }

    // Run follow-ups stage
    stages.push(
      await runFollowupsStage({
        clientId: plan.clientId,
        dryRun: plan.dryRun,
      })
    )

    stages.push(await runEventRetentionStage(plan.clientId))

    const queueStages = stages.filter((stage) => stage.stage === 'queue_outbound')
    const queuedStage = queueStages.at(-1)
    const approvalStage = stages.find((stage) => stage.stage === 'research_approval')
    const sheetStage = stages.find((stage) => stage.stage === 'sheet_import')
    const mapsStage = stages.find((stage) => stage.stage === 'maps_import')
    const publicSearchStage = stages.find((stage) => stage.stage === 'public_search')
    const leadScoutStage = stages.find((stage) => stage.stage === 'lead_scout')
    const hunterStage = stages.find((stage) => stage.stage === 'hunter_domain_search')
    const queued = queueStages.reduce(
      (total, stage) => total + getNumericField(stage.data, 'queued'),
      0
    )
    const estimatedPipelineValueUsd = queueStages.reduce(
      (total, stage) => total + getNumericField(stage.data, 'estimatedPipelineValueUsd'),
      0
    )
    const agencyQueued = queueStages.reduce(
      (total, stage) => total + getNumericField(stage.data, 'agencyQueued'),
      0
    )
    const directQueued = queueStages.reduce(
      (total, stage) => total + getNumericField(stage.data, 'directQueued'),
      0
    )
    const agencyShortfall = queueStages.reduce(
      (total, stage) => total + getNumericField(stage.data, 'agencyShortfall'),
      0
    )
    const directShortfall = queueStages.reduce(
      (total, stage) => total + getNumericField(stage.data, 'directShortfall'),
      0
    )
    const approved = getNumericField(approvalStage?.data, 'approved')
    const imported = getNumericField(sheetStage?.data, 'imported')
    const mapsImported = getNumericField(mapsStage?.data, 'imported')
    const mapsPrepared = getNumericField(mapsStage?.data, 'prepared')
    const mapsEvidenceBacked = getNumericField(mapsStage?.data, 'evidenceBacked')
    const mapsScanned = getNumericField(mapsStage?.data, 'scanned')
    const mapsSource =
      mapsStage?.data && typeof mapsStage.data === 'object'
        ? String((mapsStage.data as Record<string, unknown>).sourceType || 'none')
        : 'none'
    const leadScoutImported = getNumericField(leadScoutStage?.data, 'imported')
    const leadScoutEvidenceBacked = getNumericField(leadScoutStage?.data, 'evidenceBacked')
    const publicSearchImported = getNumericField(publicSearchStage?.data, 'imported')
    const publicSearchPrepared = getNumericField(publicSearchStage?.data, 'prepared')
    const publicSearchEvidenceBacked = getNumericField(publicSearchStage?.data, 'evidenceBacked')
    const publicSearchScanned = getNumericField(publicSearchStage?.data, 'scanned')
    const publicSearchQueriesRun = getNumericField(publicSearchStage?.data, 'queriesRun')
    const hunterImported = getNumericField(hunterStage?.data, 'imported')
    const hunterPrepared = getNumericField(hunterStage?.data, 'prepared')
    const hunterRejected = getNumericField(hunterStage?.data, 'rejected')
    const senderReconcileStage = stages.find((stage) => stage.stage === 'sender_reconcile')
    const sendersReconciled = getNumericField(senderReconcileStage?.data, 'bootstrapped')
    const providerValidationChecks = getNumericField(approvalStage?.data, 'providerValidationChecks')
    const providerValidationValid = getNumericField(approvalStage?.data, 'providerValidationValid')
    const providerValidationInvalid = getNumericField(approvalStage?.data, 'providerValidationInvalid')
    const providerValidationBlocked = getNumericField(approvalStage?.data, 'providerValidationBlocked')
    const staleInvalidBlocked = getNumericField(approvalStage?.data, 'staleInvalidBlocked')

    const followupsStage = stages.find((stage) => stage.stage === 'run_followups')
    const followupsProcessed = getNumericField(followupsStage?.data, 'processed')
    const followupsSent = getNumericField(followupsStage?.data, 'emailsSent')
    const followupsCompleted = getNumericField(followupsStage?.data, 'sequencesCompleted')
    const followupsErrors = getNumericField(followupsStage?.data, 'errorsCount')
    const retentionStage = stages.find((stage) => stage.stage === 'event_retention')
    const brevoFailuresDeleted = getNumericField(retentionStage?.data, 'brevoFailuresDeleted')
    const staleGuardrailFailuresDeleted = getNumericField(
      retentionStage?.data,
      'staleGuardrailFailuresDeleted'
    )
    const staleFailuresDeleted = getNumericField(retentionStage?.data, 'staleFailuresDeleted')
    const eventBodiesRedacted = getNumericField(retentionStage?.data, 'bodiesRedacted')

    const hardFailures = stages.filter(
      (stage) =>
        !stage.ok &&
        stage.stage !== 'sheet_import' &&
        stage.stage !== 'maps_import' &&
        stage.stage !== 'public_search' &&
        stage.stage !== 'lead_scout'
    )
    const capacityDiagnosis = await getSendingCapacityDiagnosis(plan.clientId, {
      targetDailyVolume,
    })

    const digest = await getOutboundTelegramDigest(plan.clientId)
    const generatedAt = new Date().toISOString()
    const summary = {
      imported: imported + mapsImported + publicSearchImported + leadScoutImported + hunterImported,
      sheetImported: imported,
      mapsImported,
      mapsPrepared,
      mapsEvidenceBacked,
      publicSearchImported,
      publicSearchPrepared,
      publicSearchEvidenceBacked,
      publicSearchScanned,
      publicSearchQueriesRun,
      leadScoutImported,
      leadScoutEvidenceBacked,
      hunterImported,
      hunterPrepared,
      hunterRejected,
      sendersReconciled,
      approved,
      queued,
      estimatedPipelineValueUsd,
      agencyQueued,
      directQueued,
      agencyShortfall,
      directShortfall,
      providerValidationChecks,
      providerValidationValid,
      providerValidationInvalid,
      providerValidationBlocked,
      staleInvalidBlocked,
      followupsProcessed,
      followupsSent,
      followupsCompleted,
      followupsErrors,
      brevoFailuresDeleted,
      staleGuardrailFailuresDeleted,
      staleFailuresDeleted,
      eventBodiesRedacted,
      hardFailures: hardFailures.length,
      targetDailyVolume: capacityDiagnosis.targetDailyVolume,
      capacityRemaining: capacityDiagnosis.currentRemainingCapacity,
      capacityGap: capacityDiagnosis.targetGap,
      capacityBlocker: capacityDiagnosis.primaryBlocker,
      dailyFloor: volumeAdjustment.band.minDailyVolume,
      dailyCeiling: volumeAdjustment.band.maxDailyVolume,
      dailySentBeforeCycle: volumeAdjustment.sentToday,
      dailyRemainingToFloor: volumeAdjustment.remainingToMin,
      dailyRemainingToCeiling: volumeAdjustment.remainingToMax,
      researchUnlimited: plan.researchUnlimited,
      readyInventoryTarget: plan.readyInventoryTarget,
    }

    void notifyTelegramEvent({
      type: 'daily_outbound',
      dryRun: plan.dryRun,
      imported: summary.imported,
      approved,
      queued,
      estimatedPipelineValueUsd,
      agencyQueued,
      directQueued,
      sendLimit: plan.sendLimit,
      approveLimit: plan.approveLimit,
      failures: stages.filter((stage) => !stage.ok).length,
      targetDailyVolume: capacityDiagnosis.targetDailyVolume,
      capacityRemaining: capacityDiagnosis.currentRemainingCapacity,
      healthyDomains: capacityDiagnosis.healthyDomains,
      eligibleSenderIdentities: capacityDiagnosis.eligibleSenderIdentities,
      primaryBlocker: capacityDiagnosis.primaryBlocker,
      ...digest,
      nextAction: digest.nextAction || capacityDiagnosis.nextAction,
    })

    if (compactResponse) {
      return new Response(
        [
          `ok=${hardFailures.length === 0 ? 1 : 0}`,
          `client=${plan.clientId}`,
          `imported=${summary.imported}`,
          `public=${publicSearchImported}/${publicSearchEvidenceBacked}/${publicSearchScanned}`,
          `queries=${publicSearchQueriesRun}`,
          `maps=${mapsImported}/${mapsPrepared}/${mapsScanned}`,
          `mapsSource=${mapsSource}`,
          `approved=${approved}`,
          `queued=${queued}`,
          `agency=${agencyQueued}`,
          `direct=${directQueued}`,
          `agencyShortfall=${agencyShortfall}`,
          `directShortfall=${directShortfall}`,
          `failures=${hardFailures.length}`,
          `capacity=${capacityDiagnosis.currentRemainingCapacity}`,
          `blocker=${capacityDiagnosis.primaryBlocker}`,
          `floor=${volumeAdjustment.band.minDailyVolume}`,
          `ceiling=${volumeAdjustment.band.maxDailyVolume}`,
          `sentBefore=${volumeAdjustment.sentToday}`,
          `sendLimit=${plan.sendLimit}`,
          `researchUnlimited=${plan.researchUnlimited ? 1 : 0}`,
          `readyTarget=${plan.readyInventoryTarget}`,
        ].join(' '),
        {
          status: hardFailures.length === 0 ? 200 : 207,
          headers: {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store',
          },
        }
      )
    }

    return NextResponse.json({
      ok: hardFailures.length === 0,
      enabled: true,
      daily: true,
      clientId: plan.clientId,
      dryRun: plan.dryRun,
      generatedAt,
      summary,
      capacity: {
        targetDailyVolume: capacityDiagnosis.targetDailyVolume,
        currentRemainingCapacity: capacityDiagnosis.currentRemainingCapacity,
        targetGap: capacityDiagnosis.targetGap,
        activeDomains: capacityDiagnosis.activeDomains,
        healthyDomains: capacityDiagnosis.healthyDomains,
        eligibleSenderIdentities: capacityDiagnosis.eligibleSenderIdentities,
        primaryBlocker: capacityDiagnosis.primaryBlocker,
        nextAction: capacityDiagnosis.nextAction,
        scaleModel: capacityDiagnosis.scaleModel,
      },
      plan: verbose ? plan : {
        mode: plan.mode,
        recoveryMode,
        sheetImport: plan.runSheetImport,
        mapsImport: plan.runMapsImport,
        mapsLimit: plan.mapsLimit,
        publicSearch: plan.runPublicSearch,
        publicSearchLimit: plan.publicSearchLimit,
        leadScout: plan.runLeadScout,
        leadScoutLimit: plan.leadScoutLimit,
        approveLimit: plan.approveLimit,
        sendLimit: plan.sendLimit,
        researchUnlimited: plan.researchUnlimited,
        readyInventoryTarget: plan.readyInventoryTarget,
        dailyVolume: {
          floor: volumeAdjustment.band.minDailyVolume,
          ceiling: volumeAdjustment.band.maxDailyVolume,
          sentBeforeCycle: volumeAdjustment.sentToday,
          remainingToFloor: volumeAdjustment.remainingToMin,
          remainingToCeiling: volumeAdjustment.remainingToMax,
        },
      },
      approvalWindow: verbose ? approvalWindow : {
        limit: approvalWindow.limit,
        activeDomains: approvalWindow.activeDomains,
        remainingCapacity: approvalWindow.remainingCapacity,
        averageHealthScore: approvalWindow.averageHealthScore,
        policy: approvalWindow.policy,
      },
      maintenance,
      stages: verbose ? stages : stages.map(compactStage),
    })
  } catch (error) {
    console.error('[api/cron/daily-outbound] failed', error)
    const params = request.nextUrl.searchParams
    const compactResponse = envBool(
      params.get('compact') ||
        params.get('cronCompact') ||
        process.env.DAILY_OUTBOUND_COMPACT_RESPONSE,
      false
    )
    if (compactResponse) {
      return new Response(`ok=0 error=${safeError(error).slice(0, 160)}`, {
        status: 500,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        },
      })
    }
    return NextResponse.json(
      { ok: false, error: 'failed', detail: safeError(error) },
      { status: 500 }
    )
  }
}
