import { NextRequest, NextResponse } from 'next/server'
import {
  enqueueCampaignJobs,
  listQueueJobs,
  promoteReadyQueueJobs,
} from '@/lib/backend'
import { getQueueBreakdown, peekQueue } from '@/lib/redis'
import { resolveClientId } from '@/lib/client-context'
import { appEnv } from '@/lib/env'
import { Queue } from 'bullmq'

type QueueStatusFilter = 'pending' | 'processing' | 'retry' | 'completed' | 'failed' | 'skipped'
type QueueRequestBody = {
  campaign_id?: string | number
  contact_ids?: Array<string | number>
}

let bullSendQueue: Queue | null = null

function getBullSendQueue() {
  if (!bullSendQueue) {
    bullSendQueue = new Queue(process.env.SEND_QUEUE ?? 'xv-send-queue', {
      connection: { url: appEnv.redisUrl() },
    })
  }
  return bullSendQueue
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const clientId = await resolveClientId({
      searchParams,
      headers: request.headers,
    })
    const action = searchParams.get('action')

    if (action === 'peek') {
      const jobs = await peekQueue(Number(searchParams.get('count') ?? 10))
      return NextResponse.json({ jobs, count: jobs.length })
    }

    if (action === 'stats') {
      const breakdown = await getQueueBreakdown()
      return NextResponse.json({
        ...breakdown,
        timestamp: new Date().toISOString(),
      })
    }

    if (action === 'promote') {
      const promoted = await promoteReadyQueueJobs()
      return NextResponse.json({ promoted })
    }

    const jobs = await listQueueJobs(clientId, {
      page: Number(searchParams.get('page') ?? 1),
      limit: Number(searchParams.get('limit') ?? 50),
      status: (searchParams.get('status') as QueueStatusFilter | null) ?? undefined,
    })

    return NextResponse.json(jobs)
  } catch (error) {
    console.error('[API] Failed to list queue jobs', error)
    return NextResponse.json({ error: 'Failed to list queue jobs' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as QueueRequestBody
    const clientId = await resolveClientId({
      body,
      headers: request.headers,
    })

    if (!body.campaign_id) {
      return NextResponse.json(
        { error: 'campaign_id is required' },
        { status: 400 }
      )
    }

    const result = await enqueueCampaignJobs(
      clientId,
      Number(body.campaign_id),
      Array.isArray(body.contact_ids)
        ? body.contact_ids.map((value) => Number(value)).filter(Boolean)
        : undefined
    )

    return NextResponse.json({
      queued_jobs: result.jobs.length,
      contact_count: result.contactCount,
    })
  } catch (error) {
    console.error('[API] Failed to enqueue campaign', error)
    return NextResponse.json({ error: 'Failed to enqueue campaign' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const clientId = await resolveClientId({
      searchParams,
      headers: request.headers,
    })
    const status = String(searchParams.get('status') ?? 'failed').trim().toLowerCase()
    const limit = Math.max(1, Math.min(Number(searchParams.get('limit') ?? 100), 1000))

    if (status !== 'failed') {
      return NextResponse.json({ ok: false, error: 'unsupported_status' }, { status: 400 })
    }

    const queue = getBullSendQueue()
    const jobs = await queue.getJobs(['failed'], 0, limit - 1, true)
    let removed = 0
    let skipped = 0

    for (const job of jobs) {
      const jobClientId = Number(job.data?.clientId ?? job.data?.client_id ?? 0)
      if (jobClientId !== clientId) {
        skipped += 1
        continue
      }
      await job.remove()
      removed += 1
    }

    return NextResponse.json({
      ok: true,
      clientId,
      queue: process.env.SEND_QUEUE ?? 'xv-send-queue',
      status,
      removed,
      skipped,
    })
  } catch (error) {
    console.error('[API] Failed to clear queue jobs', error)
    return NextResponse.json({ ok: false, error: 'Failed to clear queue jobs' }, { status: 500 })
  }
}
