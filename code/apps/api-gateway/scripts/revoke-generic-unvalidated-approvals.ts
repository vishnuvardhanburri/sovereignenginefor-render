import { query } from '../lib/db'

const APPLY = process.argv.includes('--apply')

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

async function main() {
  const clientId = Number(process.env.DEFAULT_CLIENT_ID || 1)
  const preview = await query<{
    id: string
    email: string
    company: string | null
    verification_status: string | null
  }>(
    `SELECT id::text, email, company, verification_status
     FROM contacts
     WHERE client_id = $1
       AND COALESCE(custom_fields->>'send_status', 'not_approved') = 'approved'
       AND COALESCE(verification_status, 'pending') <> 'valid'
       AND split_part(lower(email), '@', 1) = ANY($2::text[])
     ORDER BY updated_at ASC, created_at ASC
     LIMIT 100`,
    [clientId, VALIDATION_REQUIRED_PREFIXES]
  )

  if (!APPLY) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: true,
          clientId,
          revokeReady: preview.rows.length,
          contacts: preview.rows,
        },
        null,
        2
      )
    )
    return
  }

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

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: false,
        clientId,
        revoked: result.rowCount ?? 0,
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error('revoke-generic-unvalidated-approvals failed', error)
  process.exit(1)
})
