import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { Queue } from 'bullmq'
import { appEnv } from '@/lib/env'
import { query } from '@/lib/db'
import { importContacts } from '@/lib/backend'
import { resolveSystemApprovalWindow } from '@/lib/contact-approval-window'
import { buildDailyOutboundPlan } from '@/lib/daily-outbound'
import { buildGoogleSheetCsvUrl, prepareSheetContacts } from '@/lib/sheet-import'
import {
  approvedContactQueueBlockers,
  enrichProspectWithProviderValidation,
  enrichProspectWithPublicEmailEvidence,
  prospectNeedsExactPublicEmailEvidence,
  scoreProspectForResearchApproval,
  type ProspectResearchContact,
} from '@/lib/prospect-research'
import { leadScoutToContacts, scoutOpenLeads, verifyOpenLeadEvidence } from '@/lib/lead-scout'
import { notifyTelegramEvent } from '@/lib/telegram-notifications'
import {
  inferSovereignOfferType,
  rankSovereignLeads,
  renderSovereignTemplate,
  sovereignDealValueUsd,
  sovereignBodyForLead,
  sovereignSubjectForLead,
} from '@/lib/outbound-copy'

type StageResult = {
  stage: 'lead_scout' | 'sheet_import' | 'research_approval' | 'queue_outbound'
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
}

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

function clampThreshold(value: unknown): number {
  const parsed = Number(value ?? 72)
  if (!Number.isFinite(parsed)) return 72
  return Math.max(50, Math.min(Math.trunc(parsed), 95))
}

function getNumericField(data: unknown, key: string): number {
  if (!data || typeof data !== 'object') return 0
  const value = (data as Record<string, unknown>)[key]
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(Math.trunc(parsed), max))
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function pickRotatingValue(value: string | undefined, fallback: string): string {
  const items = String(value || fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  if (items.length <= 1) return items[0] || fallback
  const day = Math.floor(Date.now() / 86_400_000)
  return items[day % items.length] || fallback
}

function leadScoutOffset(limit: number): number {
  const rotationMinutes = clampLimit(process.env.LEAD_SCOUT_ROTATION_MINUTES, 60, 1_440)
  const windowMs = Math.max(rotationMinutes, 15) * 60_000
  return Math.floor(Date.now() / windowMs) * limit
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
      providerValidationChecks: getNumericField(data, 'providerValidationChecks'),
      providerValidationValid: getNumericField(data, 'providerValidationValid'),
      providerValidationInvalid: getNumericField(data, 'providerValidationInvalid'),
      approved: getNumericField(data, 'approved'),
      queued: getNumericField(data, 'queued'),
      blockedUnverified: getNumericField(data, 'blockedUnverified'),
      skipped: typeof data.skipped === 'string' ? data.skipped : undefined,
      queue: typeof data.queue === 'string' ? data.queue : undefined,
      estimatedPipelineValueUsd: getNumericField(data, 'estimatedPipelineValueUsd'),
      agencyQueued: getNumericField(data, 'agencyQueued'),
      directQueued: getNumericField(data, 'directQueued'),
    },
  }
}

async function runLeadScoutStage(input: {
  clientId: number
  dryRun: boolean
  limit: number
  industry?: string | null
  persona?: string | null
  region?: string | null
}): Promise<StageResult> {
  try {
    const result = scoutOpenLeads({
      industry:
        input.industry ||
        pickRotatingValue(process.env.LEAD_SCOUT_INDUSTRIES || process.env.LEAD_SCOUT_INDUSTRY, 'agency'),
      persona: input.persona || process.env.LEAD_SCOUT_PERSONA || 'partnerships',
      region: input.region || process.env.LEAD_SCOUT_REGION || 'global',
      limit: input.limit,
      offset: leadScoutOffset(input.limit),
    })
    const verifiedLeads = await verifyOpenLeadEvidence(result.leads)
    const importableLeads = verifiedLeads.filter((lead) => lead.autoApprovalEligible)
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
        evidenceBacked: importableLeads.length,
        blockedUnverified: verifiedLeads.length - importableLeads.length,
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
        evidenceBacked: importableLeads.length,
        blockedUnverified: verifiedLeads.length - importableLeads.length,
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
       AND COALESCE(custom_fields->>'send_status', 'not_approved') <> 'approved'
       AND (
         source IN ('google_sheet_import', 'open_lead_graph', 'owned_open_lead_graph')
         OR COALESCE(custom_fields->>'sheet_import', 'false') = 'true'
         OR COALESCE(custom_fields->>'lead_scout', 'false') = 'true'
       )
     ORDER BY created_at ASC
     LIMIT 500`,
    [clientId]
  )

  return result.rows
}

async function runResearchApproval(input: {
  clientId: number
  dryRun: boolean
  approveLimit: number
  evidenceFetchLimit?: number
  providerValidationLimit?: number
}): Promise<StageResult> {
  try {
    const threshold = clampThreshold(process.env.DAILY_OUTBOUND_APPROVAL_THRESHOLD)
    const pool = await getResearchPool(input.clientId)
    const evidenceFetchLimit = clampLimit(
      input.evidenceFetchLimit ??
        (input.dryRun ? 0 : process.env.DAILY_OUTBOUND_EVIDENCE_FETCH_LIMIT),
      input.dryRun ? 0 : 5,
      input.dryRun ? 5 : 20
    )
    const providerValidationLimit = clampLimit(
      input.providerValidationLimit ??
        (input.dryRun ? 0 : process.env.DAILY_OUTBOUND_PROVIDER_VALIDATION_LIMIT),
      input.dryRun ? 0 : 5,
      input.dryRun ? 5 : 20
    )
    const networkDeadlineMs = input.dryRun ? 8_000 : 45_000
    const networkDeadlineAt = Date.now() + networkDeadlineMs
    let evidenceFetches = 0
    let evidenceMatches = 0
    let providerValidationChecks = 0
    let providerValidationValid = 0
    let providerValidationInvalid = 0
    const enrichedPool: ProspectResearchContact[] = []
    const providerValidationUpdates: ProspectResearchContact[] = []

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
          candidate = validation.contact
          providerValidationUpdates.push(candidate)
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
    const approvedCandidates = decisions
      .filter((decision) => decision.approved)
      .sort((a, b) => b.score - a.score || a.email.localeCompare(b.email))
      .slice(0, input.approveLimit)
    const blocked = decisions
      .filter((decision) => !decision.approved)
      .sort((a, b) => b.score - a.score || a.email.localeCompare(b.email))
      .slice(0, 25)

    if (input.dryRun) {
      return {
        stage: 'research_approval',
        ok: true,
        status: 200,
        data: {
          dryRun: true,
          scanned: decisions.length,
          evidenceFetches,
          evidenceMatches,
          providerValidationChecks,
          providerValidationValid,
          providerValidationInvalid,
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
          scanned: decisions.length,
          evidenceFetches,
          evidenceMatches,
          providerValidationChecks,
          providerValidationValid,
          providerValidationInvalid,
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
           'research_evidence_url', scores.evidence_url,
           'email_evidence', COALESCE(NULLIF(scores.email_evidence, ''), contacts.custom_fields->>'email_evidence')
         ),
         verification_status = COALESCE(NULLIF(scores.verification_status, ''), contacts.verification_status),
         updated_at = CURRENT_TIMESTAMP
       FROM (
         SELECT *
         FROM jsonb_to_recordset($3::jsonb) AS x(id bigint, score int, reasons jsonb, evidence_url text, email_evidence text, verification_status text)
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
            reasons: candidate.reasons,
            evidence_url: candidate.evidenceUrl,
            email_evidence: asString(contactById.get(candidate.id)?.custom_fields?.email_evidence),
            verification_status: asString(contactById.get(candidate.id)?.verification_status),
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
        scanned: decisions.length,
        evidenceFetches,
        evidenceMatches,
        providerValidationChecks,
        providerValidationValid,
        providerValidationInvalid,
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

async function loadApprovedContacts(clientId: number, limit: number): Promise<ApprovedLead[]> {
  const scanLimit = Math.min(Math.max(limit * 5, limit), 500)
  const result = await query<{
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
  }>(
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
       AND NOT (
         COALESCE(c.custom_fields->>'lead_scout', 'false') = 'true'
         AND COALESCE(c.custom_fields->>'auto_approval_eligible', 'false') <> 'true'
       )
       AND NOT EXISTS (
         SELECT 1
         FROM suppression_list s
         WHERE s.client_id = c.client_id
           AND LOWER(s.email) = LOWER(c.email)
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

  const eligibleRows = result.rows.filter(
    (row) =>
      approvedContactQueueBlockers({
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
      }).length === 0
  )

  const leads = eligibleRows.map((row) => {
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

  return rankSovereignLeads(leads).slice(0, limit)
}

async function runQueue(input: {
  clientId: number
  sendLimit: number
}): Promise<StageResult> {
  let queue: Queue | null = null
  try {
    const leads = await loadApprovedContacts(input.clientId, input.sendLimit)
    const queueName = process.env.SEND_QUEUE ?? 'xv-send-queue'

    if (leads.length === 0) {
      void notifyTelegramEvent({
        type: 'queue_skipped',
        reason: 'no_verified_approved_leads',
        source: 'daily_approved_contacts_only',
      })

      return {
        stage: 'queue_outbound',
        ok: true,
        status: 200,
        data: {
          queued: 0,
          source: 'daily_approved_contacts_only',
          skipped: 'no_verified_approved_leads',
        },
      }
    }

    const physicalAddress = process.env.SENDER_PHYSICAL_ADDRESS || 'Xavira Tech Labs, India'
    const allowCopyOverride = envBool(process.env.OUTBOUND_CRON_ALLOW_COPY_OVERRIDE, false)
    const today = new Date().toISOString().slice(0, 10)
    queue = new Queue(queueName, { connection: { url: appEnv.redisUrl() } })

    const jobs = leads.map((lead) => {
      const subject =
        allowCopyOverride && process.env.OUTBOUND_CRON_SUBJECT
          ? process.env.OUTBOUND_CRON_SUBJECT
          : sovereignSubjectForLead(lead)
      const template =
        allowCopyOverride && process.env.OUTBOUND_CRON_BODY
          ? process.env.OUTBOUND_CRON_BODY
          : sovereignBodyForLead(lead)
      const idempotencyKey = crypto
        .createHash('sha256')
        .update(`daily:${today}:${input.clientId}:${lead.email}:${subject}`)
        .digest('hex')

      return {
        name: 'cron_outbound_sales',
        data: {
          clientId: input.clientId,
          toEmail: lead.email,
          subject,
          text: renderSovereignTemplate(template, lead, physicalAddress),
          idempotencyKey,
        },
        opts: {
          jobId: idempotencyKey,
          attempts: 1,
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      }
    })

    const added = await queue.addBulk(jobs)
    const queuedLeads = leads.slice(0, added.length)
    const estimatedPipelineValueUsd = queuedLeads.reduce(
      (sum, lead) => sum + lead.deal_value_usd,
      0
    )
    const agencyQueued = queuedLeads.filter((lead) => lead.offer_type === 'agency').length
    const directQueued = queuedLeads.length - agencyQueued
    const contactIds = leads
      .map((lead) => lead.contact_id)
      .filter((id): id is number => Number.isSafeInteger(id))

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

    void notifyTelegramEvent({
      type: 'queue_batch',
      queued: added.length,
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
        queued: added.length,
        limit: input.sendLimit,
        estimatedPipelineValueUsd,
        agencyQueued,
        directQueued,
        firstJobId: added[0]?.id ?? null,
        lastJobId: added.at(-1)?.id ?? null,
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

export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  try {
    const params = request.nextUrl.searchParams
    const clientId = Number(params.get('client_id') || process.env.DEFAULT_CLIENT_ID || 1)
    const approvalWindow = await resolveSystemApprovalWindow(clientId)
    const plan = buildDailyOutboundPlan({
      approvalWindow,
      env: process.env,
      query: {
        clientId: String(clientId),
        dryRun: params.get('dryRun') || params.get('preview'),
        sheetUrl: params.get('sheetUrl'),
        sheetLimit: params.get('sheetLimit'),
        leadScout: params.get('leadScout'),
        leadScoutLimit: params.get('leadScoutLimit'),
        approveLimit: params.get('approveLimit'),
        sendLimit: params.get('sendLimit'),
        mode: params.get('mode'),
      },
    })
    const stages: StageResult[] = []
    const verbose = envBool(params.get('verbose') || process.env.DAILY_OUTBOUND_VERBOSE_RESPONSE, false)

    if (!plan.enabled) {
      return NextResponse.json({
        ok: true,
        enabled: false,
        daily: true,
        plan,
        stages,
      })
    }

    if (plan.runLeadScout) {
      stages.push(
        await runLeadScoutStage({
          clientId: plan.clientId,
          dryRun: plan.dryRun,
          limit: plan.leadScoutLimit,
          industry: params.get('industry') || params.get('leadScoutIndustry'),
          persona: params.get('persona') || params.get('leadScoutPersona'),
          region: params.get('region') || params.get('leadScoutRegion'),
        })
      )
    } else {
      stages.push({
        stage: 'lead_scout',
        ok: true,
        status: 204,
        skipped: 'lead_scout_disabled',
      })
    }

    if (plan.runSheetImport) {
      stages.push(
        await runSheetImport({
          clientId: plan.clientId,
          dryRun: plan.dryRun,
          sheetUrl: plan.sheetUrl,
          sheetLimit: plan.sheetLimit,
        })
      )
    } else {
      stages.push({
        stage: 'sheet_import',
        ok: true,
        status: 204,
        skipped: 'no_sheet_configured_existing_contacts_only',
      })
    }

    if (plan.runResearchApproval) {
      stages.push(
        await runResearchApproval({
          clientId: plan.clientId,
          dryRun: plan.dryRun,
          approveLimit: plan.approveLimit,
          evidenceFetchLimit: params.has('evidenceFetchLimit')
            ? clampLimit(params.get('evidenceFetchLimit'), 0, 20)
            : undefined,
          providerValidationLimit: params.has('providerValidationLimit')
            ? clampLimit(params.get('providerValidationLimit'), 0, 20)
            : undefined,
        })
      )
    }

    if (plan.runQueue) {
      stages.push(
        await runQueue({
          clientId: plan.clientId,
          sendLimit: plan.sendLimit,
        })
      )
    } else {
      stages.push({
        stage: 'queue_outbound',
        ok: true,
        status: 204,
        skipped: plan.dryRun ? 'dry_run_no_email_queued' : 'send_limit_or_capacity_blocked',
      })
    }

    const queuedStage = stages.find((stage) => stage.stage === 'queue_outbound')
    const approvalStage = stages.find((stage) => stage.stage === 'research_approval')
    const sheetStage = stages.find((stage) => stage.stage === 'sheet_import')
    const leadScoutStage = stages.find((stage) => stage.stage === 'lead_scout')
    const queued = getNumericField(queuedStage?.data, 'queued')
    const estimatedPipelineValueUsd = getNumericField(
      queuedStage?.data,
      'estimatedPipelineValueUsd'
    )
    const agencyQueued = getNumericField(queuedStage?.data, 'agencyQueued')
    const directQueued = getNumericField(queuedStage?.data, 'directQueued')
    const approved = getNumericField(approvalStage?.data, 'approved')
    const imported = getNumericField(sheetStage?.data, 'imported')
    const leadScoutImported = getNumericField(leadScoutStage?.data, 'imported')
    const leadScoutEvidenceBacked = getNumericField(leadScoutStage?.data, 'evidenceBacked')
    const hardFailures = stages.filter(
      (stage) => !stage.ok && stage.stage !== 'sheet_import' && stage.stage !== 'lead_scout'
    )

    void notifyTelegramEvent({
      type: 'daily_outbound',
      dryRun: plan.dryRun,
      imported: imported + leadScoutImported,
      approved,
      queued,
      estimatedPipelineValueUsd,
      agencyQueued,
      directQueued,
      sendLimit: plan.sendLimit,
      approveLimit: plan.approveLimit,
      failures: stages.filter((stage) => !stage.ok).length,
    })

    return NextResponse.json({
      ok: hardFailures.length === 0,
      enabled: true,
      daily: true,
      clientId: plan.clientId,
      dryRun: plan.dryRun,
      generatedAt: new Date().toISOString(),
      summary: {
        imported: imported + leadScoutImported,
        sheetImported: imported,
        leadScoutImported,
        leadScoutEvidenceBacked,
        approved,
        queued,
        estimatedPipelineValueUsd,
        agencyQueued,
        directQueued,
        hardFailures: hardFailures.length,
      },
      plan: verbose ? plan : {
        mode: plan.mode,
        sheetImport: plan.runSheetImport,
        leadScout: plan.runLeadScout,
        leadScoutLimit: plan.leadScoutLimit,
        approveLimit: plan.approveLimit,
        sendLimit: plan.sendLimit,
      },
      approvalWindow: verbose ? approvalWindow : {
        limit: approvalWindow.limit,
        activeDomains: approvalWindow.activeDomains,
        remainingCapacity: approvalWindow.remainingCapacity,
        averageHealthScore: approvalWindow.averageHealthScore,
        policy: approvalWindow.policy,
      },
      stages: verbose ? stages : stages.map(compactStage),
    })
  } catch (error) {
    console.error('[api/cron/daily-outbound] failed', error)
    return NextResponse.json(
      { ok: false, error: 'failed', detail: safeError(error) },
      { status: 500 }
    )
  }
}
