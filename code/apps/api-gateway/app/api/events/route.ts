import { NextRequest, NextResponse } from 'next/server'
import { createEvent, listEvents } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'
import { ingestPatternFeedback } from '@/lib/learning/feedback'
import { demoEventsPayload, isDemoModeEnabled } from '@/lib/demo-mode'

type EventTypeFilter = 'queued' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'failed' | 'bounce' | 'reply' | 'complaint' | 'skipped' | 'retry' | 'unsubscribed'
type CreateEventBody = {
  type?: EventTypeFilter
  campaign_id?: string | number | null
  contact_id?: string | number | null
  identity_id?: string | number | null
  domain_id?: string | number | null
  queue_job_id?: string | number | null
  provider_message_id?: string | null
  metadata?: Record<string, unknown> | null
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams

    if (await isDemoModeEnabled()) {
      const page = Number(searchParams.get('page') ?? 1) || 1
      const limit = Number(searchParams.get('limit') ?? 50) || 50
      return NextResponse.json(await demoEventsPayload(page, limit))
    }

    const clientId = await resolveClientId({
      searchParams,
      headers: request.headers,
    })

    const events = await listEvents(clientId, {
      page: Number(searchParams.get('page') ?? 1),
      limit: Number(searchParams.get('limit') ?? 50),
      eventType: (searchParams.get('type') as EventTypeFilter | null) ?? undefined,
      campaignId: Number(searchParams.get('campaign_id') ?? 0) || undefined,
      identityId: Number(searchParams.get('identity_id') ?? 0) || undefined,
    })

    return NextResponse.json(events)
  } catch (error) {
    console.error('[API] Failed to list events', error)
    const searchParams = request.nextUrl.searchParams
    const page = Number(searchParams.get('page') ?? 1) || 1
    const limit = Number(searchParams.get('limit') ?? 50) || 50
    // Schema-compatible fallback (prevents blank UI states).
    return NextResponse.json({
      data: [],
      pagination: {
        page,
        limit,
        total: 0,
        totalPages: 0,
      },
      error: 'Failed to list events',
    })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateEventBody
    const clientId = await resolveClientId({
      body,
      headers: request.headers,
    })

    if (!body.type) {
      return NextResponse.json({ error: 'type is required' }, { status: 400 })
    }

    const event = await createEvent(clientId, {
      eventType: body.type,
      campaignId: body.campaign_id ? Number(body.campaign_id) : null,
      contactId: body.contact_id ? Number(body.contact_id) : null,
      identityId: body.identity_id ? Number(body.identity_id) : null,
      domainId: body.domain_id ? Number(body.domain_id) : null,
      queueJobId: body.queue_job_id ? Number(body.queue_job_id) : null,
      providerMessageId: body.provider_message_id ?? null,
      metadata: body.metadata ?? null,
    })

    // Deterministic pattern learning: update stats from open/reply/bounce signals.
    const meta = (body.metadata ?? {}) as Record<string, unknown>
    const rawIds = Array.isArray(meta.pattern_ids)
      ? (meta.pattern_ids as unknown[])
      : (typeof meta.pattern_id === 'string' ? [meta.pattern_id] : [])
    const patternIds = rawIds.flatMap((x) =>
      typeof x === 'string' && x.length > 0 ? [x] : []
    )

    if (patternIds.length > 0) {
      if (body.type === 'opened') {
        await ingestPatternFeedback({ eventType: 'EMAIL_OPENED', patternIds })
      } else if (body.type === 'reply') {
        await ingestPatternFeedback({ eventType: 'EMAIL_REPLIED', patternIds })
      } else if (body.type === 'bounce') {
        await ingestPatternFeedback({ eventType: 'EMAIL_BOUNCED', patternIds })
      }
    }

    return NextResponse.json(event, { status: 201 })
  } catch (error) {
    console.error('[API] Failed to create event', error)
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 })
  }
}
