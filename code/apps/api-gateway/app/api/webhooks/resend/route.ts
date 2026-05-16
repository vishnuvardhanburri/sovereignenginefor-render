import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { handleResendWebhook } from '@/lib/backend'
import { appEnv } from '@/lib/env'
import { notifyTelegramEvent } from '@/lib/telegram-notifications'

function firstString(value: unknown): string {
  if (Array.isArray(value)) return firstString(value[0])
  if (typeof value === 'string') return value
  return ''
}

export async function POST(request: NextRequest) {
  try {
    const resend = new Resend(appEnv.resendApiKey())
    const payload = await request.text()
    const webhookSecret = appEnv.resendWebhookSecret()

    const verified =
      webhookSecret
        ? resend.webhooks.verify({
            payload,
            headers: {
              id: request.headers.get('svix-id') ?? '',
              timestamp: request.headers.get('svix-timestamp') ?? '',
              signature: request.headers.get('svix-signature') ?? '',
            },
            webhookSecret,
          })
        : JSON.parse(payload)

    const externalId = request.headers.get('svix-id') ?? crypto.randomUUID()
    const result = await handleResendWebhook(
      verified as Record<string, unknown>,
      externalId
    )
    const event = verified as Record<string, unknown>
    const type = String(event.type ?? '')
    if (type === 'email.bounced' || type === 'email.failed' || type === 'email.complained') {
      const data = (event.data ?? {}) as Record<string, unknown>
      void notifyTelegramEvent({
        type: 'email_failed',
        to: firstString(data.to ?? data.email_to ?? data.recipient) || 'unknown',
        from: firstString(data.from ?? data.email_from) || null,
        subject: firstString(data.subject),
        error: type,
      })
    }

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('[API] Failed to process Resend webhook', error)
    return NextResponse.json({ error: 'Invalid webhook' }, { status: 400 })
  }
}
