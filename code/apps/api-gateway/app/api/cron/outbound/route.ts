import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { Queue } from 'bullmq'
import { appEnv } from '@/lib/env'
import { query } from '@/lib/db'
import { notifyTelegramEvent } from '@/lib/telegram-notifications'
import {
  buildSovereignCopyForLead,
  inferSovereignOfferType,
} from '@/lib/outbound-copy'
import { approvedContactQueueBlockers, type ProspectResearchContact } from '@/lib/prospect-research'

type CronLead = {
  email?: string
  first_name?: string
  firstName?: string
  company?: string
  title?: string
  consent_source?: string
  reason_to_contact?: string
  offer_type?: string
}

type PreparedCronLead = {
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

function enabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function safeError(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isPlaceholderEmail(value: string): boolean {
  const email = value.toLowerCase()
  const domain = email.split('@')[1] ?? ''
  return (
    domain === 'example.com' ||
    domain === 'example.org' ||
    domain === 'example.net' ||
    domain.endsWith('.test') ||
    email.includes('placeholder') ||
    email.includes('demo@') ||
    email.includes('test@')
  )
}

function safeLimit(raw: string | null): number {
  const maxLimit = Math.max(1, Math.min(Number(process.env.OUTBOUND_CRON_MAX_LIMIT ?? 5), 25))
  const fallback = Math.max(1, Math.min(Number(process.env.OUTBOUND_CRON_LIMIT ?? 1), maxLimit))
  const parsed = Number(raw ?? fallback)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(parsed, maxLimit))
}

function parseLeads(): CronLead[] {
  const rawJson = String(process.env.OUTBOUND_CRON_LEADS_JSON || '').trim()
  if (rawJson) {
    const parsed = JSON.parse(rawJson)
    if (!Array.isArray(parsed)) throw new Error('OUTBOUND_CRON_LEADS_JSON must be an array')
    return parsed
  }

  const rawLines = String(process.env.OUTBOUND_CRON_RECIPIENTS || '').trim()
  if (!rawLines) return []

  return rawLines
    .split(/[\n,;]+/)
    .map((email) => email.trim())
    .filter(Boolean)
    .map((email) => ({
      email,
      first_name: email.split('@')[0],
      company: email.split('@')[1] ?? 'your team',
      consent_source: 'legitimate_business_interest',
      reason_to_contact: 'reviewed business outreach list',
    }))
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
         'blocked_by', 'legacy_outbound_queue_recheck',
         'blocked_at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'queue_gate_checked_at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'hunter_verdict', 'blocked',
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
          approval_blocked_reason: blockers[0] ?? 'legacy_queue_recheck_failed',
          hunter_blockers: blockers,
        }))
      ),
    ]
  )

  return result.rowCount ?? 0
}

async function loadApprovedContacts(clientId: number, limit: number): Promise<PreparedCronLead[]> {
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

  const reviewedRows = result.rows.map((row) => ({
    row,
    blockers: approvedContactQueueBlockers(approvedRowToResearchContact(row)),
  }))
  const blockedRows = reviewedRows.filter(({ blockers }) => blockers.length > 0)
  await quarantineApprovedContacts(clientId, blockedRows)

  return reviewedRows.filter(({ blockers }) => blockers.length === 0).map(({ row }) => ({
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

function authorize(request: NextRequest): boolean {
  const expected = appEnv.cronSecret()
  const provided =
    request.headers.get('x-cron-secret') ||
    request.nextUrl.searchParams.get('secret') ||
    ''
  return Boolean(expected && provided && provided === expected)
}

export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  if (!enabled(process.env.OUTBOUND_CRON_ENABLED)) {
    return NextResponse.json({ ok: true, enabled: false, queued: 0 })
  }

  let queue: Queue | null = null
  try {
    const clientId = appEnv.defaultClientId()
    const physicalAddress = process.env.SENDER_PHYSICAL_ADDRESS || 'Xavira Tech Labs, India'
    const allowCopyOverride = enabled(process.env.OUTBOUND_CRON_ALLOW_COPY_OVERRIDE)
    const limit = safeLimit(request.nextUrl.searchParams.get('limit'))
    const today = new Date().toISOString().slice(0, 10)
    const seen = new Set<string>()

    const configuredLeads = parseLeads()
      .map((lead) => {
        const email = String(lead.email || '').trim().toLowerCase()
        return {
          contact_id: undefined,
          email,
          first_name: String(lead.first_name || lead.firstName || 'there').trim(),
          company: String(lead.company || email.split('@')[1] || 'your team').trim(),
          title: String(lead.title || '').trim() || undefined,
          consent_source: String(lead.consent_source || 'legitimate_business_interest').trim(),
          reason_to_contact: String(lead.reason_to_contact || 'reviewed business outreach list').trim(),
          offer_type: inferSovereignOfferType({
            company: lead.company,
            title: lead.title,
            reason_to_contact: lead.reason_to_contact,
            offer_type: lead.offer_type,
          }),
        }
      })
      .filter((lead) => {
        if (!isEmail(lead.email) || isPlaceholderEmail(lead.email)) return false
        if (seen.has(lead.email)) return false
        seen.add(lead.email)
        return Boolean(lead.consent_source || lead.reason_to_contact)
      })
      .slice(0, limit)
    const approvedLeads = await loadApprovedContacts(clientId, limit)
    const useConfiguredOnly =
      request.nextUrl.searchParams.get('source') === 'configured' ||
      enabled(process.env.OUTBOUND_CRON_CONFIGURED_ONLY)
    const allowConfiguredFallback =
      request.nextUrl.searchParams.get('source') === 'configured' ||
      enabled(process.env.OUTBOUND_CRON_ALLOW_CONFIGURED_FALLBACK)
    const leads: PreparedCronLead[] = useConfiguredOnly
      ? configuredLeads
      : approvedLeads.length > 0
        ? approvedLeads
        : allowConfiguredFallback
          ? configuredLeads
          : []
    const leadSource = useConfiguredOnly
      ? 'configured'
      : approvedLeads.length > 0
        ? 'approved_contacts'
        : allowConfiguredFallback
          ? 'configured_fallback'
          : 'approved_contacts_only'

    if (leads.length === 0) {
      void notifyTelegramEvent({
        type: 'queue_skipped',
        reason: 'no_verified_approved_leads',
        source: leadSource,
      })

      return NextResponse.json({
        ok: true,
        enabled: true,
        queued: 0,
        source: leadSource,
        skipped: 'no_verified_approved_leads',
      })
    }

    const queueName = process.env.SEND_QUEUE ?? 'xv-send-queue'
    queue = new Queue(queueName, { connection: { url: appEnv.redisUrl() } })
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
      })
      const idempotencyKey = crypto
        .createHash('sha256')
        .update(`cron:${today}:${clientId}:${lead.email}:${copy.subject}`)
        .digest('hex')
      return {
        name: 'cron_outbound_sales',
        data: {
          clientId,
          toEmail: lead.email,
          subject: copy.subject,
          text: copy.text,
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

    const added = await queue.addBulk(jobs)
    const contactIds = leads
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
        [clientId, contactIds]
      )
    }

    void notifyTelegramEvent({
      type: 'queue_batch',
      queued: added.length,
      source: leadSource,
      queue: queueName,
      limit,
    })

    return NextResponse.json({
      ok: true,
      enabled: true,
      queue: queueName,
      queued: added.length,
      limit,
      source: leadSource,
      firstJobId: added[0]?.id ?? null,
      lastJobId: added.at(-1)?.id ?? null,
    })
  } catch (error) {
    console.error('[api/cron/outbound] failed', error)
    return NextResponse.json(
      {
        ok: false,
        error: 'failed',
        detail: safeError(error),
        diagnostics: {
          enabled: enabled(process.env.OUTBOUND_CRON_ENABLED),
          hasRedisUrl: Boolean(process.env.REDIS_URL),
          redisUrlScheme: process.env.REDIS_URL?.split('://')[0] ?? null,
          hasRecipients: Boolean(String(process.env.OUTBOUND_CRON_RECIPIENTS || '').trim()),
          hasLeadsJson: Boolean(String(process.env.OUTBOUND_CRON_LEADS_JSON || '').trim()),
          sendQueue: process.env.SEND_QUEUE ?? 'xv-send-queue',
        },
      },
      { status: 500 }
    )
  } finally {
    await queue?.close()
  }
}
