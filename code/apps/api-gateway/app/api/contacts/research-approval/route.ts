import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { resolveClientId } from '@/lib/client-context'
import { resolveSystemApprovalWindow } from '@/lib/contact-approval-window'
import {
  scoreProspectForResearchApproval,
  type ProspectResearchContact,
} from '@/lib/prospect-research'
import { notifyTelegramEvent } from '@/lib/telegram-notifications'

function clampLimit(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(Math.trunc(parsed), 250))
}

function clampThreshold(value: unknown): number {
  const parsed = Number(value ?? 72)
  if (!Number.isFinite(parsed)) return 72
  return Math.max(50, Math.min(Math.trunc(parsed), 95))
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

async function researchApproval(request: NextRequest, apply: boolean) {
  const body = request.method === 'GET' ? {} : await request.json().catch(() => ({}))
  const clientId = await resolveClientId({
    body: body as Record<string, unknown>,
    headers: request.headers,
    searchParams: request.nextUrl.searchParams,
  })
  const approvalWindow = await resolveSystemApprovalWindow(clientId)
  const limit = clampLimit(
    (body as any).limit ?? request.nextUrl.searchParams.get('limit'),
    approvalWindow.limit
  )
  const threshold = clampThreshold((body as any).threshold ?? request.nextUrl.searchParams.get('threshold'))
  const pool = await getResearchPool(clientId)
  const decisions = pool.map((contact) => scoreProspectForResearchApproval(contact, { threshold }))
  const approvedCandidates = decisions
    .filter((decision) => decision.approved)
    .sort((a, b) => b.score - a.score || a.email.localeCompare(b.email))
    .slice(0, limit)
  const blocked = decisions
    .filter((decision) => !decision.approved)
    .sort((a, b) => b.score - a.score || a.email.localeCompare(b.email))
    .slice(0, 25)

  if (!apply) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      clientId,
      threshold,
      systemApprovalWindow: approvalWindow,
      scanned: decisions.length,
      approvalReady: approvedCandidates.length,
      candidates: approvedCandidates,
      blocked,
      guardrails: [
        'Approves business inboxes only',
        'Requires public evidence/source URL',
        'Requires email and company domain alignment',
        'Blocks personal, support, legal, security, bounced, and unsubscribed contacts',
        'Approval does not send email; cron queues approved contacts separately',
      ],
    })
  }

  const candidateIds = approvedCandidates.map((candidate) => candidate.id)
  if (candidateIds.length === 0) {
    return NextResponse.json({
      ok: true,
      dryRun: false,
      clientId,
      approved: 0,
      scanned: decisions.length,
      blocked,
      skipped: 'no_research_verified_prospects',
      systemApprovalWindow: approvalWindow,
    })
  }

  const result = await query(
    `UPDATE contacts
     SET custom_fields = COALESCE(custom_fields, '{}'::jsonb)
       || jsonb_build_object(
         'send_status', 'approved',
         'approval_required', false,
         'approved_at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'approved_by', 'research_approval_gate',
         'approval_batch', 'research_verified_best',
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
      clientId,
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
    mode: 'research_verified_best',
  })

  return NextResponse.json({
    ok: true,
    dryRun: false,
    clientId,
    threshold,
    approved,
    scanned: decisions.length,
    contacts: result.rows,
    blocked,
    systemApprovalWindow: approvalWindow,
  })
}

export async function GET(request: NextRequest) {
  try {
    return await researchApproval(request, false)
  } catch (error) {
    console.error('[API] Research approval preview failed', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to preview research approval' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    return await researchApproval(request, true)
  } catch (error) {
    console.error('[API] Research approval failed', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to research and approve prospects' },
      { status: 500 }
    )
  }
}
