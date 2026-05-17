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
  scoreProspectForResearchApproval,
  type ProspectResearchContact,
} from '@/lib/prospect-research'
import { notifyTelegramEvent } from '@/lib/telegram-notifications'
import {
  inferSovereignOfferType,
  renderSovereignTemplate,
  sovereignBodyForLead,
  sovereignSubjectForLead,
} from '@/lib/outbound-copy'

type StageResult = {
  stage: 'sheet_import' | 'research_approval' | 'queue_outbound'
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
}): Promise<StageResult> {
  try {
    const threshold = clampThreshold(process.env.DAILY_OUTBOUND_APPROVAL_THRESHOLD)
    const pool = await getResearchPool(input.clientId)
    const decisions = pool.map((contact) =>
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
           'research_evidence_url', scores.evidence_url
         ),
         updated_at = CURRENT_TIMESTAMP
       FROM (
         SELECT *
         FROM jsonb_to_recordset($3::jsonb) AS x(id bigint, score int, reasons jsonb, evidence_url text)
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
  const result = await query<{
    id: string
    email: string
    first_name: string | null
    company: string | null
    company_domain: string | null
    title: string | null
    source: string | null
    reason_to_contact: string | null
    custom_fields: Record<string, unknown> | null
  }>(
    `SELECT
       c.id::text,
       c.email,
       COALESCE(NULLIF(c.name, ''), split_part(c.email, '@', 1)) AS first_name,
       COALESCE(NULLIF(c.company, ''), c.company_domain, c.email_domain, 'your team') AS company,
       c.company_domain,
       c.title,
       c.source,
       COALESCE(c.custom_fields->>'reason_to_contact', 'reviewed approved business prospect') AS reason_to_contact,
       c.custom_fields
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
    [clientId, limit]
  )

  return result.rows.map((row) => ({
    contact_id: Number(row.id),
    email: row.email,
    first_name: row.first_name || row.email.split('@')[0] || 'there',
    company: row.company || row.email.split('@')[1] || 'your team',
    title: row.title || undefined,
    company_domain: row.company_domain || undefined,
    consent_source: 'operator_approved_business_outreach',
    reason_to_contact: row.reason_to_contact || 'reviewed approved business prospect',
    offer_type: inferSovereignOfferType({
      company: row.company,
      companyDomain: row.company_domain,
      title: row.title,
      source: row.source,
      reasonToContact: row.reason_to_contact,
      customFields: row.custom_fields,
    }),
  }))
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
    })

    return {
      stage: 'queue_outbound',
      ok: true,
      status: 200,
      data: {
        queue: queueName,
        queued: added.length,
        limit: input.sendLimit,
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
        approveLimit: params.get('approveLimit'),
        sendLimit: params.get('sendLimit'),
        mode: params.get('mode'),
      },
    })
    const stages: StageResult[] = []

    if (!plan.enabled) {
      return NextResponse.json({
        ok: true,
        enabled: false,
        daily: true,
        plan,
        stages,
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
    const queued = getNumericField(queuedStage?.data, 'queued')
    const approved = getNumericField(approvalStage?.data, 'approved')
    const imported = getNumericField(sheetStage?.data, 'imported')
    const hardFailures = stages.filter(
      (stage) => !stage.ok && stage.stage !== 'sheet_import'
    )

    void notifyTelegramEvent({
      type: 'daily_outbound',
      dryRun: plan.dryRun,
      imported,
      approved,
      queued,
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
        imported,
        approved,
        queued,
        hardFailures: hardFailures.length,
      },
      plan,
      approvalWindow,
      stages,
    })
  } catch (error) {
    console.error('[api/cron/daily-outbound] failed', error)
    return NextResponse.json(
      { ok: false, error: 'failed', detail: safeError(error) },
      { status: 500 }
    )
  }
}
