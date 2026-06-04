import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { resolveClientId } from '@/lib/client-context'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ReplayEvent = {
  id: string
  type: string
  title: string
  message: string
  severity: 'info' | 'warning' | 'critical'
  source: 'reputation' | 'delivery' | 'audit' | 'operator'
  createdAt: string
  metadata?: Record<string, unknown>
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function severityFrom(value?: string | null): ReplayEvent['severity'] {
  if (value === 'critical') return 'critical'
  if (value === 'warning' || value === 'failed' || value === 'bounce' || value === 'complaint') return 'warning'
  return 'info'
}

function sampleEvents(): ReplayEvent[] {
  const now = Date.now()
  return [
    {
      id: 'sample-rep-1',
      type: 'throttle',
      title: 'Gmail lane throttled',
      message: 'Reputation Brain reduced Gmail max_per_hour after deferrals crossed the safe window.',
      severity: 'warning',
      source: 'reputation',
      createdAt: new Date(now - 4 * 60_000).toISOString(),
    },
    {
      id: 'sample-audit-1',
      type: 'manual_override',
      title: 'Manual override recorded',
      message: 'Admin action was added to the tamper-evident audit chain.',
      severity: 'info',
      source: 'audit',
      createdAt: new Date(now - 12 * 60_000).toISOString(),
    },
    {
      id: 'sample-delivery-1',
      type: 'sent',
      title: 'Delivery pipeline active',
      message: 'Sender worker processed queued messages through the normal controller path.',
      severity: 'info',
      source: 'delivery',
      createdAt: new Date(now - 18 * 60_000).toISOString(),
    },
  ]
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? 80) || 80, 10), 250)
  const clientId = await resolveClientId({ searchParams, headers: request.headers }).catch(() => {
    const requested = Number(searchParams.get('client_id') || request.headers.get('x-client-id') || 1)
    return Number.isFinite(requested) && requested > 0 ? requested : 1
  })

  const [reputationRows, deliveryRows, auditRows, operationalRows] = await Promise.all([
    query<any>(
      `SELECT re.id, re.event_type, re.severity, re.message, re.provider, re.created_at, d.domain
       FROM reputation_events re
       LEFT JOIN domains d ON d.id = re.domain_id
       WHERE re.client_id = $1
       ORDER BY re.created_at DESC
       LIMIT $2`,
      [clientId, limit]
    ).catch(() => ({ rows: [] })),
    query<any>(
      `SELECT id, event_type, metadata, created_at
       FROM events
       WHERE client_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [clientId, limit]
    ).catch(() => ({ rows: [] })),
    query<any>(
      `SELECT id, action_type, resource_type, resource_id, details, timestamp_utc
       FROM audit_logs
       WHERE client_id = $1 OR client_id IS NULL
       ORDER BY timestamp_utc DESC
       LIMIT $2`,
      [clientId, limit]
    ).catch(() => ({ rows: [] })),
    query<any>(
      `SELECT id, event_type, aggregate_type, aggregate_id, payload, metadata, created_at
       FROM operational_events
       WHERE client_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [clientId, limit]
    ).catch(() => ({ rows: [] })),
  ])

  const reputation: ReplayEvent[] = reputationRows.rows.map((row: any) => ({
    id: `rep-${row.id}`,
    type: String(row.event_type),
    title: `${String(row.provider || 'provider').toUpperCase()} ${String(row.event_type).replace(/_/g, ' ')}`,
    message: String(row.message || 'Reputation event recorded.'),
    severity: severityFrom(row.severity),
    source: 'reputation',
    createdAt: new Date(row.created_at).toISOString(),
    metadata: { provider: row.provider, domain: row.domain },
  }))

  const delivery: ReplayEvent[] = deliveryRows.rows.map((row: any) => ({
    id: `delivery-${row.id}`,
    type: String(row.event_type),
    title: `Delivery ${String(row.event_type).replace(/_/g, ' ')}`,
    message: `Pipeline emitted a ${row.event_type} event.`,
    severity: severityFrom(row.event_type),
    source: 'delivery',
    createdAt: new Date(row.created_at).toISOString(),
    metadata: row.metadata ?? {},
  }))

  const audit: ReplayEvent[] = auditRows.rows.map((row: any) => ({
    id: `audit-${row.id}`,
    type: String(row.action_type),
    title: `Audit: ${String(row.action_type).replace(/_/g, ' ')}`,
    message: `${row.resource_type}/${row.resource_id} was recorded in the tamper-evident chain.`,
    severity: 'info',
    source: 'audit',
    createdAt: new Date(row.timestamp_utc).toISOString(),
    metadata: row.details ?? {},
  }))

  const operational: ReplayEvent[] = operationalRows.rows.map((row: any) => {
    const payload = (row.payload ?? {}) as Record<string, unknown>
    const company = textValue(payload.company)
    const commercialPath =
      textValue(payload.commercialPathLabel) || textValue(payload.commercialPath)
    const timeline = textValue(payload.timeline).replace(/_/g, ' ')
    const title =
      row.event_type === 'qualification_submitted'
        ? 'Qualification submitted'
        : `Operator: ${String(row.event_type).replace(/_/g, ' ')}`
    const message =
      row.event_type === 'qualification_submitted'
        ? `${company || 'Prospect'} requested ${commercialPath || 'a walkthrough'}${
            timeline ? ` on ${timeline}` : ''
          }.`
        : `${row.aggregate_type}/${row.aggregate_id} was recorded in operational events.`

    return {
      id: `operator-${row.id}`,
      type: String(row.event_type),
      title,
      message,
      severity: 'info',
      source: 'operator',
      createdAt: new Date(row.created_at).toISOString(),
      metadata: { payload, metadata: row.metadata ?? {} },
    }
  })

  const events = [...reputation, ...delivery, ...audit, ...operational]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)

  const timeline = events.length ? events : sampleEvents()

  return NextResponse.json({
    ok: true,
    clientId,
    generatedAt: new Date().toISOString(),
    summary: {
      total: timeline.length,
      reputation: timeline.filter((item) => item.source === 'reputation').length,
      delivery: timeline.filter((item) => item.source === 'delivery').length,
      audit: timeline.filter((item) => item.source === 'audit').length,
      operator: timeline.filter((item) => item.source === 'operator').length,
      usingSampleData: events.length === 0,
    },
    events: timeline,
  })
}
