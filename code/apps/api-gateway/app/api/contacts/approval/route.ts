import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { resolveClientId } from '@/lib/client-context'
import { notifyTelegramEvent } from '@/lib/telegram-notifications'
import { resolveSystemApprovalWindow } from '@/lib/contact-approval-window'

function parseIds(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((id) => Number(id))
    .filter((id) => Number.isSafeInteger(id) && id > 0)
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
      const approved = result.rowCount ?? result.rows.length

      void notifyTelegramEvent({
        type: 'contacts_approved',
        approved,
        mode: 'selected',
      })

      return NextResponse.json({
        ok: true,
        mode: 'selected',
        approved,
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
    const approved = result.rowCount ?? result.rows.length

    void notifyTelegramEvent({
      type: 'contacts_approved',
      approved,
      mode: 'safest',
    })

    return NextResponse.json({
      ok: true,
      mode: 'safest',
      approved,
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
