import { NextRequest, NextResponse } from 'next/server'
import { listDomains, recalculateDomainHealth } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'
import { appEnv } from '@/lib/env'
import { getQueueLength } from '@/lib/redis'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const clientId = await resolveClientId({
      searchParams,
      headers: request.headers,
    })
    const domainId = Number(searchParams.get('domain_id') ?? 0) || undefined

    if (domainId) {
      const domain = await recalculateDomainHealth(clientId, domainId)
      if (!domain) {
        return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
      }
      return NextResponse.json(domain)
    }

    const [domains, queueDepth] = await Promise.all([
      listDomains(clientId),
      getQueueLength(),
    ])

    return NextResponse.json({
      client_id: clientId,
      queue_depth: queueDepth,
      integrations: {
        resend: Boolean(process.env.RESEND_API_KEY),
        redis: Boolean(process.env.REDIS_URL),
        postgres: Boolean(process.env.DATABASE_URL),
        zerobounce: Boolean(appEnv.zeroBounceApiKey()),
        hunter: Boolean(appEnv.hunterApiKey()),
        telegram: Boolean(appEnv.telegramBotToken()),
      },
      domains,
    })
  } catch (error) {
    console.error('[API] Failed to get health', error)
    return NextResponse.json({ error: 'Failed to get health' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const clientId = await resolveClientId({
      body,
      headers: request.headers,
    })

    if (!body.domain_id) {
      return NextResponse.json({ error: 'domain_id is required' }, { status: 400 })
    }

    const domain = await recalculateDomainHealth(clientId, Number(body.domain_id))
    if (!domain) {
      return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
    }

    return NextResponse.json(domain)
  } catch (error) {
    console.error('[API] Failed to recalculate health', error)
    return NextResponse.json({ error: 'Failed to recalculate health' }, { status: 500 })
  }
}
