import { NextRequest, NextResponse } from 'next/server'
import { appEnv } from '@/lib/env'
import { notifyTelegramEvent } from '@/lib/telegram-notifications'

function authorized(request: NextRequest): boolean {
  const expected = appEnv.cronSecret()
  const provided =
    request.headers.get('x-cron-secret') ||
    request.nextUrl.searchParams.get('secret') ||
    ''
  return Boolean(expected && provided && provided === expected)
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const delivery = await notifyTelegramEvent({
    type: 'queue_batch',
    queued: 0,
    source: 'telegram_test',
    queue: process.env.SEND_QUEUE ?? 'xv-send-queue',
  })

  return NextResponse.json({
    ok: true,
    telegram: delivery,
    configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  })
}
