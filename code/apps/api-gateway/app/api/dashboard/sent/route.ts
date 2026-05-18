import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { resolveClientId } from '@/lib/client-context'

export async function GET(request: NextRequest) {
  try {
    const clientId = await resolveClientId({ headers: request.headers })
    const limit = Math.max(1, Math.min(Number(request.nextUrl.searchParams.get('limit') ?? 100), 500))

    const res = await query<{
      id: number
      event_type: string
      created_at: string
      campaign_id: number | null
      campaign_name: string | null
      queue_job_id: number | null
      provider_message_id: string | null
      to_email: string | null
      from_email: string | null
      subject: string | null
      error: string | null
      body_text: string | null
      body_html: string | null
    }>(
      `SELECT
         e.id,
         e.event_type,
         e.created_at::text AS created_at,
         e.campaign_id,
         c.name AS campaign_name,
         e.queue_job_id,
         e.provider_message_id,
         COALESCE(NULLIF(e.metadata->>'to_email',''), NULLIF(e.metadata->>'to',''), NULLIF(e.metadata->>'recipient',''), co.email) AS to_email,
         COALESCE(NULLIF(e.metadata->>'from_email',''), NULLIF(e.metadata->>'from',''), i.email) AS from_email,
         COALESCE(NULLIF(e.metadata->>'subject',''), NULLIF(e.metadata->>'email_subject','')) AS subject,
         COALESCE(NULLIF(e.metadata->>'error',''), NULLIF(e.metadata->>'reason','')) AS error,
         e.metadata->>'body_text' AS body_text,
         e.metadata->>'body_html' AS body_html
       FROM events e
       LEFT JOIN campaigns c ON c.id = e.campaign_id AND c.client_id = e.client_id
       LEFT JOIN contacts co ON co.id = e.contact_id AND co.client_id = e.client_id
       LEFT JOIN identities i ON i.id = e.identity_id AND i.client_id = e.client_id
       WHERE e.client_id = $1
         AND e.event_type IN ('sent','failed','bounce')
       ORDER BY e.created_at DESC
       LIMIT $2`,
      [clientId, limit]
    )

    return NextResponse.json({
      ok: true,
      items: res.rows.map((r) => ({
        id: Number(r.id),
        type: r.event_type,
        createdAt: r.created_at,
        campaignId: r.campaign_id ? Number(r.campaign_id) : null,
        campaignName: r.campaign_name ?? null,
        queueJobId: r.queue_job_id ? Number(r.queue_job_id) : null,
        providerMessageId: r.provider_message_id ?? null,
        toEmail: r.to_email ?? '',
        fromEmail: r.from_email ?? '',
        subject: r.subject ?? '',
        error: r.error ?? null,
        bodyText: r.body_text ?? '',
        bodyHtml: r.body_html ?? '',
      })),
    })
  } catch (error) {
    console.error('[api/dashboard/sent] failed', error)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const clientId = await resolveClientId({ headers: request.headers })
    const kind = String(request.nextUrl.searchParams.get('kind') ?? 'failed').trim().toLowerCase()

    if (kind === 'failed') {
      await query(
        `DELETE FROM events
         WHERE client_id = $1
           AND event_type IN ('failed','bounce')`,
        [clientId]
      )
      return NextResponse.json({ ok: true })
    }

    if (kind === 'test') {
      // Clear test runs based on the stable subject prefix used by send:test.
      await query(
        `DELETE FROM events
         WHERE client_id = $1
           AND event_type IN ('sent','failed','bounce')
           AND COALESCE(metadata->>'subject','') LIKE '[Sovereign Engine Test]%'`,
        [clientId]
      )
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ ok: false, error: 'invalid_kind' }, { status: 400 })
  } catch (error) {
    console.error('[api/dashboard/sent] delete failed', error)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}
