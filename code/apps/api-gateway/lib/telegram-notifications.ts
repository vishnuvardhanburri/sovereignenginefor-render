import { appEnv } from '@/lib/env'
import { sendTelegramMessage } from '@/lib/telegram'

export type TelegramNotificationType =
  | 'email_sent'
  | 'email_failed'
  | 'sheet_import'
  | 'contacts_approved'
  | 'queue_batch'
  | 'queue_skipped'
  | 'daily_outbound'

type TelegramEnv = Record<string, string | undefined>

type TelegramNotification =
  | {
      type: 'email_sent'
      to: string
      from?: string | null
      subject?: string | null
      providerMessageId?: string | null
      campaign?: string | null
    }
  | {
      type: 'email_failed'
      to: string
      from?: string | null
      subject?: string | null
      error?: string | null
      campaign?: string | null
    }
  | {
      type: 'sheet_import'
      imported: number
      prepared: number
      rejected: number
      evidenceBacked: number
      sheetUrl?: string | null
    }
  | {
      type: 'contacts_approved'
      approved: number
      mode?: string | null
    }
  | {
      type: 'queue_batch'
      queued: number
      source?: string | null
      queue?: string | null
      limit?: number | null
    }
  | {
      type: 'queue_skipped'
      reason: string
      source?: string | null
    }
  | {
      type: 'daily_outbound'
      dryRun?: boolean
      imported?: number
      approved?: number
      queued?: number
      sendLimit?: number
      approveLimit?: number
      failures?: number
    }

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function clip(value: string | null | undefined, max = 240): string {
  const text = String(value ?? '').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}...`
}

export function maskEmail(email: string, showFull = false): string {
  const value = String(email || '').trim().toLowerCase()
  if (showFull || !value.includes('@')) return value

  const [name, domain] = value.split('@')
  if (!name || !domain) return value
  if (name.length <= 2) return `${name[0] ?? '*'}*@${domain}`
  return `${name[0]}***${name[name.length - 1]}@${domain}`
}

export function shouldNotifyTelegram(type: TelegramNotificationType, env: TelegramEnv = process.env): boolean {
  if (!envBool(env.TELEGRAM_NOTIFICATIONS_ENABLED, true)) return false

  const eventFlags: Record<TelegramNotificationType, string> = {
    email_sent: 'TELEGRAM_NOTIFY_SENT',
    email_failed: 'TELEGRAM_NOTIFY_FAILED',
    sheet_import: 'TELEGRAM_NOTIFY_IMPORTS',
    contacts_approved: 'TELEGRAM_NOTIFY_APPROVALS',
    queue_batch: 'TELEGRAM_NOTIFY_QUEUE',
    queue_skipped: 'TELEGRAM_NOTIFY_QUEUE',
    daily_outbound: 'TELEGRAM_NOTIFY_QUEUE',
  }

  return envBool(env[eventFlags[type]], true)
}

export function formatTelegramNotification(input: TelegramNotification, options?: { showFullEmails?: boolean }): string {
  const fullEmails = Boolean(options?.showFullEmails)

  if (input.type === 'email_sent') {
    return [
      'Sovereign Engine',
      'Email sent',
      `To: ${maskEmail(input.to, fullEmails)}`,
      input.from ? `From: ${maskEmail(input.from, fullEmails)}` : null,
      input.subject ? `Subject: ${clip(input.subject, 120)}` : null,
      input.providerMessageId ? `Provider ID: ${clip(input.providerMessageId, 80)}` : null,
      input.campaign ? `Campaign: ${clip(input.campaign, 80)}` : null,
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'email_failed') {
    return [
      'Sovereign Engine',
      'Email failed or bounced',
      `To: ${maskEmail(input.to, fullEmails)}`,
      input.from ? `From: ${maskEmail(input.from, fullEmails)}` : null,
      input.subject ? `Subject: ${clip(input.subject, 120)}` : null,
      input.error ? `Reason: ${clip(input.error, 200)}` : null,
      input.campaign ? `Campaign: ${clip(input.campaign, 80)}` : null,
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'sheet_import') {
    return [
      'Sovereign Engine',
      'Google Sheet import',
      `Imported: ${input.imported}`,
      `Prepared: ${input.prepared}`,
      `Evidence-backed: ${input.evidenceBacked}`,
      `Filtered: ${input.rejected}`,
      input.sheetUrl ? `Sheet: ${clip(input.sheetUrl, 160)}` : null,
      'Status: review required before sending',
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'contacts_approved') {
    return [
      'Sovereign Engine',
      'Prospects approved',
      `Approved: ${input.approved}`,
      input.mode ? `Mode: ${input.mode}` : null,
      'Next: outbound cron can queue approved contacts safely',
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'queue_batch') {
    return [
      'Sovereign Engine',
      'Outbound queue updated',
      `Queued: ${input.queued}`,
      input.source ? `Source: ${input.source}` : null,
      input.queue ? `Queue: ${input.queue}` : null,
      input.limit ? `Limit: ${input.limit}` : null,
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'daily_outbound') {
    return [
      'Sovereign Engine',
      input.dryRun ? 'Daily autopilot preview' : 'Daily autopilot run',
      `Imported: ${input.imported ?? 0}`,
      `Approved: ${input.approved ?? 0}`,
      `Queued: ${input.queued ?? 0}`,
      `Approval limit: ${input.approveLimit ?? 0}`,
      `Send limit: ${input.sendLimit ?? 0}`,
      `Stage failures: ${input.failures ?? 0}`,
    ].join('\n')
  }

  return [
    'Sovereign Engine',
    'Outbound queue skipped',
    `Reason: ${clip(input.reason, 160)}`,
    input.source ? `Source: ${input.source}` : null,
  ].filter(Boolean).join('\n')
}

export async function notifyTelegramEvent(input: TelegramNotification) {
  if (!shouldNotifyTelegram(input.type)) {
    return { delivered: false as const, reason: 'event disabled' as const }
  }

  const botToken = appEnv.telegramBotToken()
  const chatId = process.env.TELEGRAM_CHAT_ID || ''
  if (!botToken || !chatId) {
    return { delivered: false as const, reason: 'telegram not configured' as const }
  }

  try {
    return await sendTelegramMessage({
      botToken,
      chatId,
      text: formatTelegramNotification(input, {
        showFullEmails: envBool(process.env.TELEGRAM_FULL_EMAILS, false),
      }),
      parseMode: 'none',
    })
  } catch (error) {
    console.error('[telegram] notification failed', error)
    return { delivered: false as const, reason: 'telegram send failed' as const }
  }
}
