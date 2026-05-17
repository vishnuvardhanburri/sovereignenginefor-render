import { NextRequest, NextResponse } from 'next/server'
import { appEnv } from '@/lib/env'
import { query } from '@/lib/db'

const VALIDATION_REQUIRED_PREFIXES = [
  'business',
  'contact',
  'hello',
  'hi',
  'info',
  'mail',
  'marketing',
  'team',
]

function authorize(request: NextRequest): boolean {
  const expected = appEnv.cronSecret()
  const provided =
    request.headers.get('x-cron-secret') ||
    request.nextUrl.searchParams.get('secret') ||
    ''
  return Boolean(expected && provided && provided === expected)
}

export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  try {
    const clientId = Number(request.nextUrl.searchParams.get('client_id') || 1)
    const result = await query(
      `UPDATE contacts
       SET custom_fields = COALESCE(custom_fields, '{}'::jsonb)
         || jsonb_build_object(
           'send_status', 'not_approved',
           'approval_required', true,
           'approval_revoked_at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'approval_revoked_reason', 'generic_inbox_requires_email_validation'
         ),
         updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1
         AND COALESCE(custom_fields->>'send_status', 'not_approved') = 'approved'
         AND COALESCE(verification_status, 'pending') <> 'valid'
         AND split_part(lower(email), '@', 1) = ANY($2::text[])`,
      [clientId, VALIDATION_REQUIRED_PREFIXES]
    )

    return NextResponse.json({
      ok: true,
      clientId,
      revoked: result.rowCount ?? 0,
      policy: 'generic_inbox_requires_email_validation',
    })
  } catch (error) {
    console.error('[API] Research approval cleanup failed', error)
    return NextResponse.json(
      { ok: false, error: 'failed' },
      { status: 500 }
    )
  }
}
