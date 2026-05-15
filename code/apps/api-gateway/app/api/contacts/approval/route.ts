import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { resolveClientId } from '@/lib/client-context'

const FALLBACK_REVIEW_WINDOW = 5
const SYSTEM_APPROVAL_CEILING = Math.max(
  1,
  Math.min(Number(process.env.CONTACT_APPROVAL_MAX_WINDOW ?? 50), 250)
)

function parseIds(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((id) => Number(id))
    .filter((id) => Number.isSafeInteger(id) && id > 0)
}

async function resolveSystemApprovalWindow(clientId: number) {
  const row = await query<{
    active_domains: string
    remaining_capacity: string
    average_health_score: string
  }>(
    `SELECT
       COUNT(*)::text AS active_domains,
       COALESCE(SUM(GREATEST(COALESCE(daily_cap, daily_limit) - sent_today, 0)), 0)::text AS remaining_capacity,
       COALESCE(AVG(health_score), 100)::text AS average_health_score
     FROM domains
     WHERE client_id = $1
       AND status = 'active'
       AND paused = false`,
    [clientId]
  )

  const signal = row.rows[0]
  const activeDomains = Number(signal?.active_domains ?? 0)
  const remainingCapacity = Number(signal?.remaining_capacity ?? 0)
  const averageHealthScore = Number(signal?.average_health_score ?? 100)

  if (activeDomains === 0 || remainingCapacity <= 0) {
    return {
      limit: FALLBACK_REVIEW_WINDOW,
      activeDomains,
      remainingCapacity,
      averageHealthScore,
      policy: 'fallback_review_window',
    }
  }

  const reviewPercent = averageHealthScore >= 90 ? 0.2 : averageHealthScore >= 75 ? 0.1 : 0.05
  const computed = Math.floor(remainingCapacity * reviewPercent)
  const limit = Math.max(1, Math.min(SYSTEM_APPROVAL_CEILING, Math.max(FALLBACK_REVIEW_WINDOW, computed)))

  return {
    limit,
    activeDomains,
    remainingCapacity,
    averageHealthScore,
    policy: 'domain_capacity_health_window',
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const clientId = await resolveClientId({
      body,
      headers: request.headers,
      searchParams: request.nextUrl.searchParams,
    })
    const ids = parseIds(body.ids)
    const approvalWindow = await resolveSystemApprovalWindow(clientId)

    if (ids.length > 0) {
      const result = await query(
        `UPDATE contacts
         SET custom_fields = COALESCE(custom_fields, '{}'::jsonb)
           || jsonb_build_object(
             'send_status', 'approved',
             'approval_required', false,
             'approved_at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             'approved_by', 'operator',
             'auto_approval_eligible', true,
             'email_evidence', 'operator_selected'
           ),
           updated_at = CURRENT_TIMESTAMP
         WHERE client_id = $1
           AND id = ANY($2::bigint[])
           AND status = 'active'
           AND bounced_at IS NULL
           AND unsubscribed_at IS NULL
         RETURNING id, email, company, custom_fields`,
        [clientId, ids]
      )

      return NextResponse.json({
        ok: true,
        mode: 'selected',
        approved: result.rowCount ?? result.rows.length,
        systemApprovalWindow: approvalWindow,
        contacts: result.rows,
      })
    }

    const candidates = await query<{ id: string }>(
      `SELECT id
       FROM contacts
       WHERE client_id = $1
         AND status = 'active'
         AND bounced_at IS NULL
         AND unsubscribed_at IS NULL
         AND COALESCE(custom_fields->>'send_status', 'not_approved') <> 'approved'
         AND COALESCE(custom_fields->>'lead_scout', 'false') = 'true'
         AND COALESCE(custom_fields->>'auto_approval_eligible', 'false') = 'true'
       ORDER BY
         COALESCE(NULLIF(custom_fields->>'fit_score', '')::int, 0) DESC,
         CASE COALESCE(custom_fields->>'confidence', '')
           WHEN 'high' THEN 3
           WHEN 'medium' THEN 2
           ELSE 1
       END DESC,
         created_at ASC
       LIMIT $2`,
      [clientId, approvalWindow.limit]
    )

    const candidateIds = candidates.rows.map((row) => Number(row.id))
    if (candidateIds.length === 0) {
      return NextResponse.json({
        ok: true,
        mode: 'safest',
        approved: 0,
        systemApprovalWindow: approvalWindow,
        contacts: [],
        skipped: 'no_publicly_verified_prospects',
      })
    }

    const result = await query(
      `UPDATE contacts
       SET custom_fields = COALESCE(custom_fields, '{}'::jsonb)
         || jsonb_build_object(
           'send_status', 'approved',
           'approval_required', false,
           'approved_at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'approved_by', 'operator',
           'approval_batch', 'safest_lead_scout'
         ),
         updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1
         AND id = ANY($2::bigint[])
       RETURNING id, email, company, custom_fields`,
      [clientId, candidateIds]
    )

    return NextResponse.json({
      ok: true,
      mode: 'safest',
      approved: result.rowCount ?? result.rows.length,
      systemApprovalWindow: approvalWindow,
      contacts: result.rows,
    })
  } catch (error) {
    console.error('[API] Failed to approve prospects', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to approve prospects' },
      { status: 500 }
    )
  }
}
