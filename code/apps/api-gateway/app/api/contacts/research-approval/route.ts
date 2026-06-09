import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { resolveClientId } from '@/lib/client-context'
import { resolveSystemApprovalWindow } from '@/lib/contact-approval-window'
import {
  enrichProspectWithPublicEmailEvidence,
  prospectNeedsExactPublicEmailEvidence,
  scoreProspectForResearchApproval,
  type ProspectResearchContact,
  type ProspectResearchDecision,
} from '@/lib/prospect-research'
import { notifyTelegramEvent } from '@/lib/telegram-notifications'
import {
  inferSovereignOfferType,
  type SovereignOfferType,
} from '@/lib/outbound-copy'
import { agencyTargetCount, directFallbackTargetCount } from '@/lib/xavira-gtm-motion'

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

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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
       AND (
         source IN (
           'google_sheet_import',
           'open_lead_graph',
           'owned_open_lead_graph',
           'google_maps_apify',
           'apify_google_maps',
           'hunter_domain_search',
           'public_search'
         )
         OR COALESCE(custom_fields->>'sheet_import', 'false') = 'true'
         OR COALESCE(custom_fields->>'lead_scout', 'false') = 'true'
         OR COALESCE(custom_fields->>'maps_import', 'false') = 'true'
         OR COALESCE(custom_fields->>'hunter_domain_search', 'false') = 'true'
         OR COALESCE(custom_fields->>'public_search', 'false') = 'true'
       )
     ORDER BY created_at ASC
     LIMIT 500`,
    [clientId]
  )

  return result.rows
}

function offerTypeForResearchContact(contact?: ProspectResearchContact): SovereignOfferType {
  if (!contact) return 'direct'

  return inferSovereignOfferType({
    company: contact.company,
    companyDomain: contact.company_domain,
    title: contact.title,
    source: contact.source,
    customFields: contact.custom_fields,
  })
}

function sortResearchDecisions(decisions: ProspectResearchDecision[]) {
  return [...decisions].sort((a, b) => b.score - a.score || a.email.localeCompare(b.email))
}

function balanceResearchApprovalCandidates(
  decisions: ProspectResearchDecision[],
  contactById: Map<number, ProspectResearchContact>,
  limit: number
) {
  const approved = sortResearchDecisions(decisions.filter((decision) => decision.approved))
  const agency = approved.filter(
    (decision) => offerTypeForResearchContact(contactById.get(decision.id)) === 'agency'
  )
  const direct = approved.filter(
    (decision) => offerTypeForResearchContact(contactById.get(decision.id)) === 'direct'
  )
  const targetAgency = agencyTargetCount(limit)
  const targetDirect = directFallbackTargetCount(limit)
  const candidates: ProspectResearchDecision[] = []

  candidates.push(...agency.slice(0, targetAgency))
  candidates.push(...direct.slice(0, targetDirect))

  const selectedIds = new Set(candidates.map((candidate) => candidate.id))
  const remainingSlots = Math.max(0, limit - candidates.length)
  const remainder = approved
    .filter((decision) => !selectedIds.has(decision.id))
    .slice(0, remainingSlots)
  candidates.push(...remainder)

  const agencySelected = candidates.filter(
    (decision) => offerTypeForResearchContact(contactById.get(decision.id)) === 'agency'
  ).length
  const directSelected = candidates.length - agencySelected

  return {
    candidates,
    agencyReady: agency.length,
    directReady: direct.length,
    agencySelected,
    directSelected,
    agencyShortfall: Math.max(0, targetAgency - agency.length),
    directShortfall: Math.max(0, targetDirect - direct.length),
    mixPolicy: 'agency_first_fill_best_available' as const,
  }
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
  const evidenceFetchLimit = Math.max(
    0,
    Math.min(
      Number((body as any).evidenceFetchLimit ?? request.nextUrl.searchParams.get('evidenceFetchLimit') ?? 40) ||
        40,
      100
    )
  )
  let evidenceFetches = 0
  let evidenceMatches = 0
  const enrichedPool: ProspectResearchContact[] = []

  for (const contact of pool) {
    if (prospectNeedsExactPublicEmailEvidence(contact) && evidenceFetches < evidenceFetchLimit) {
      evidenceFetches += 1
      const result = await enrichProspectWithPublicEmailEvidence(contact)
      if (result.matched) evidenceMatches += 1
      enrichedPool.push(result.contact)
    } else {
      enrichedPool.push(contact)
    }
  }

  const contactById = new Map(enrichedPool.map((contact) => [Number(contact.id), contact]))
  const decisions = enrichedPool.map((contact) =>
    scoreProspectForResearchApproval(contact, { threshold })
  )
  const approvalMix = balanceResearchApprovalCandidates(decisions, contactById, limit)
  const approvedCandidates = approvalMix.candidates
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
      evidenceFetches,
      evidenceMatches,
      approvalReady: approvedCandidates.length,
      approvalMix,
      candidates: approvedCandidates,
      blocked,
      guardrails: [
        'Approves business inboxes only',
        'Requires source quality, domain fit, and provider-safe evidence',
        'Enforces agency-first approval balance with direct prospects as fallback',
        'Requires email and company domain alignment',
        'Blocks personal, support, legal, security, bounced, and unsubscribed contacts',
        'Approval does not send email; cron queues approved contacts separately',
      ],
    })
  }

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
      [clientId, JSON.stringify(reviewRecords)]
    )
  }

  const candidateIds = approvedCandidates.map((candidate) => candidate.id)
  if (candidateIds.length === 0) {
    return NextResponse.json({
      ok: true,
      dryRun: false,
      clientId,
      approved: 0,
      scanned: decisions.length,
      evidenceFetches,
      evidenceMatches,
      blocked,
      skipped: 'no_research_verified_prospects',
      approvalMix,
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
         'approval_batch', 'research_verified_agency_first_fill',
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
      clientId,
      candidateIds,
      JSON.stringify(
        approvedCandidates.map((candidate) => ({
          id: candidate.id,
          score: candidate.score,
          confidence: candidate.confidence,
          reasons: candidate.reasons,
          evidence_url: candidate.evidenceUrl,
          email_evidence: asString(contactById.get(candidate.id)?.custom_fields?.email_evidence),
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
    mode: 'research_verified_agency_first_fill',
  })

  return NextResponse.json({
    ok: true,
    dryRun: false,
    clientId,
    threshold,
    approved,
    scanned: decisions.length,
    evidenceFetches,
    evidenceMatches,
    approvalMix,
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
