import { NextRequest, NextResponse } from 'next/server'
import { appEnv } from '@/lib/env'
import { notifyTelegramEvent, shouldNotifyTelegram } from '@/lib/telegram-notifications'

function authorized(request: NextRequest): boolean {
  const expected = appEnv.cronSecret()
  const provided =
    request.headers.get('x-cron-secret') ||
    request.nextUrl.searchParams.get('secret') ||
    ''
  return Boolean(expected && provided && provided === expected)
}

export async function GET(request: NextRequest) {
  try {
    if (!authorized(request)) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }

    const mode = request.nextUrl.searchParams.get('mode') || ''
    const enabled = {
      dailyOutbound: shouldNotifyTelegram('daily_outbound'),
      sent: shouldNotifyTelegram('email_sent'),
      failed: shouldNotifyTelegram('email_failed'),
      approvals: shouldNotifyTelegram('contacts_approved'),
      queue: shouldNotifyTelegram('queue_batch'),
      imports: shouldNotifyTelegram('lead_scout'),
    }
    const configured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)

    if (mode === 'ping') {
      const delivery = await notifyTelegramEvent({
        type: 'daily_outbound',
        dryRun: true,
        sentToday: 0,
        sent24h: 0,
        failed24h: 0,
        bounced24h: 0,
        replies24h: 0,
        replyRate24h: 0,
        queuedNow: 0,
        approvedReadyNow: 0,
        queuePending: 0,
        queueProcessing: 0,
        queueRetry: 0,
        queueFailed: 0,
        queueCompleted24h: 0,
        remainingToOperatingFloor: 125,
        nextAction: 'Telegram ping from Sovereign Engine is working.',
      })

      return NextResponse.json({
        ok: delivery.delivered,
        mode,
        telegram: delivery,
        configured,
        enabled,
      })
    }

    const clientId = Number(
      request.nextUrl.searchParams.get('client_id') ||
        process.env.DEFAULT_CLIENT_ID ||
        1
    )

    const { getOutboundTelegramDigest } = await import('@/lib/outbound-telegram-digest')
    const digest = await getOutboundTelegramDigest(clientId)

    const delivery = await notifyTelegramEvent({
      type: 'daily_outbound',
      dryRun: false,
      queued: digest.queuedNow,
      ...digest,
    })

    return NextResponse.json({
      ok: true,
      digest,
      telegram: delivery,
      configured,
      enabled,
    })
  } catch (error) {
    console.error('[telegram-test] failed', error)
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'telegram test failed',
    }, { status: 500 })
  }
}
