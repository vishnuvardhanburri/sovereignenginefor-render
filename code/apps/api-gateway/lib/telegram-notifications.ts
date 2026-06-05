import { appEnv } from '@/lib/env'
import { XAVIRA_COMMERCIAL_MODEL, formatGbp } from '@/lib/commercial-model'
import { sendTelegramMessage } from '@/lib/telegram'
import { SOVEREIGN_CLIENT_GENERATION_TARGET } from '@/lib/outbound-copy'

export type TelegramNotificationType =
  | 'email_sent'
  | 'email_failed'
  | 'lead_scout'
  | 'sheet_import'
  | 'maps_import'
  | 'hunter_domain_search'
  | 'contacts_approved'
  | 'queue_batch'
  | 'queue_skipped'
  | 'daily_outbound'
  | 'reputation_recovery'

type TelegramEnv = Record<string, string | undefined>

type TelegramNotification =
  | {
      type: 'email_sent'
      to: string
      from?: string | null
      subject?: string | null
      providerMessageId?: string | null
      provider?: string | null
      campaign?: string | null
    }
  | {
      type: 'email_failed'
      to: string
      from?: string | null
      subject?: string | null
      error?: string | null
      provider?: string | null
      campaign?: string | null
    }
  | {
      type: 'lead_scout'
      imported: number
      scanned: number
      evidenceBacked: number
      blockedUnverified: number
      industry?: string | null
      persona?: string | null
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
      type: 'maps_import'
      imported: number
      prepared: number
      rejected: number
      evidenceBacked: number
      datasetId?: string | null
      source?: string | null
      rejectionReasons?: Record<string, number> | null
    }
  | {
      type: 'hunter_domain_search'
      imported: number
      scanned: number
      rejected: number
      failures?: number | null
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
      estimatedPipelineValueUsd?: number | null
      agencyQueued?: number | null
      directQueued?: number | null
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
      estimatedPipelineValueUsd?: number
      agencyQueued?: number
      directQueued?: number
      sendLimit?: number
      approveLimit?: number
      failures?: number
      targetDailyVolume?: number
      capacityRemaining?: number
      healthyDomains?: number
      eligibleSenderIdentities?: number
      primaryBlocker?: string | null
      nextAction?: string | null
      topFailureReason?: string | null
      approvedReadyNow?: number
      approvedAgencyReadyNow?: number
      approvedDirectReadyNow?: number
      queuePending?: number
      queueProcessing?: number
      queueRetry?: number
      queueFailed?: number
      queueCompleted24h?: number
      agencySent24h?: number
      directSent24h?: number
      agencyReplies24h?: number
      directReplies24h?: number
      remainingToOperatingFloor?: number
      // Digest fields from getOutboundTelegramDigest
      sentToday?: number
      sent24h?: number
      failed24h?: number
      bounced24h?: number
      replies24h?: number
      replyRate24h?: number
      sent7d?: number
      replies7d?: number
      replyRate7d?: number
      followUpsDue?: number
      followUpsPending?: number
      followUpsSent24h?: number
      followUpsStopped24h?: number
      queuedNow?: number
      lastEvents?: Array<{
        type: 'sent' | 'failed' | 'bounced' | 'reply'
        email: string
        subject: string
        reason?: string
        ts: string
      }>
    }
  | {
      type: 'reputation_recovery'
      clientId: number
      paused: number
      domains: string[]
      reason: string
    }

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function envAnyTrue(env: TelegramEnv, flags: string[]): boolean {
  return flags.some((flag) => envBool(env[flag], false))
}

function stageEventEnabled(env: TelegramEnv, flags: string[]): boolean {
  if (envAnyTrue(env, flags)) return true

  const operatorReportOnly = envBool(env.TELEGRAM_OPERATOR_REPORT_ONLY, true)
  const debugStageNotifications = envBool(env.TELEGRAM_DEBUG_STAGE_NOTIFICATIONS, false)
  if (operatorReportOnly && !debugStageNotifications) return false

  return envBool(env.TELEGRAM_NOTIFY_STAGE_EVENTS, false)
}

function clip(value: string | null | undefined, max = 240): string {
  const text = String(value ?? '').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}...`
}

function percentBar(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
  const filled = Math.round(safe / 10)
  return `[${'#'.repeat(filled)}${'-'.repeat(10 - filled)}]`
}

function formatTopReasons(reasons?: Record<string, number> | null): string | null {
  const top = Object.entries(reasons ?? {})
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => `${reason}: ${count}`)

  return top.length ? `Top rejected: ${clip(top.join(', '), 120)}` : null
}

function cleanTelegramText(text: string): string {
  return text
    .replace(/━━━━━━━━━━━━━━━━━━━━━━━/g, '------------------------------')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[✅❌⚠️🛡️🚦🔌📋📤📥📦📄👥👤📧📝⚡🎯💰⚖️🔁❗🚧💡🔍🚫🌐🏢🛑⏸️]/g, '')
    .replace(/\*/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

  switch (type) {
    case 'email_sent':
      return envAnyTrue(env, ['TELEGRAM_NOTIFY_SENT_EVENTS', 'TELEGRAM_NOTIFY_SENT'])
    case 'email_failed':
      return envAnyTrue(env, ['TELEGRAM_NOTIFY_FAILED_EVENTS', 'TELEGRAM_NOTIFY_FAILED']) ||
        (!env.TELEGRAM_NOTIFY_FAILED_EVENTS && !env.TELEGRAM_NOTIFY_FAILED)
    case 'lead_scout':
    case 'sheet_import':
    case 'maps_import':
    case 'hunter_domain_search':
      return stageEventEnabled(env, ['TELEGRAM_NOTIFY_IMPORT_EVENTS', 'TELEGRAM_NOTIFY_IMPORTS'])
    case 'contacts_approved':
      return stageEventEnabled(env, ['TELEGRAM_NOTIFY_APPROVAL_EVENTS', 'TELEGRAM_NOTIFY_APPROVALS'])
    case 'queue_batch':
    case 'queue_skipped':
      return stageEventEnabled(env, ['TELEGRAM_NOTIFY_QUEUE_EVENTS', 'TELEGRAM_NOTIFY_QUEUE'])
    case 'daily_outbound':
    case 'reputation_recovery':
      return envBool(env.TELEGRAM_NOTIFY_QUEUE, true)
  }

  return false
}

export function formatTelegramNotification(input: TelegramNotification, options?: { showFullEmails?: boolean }): string {
  const fullEmails = Boolean(options?.showFullEmails)

  if (input.type === 'email_sent') {
    return [
      '✅ *Email Sent Successfully*',
      '━━━━━━━━━━━━━━━━━━━━━━━',
      `👤 *To:* ${maskEmail(input.to, fullEmails)}`,
      input.from ? `📧 *From:* ${maskEmail(input.from, fullEmails)}` : null,
      input.subject ? `📝 *Subject:* _${clip(input.subject, 120)}_` : null,
      input.provider ? `⚡ *Provider:* ${clip(input.provider, 40)}` : null,
      input.campaign ? `🎯 *Campaign:* ${clip(input.campaign, 80)}` : null,
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'email_failed') {
    return [
      '❌ *Email Delivery Failed*',
      '━━━━━━━━━━━━━━━━━━━━━━━',
      `👤 *To:* ${maskEmail(input.to, fullEmails)}`,
      input.from ? `📧 *From:* ${maskEmail(input.from, fullEmails)}` : null,
      input.subject ? `📝 *Subject:* _${clip(input.subject, 120)}_` : null,
      input.provider ? `⚡ *Provider:* ${clip(input.provider, 40)}` : null,
      input.error ? `⚠️ *Error:* \`${clip(input.error, 200)}\`` : null,
      input.campaign ? `🎯 *Campaign:* ${clip(input.campaign, 80)}` : null,
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'sheet_import') {
    return [
      '📥 *Google Sheet Imported*',
      '━━━━━━━━━━━━━━━━━━━━━━━',
      `👥 *Imported Leads:* *${input.imported}*`,
      `📋 *Prepared:* ${input.prepared}`,
      `🛡️ *Evidence-Backed:* *${input.evidenceBacked}*`,
      `🚫 *Filtered/Rejected:* ${input.rejected}`,
      input.sheetUrl ? `📄 *Sheet URL:* ${clip(input.sheetUrl, 160)}` : null,
      '━━━━━━━━━━━━━━━━━━━━━━━',
      '🚦 *Status:* Manual review required before sends trigger.',
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'maps_import') {
    return [
      '*Google Maps Lead Intake*',
      '------------------------------',
      `Imported: *${input.imported}*`,
      `Prepared: ${input.prepared}`,
      `Evidence-backed: *${input.evidenceBacked}*`,
      `Rejected: ${input.rejected}`,
      formatTopReasons(input.rejectionReasons),
      input.source ? `Source: ${clip(input.source, 80)}` : null,
      input.datasetId ? `Dataset: ${clip(input.datasetId, 80)}` : null,
      '------------------------------',
      'Status: Approvals and validation gate required before sending.',
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'lead_scout') {
    return [
      '*Autonomous Lead Scout*',
      '------------------------------',
      `Scanned prospects: ${input.scanned}`,
      `Evidence-backed: *${input.evidenceBacked}*`,
      `Imported: *${input.imported}*`,
      `Blocked unverified: ${input.blockedUnverified}`,
      input.industry ? `Industry: ${clip(input.industry, 60)}` : null,
      input.persona ? `Persona: ${clip(input.persona, 60)}` : null,
      '------------------------------',
      'Status: Exact public evidence required before approval.',
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'hunter_domain_search') {
    return [
      '🏹 *Hunter Domain Search*',
      '━━━━━━━━━━━━━━━━━━━━━━━',
      `🌐 *Domains Searched:* ${input.scanned}`,
      `👥 *Imported Leads:* *${input.imported}*`,
      `🚫 *Filtered/Rejected:* ${input.rejected}`,
      `⚠️ *Provider Failures:* ${input.failures ?? 0}`,
      '━━━━━━━━━━━━━━━━━━━━━━━',
      '🚦 *Status:* Hunter-sourced contacts still pass approval and reputation gates.',
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'contacts_approved') {
    return [
      '✅ *Prospects Approved*',
      '━━━━━━━━━━━━━━━━━━━━━━━',
      `👥 *Approved:* *${input.approved}*`,
      input.mode ? `⚙️ *Mode:* ${input.mode}` : null,
      '━━━━━━━━━━━━━━━━━━━━━━━',
      '🚦 *Next:* Outbound cron can queue approved contacts safely.',
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'queue_batch') {
    return [
      '⚡ *Outbound Queue Updated*',
      '━━━━━━━━━━━━━━━━━━━━━━━',
      `📤 *Queued:* *${input.queued}*`,
      input.source ? `🔌 *Source:* ${input.source}` : null,
      input.queue ? `📋 *Queue:* ${input.queue}` : null,
      input.limit ? `🎯 *Limit:* ${input.limit}` : null,
      input.estimatedPipelineValueUsd
        ? `Pipeline Value: *${formatGbp(input.estimatedPipelineValueUsd)}*`
        : null,
      input.agencyQueued || input.directQueued
        ? `⚖️ *Mix:* ${input.agencyQueued ?? 0} agency (${XAVIRA_COMMERCIAL_MODEL.whiteLabelCommercialLicense.label}) / ${input.directQueued ?? 0} direct (${XAVIRA_COMMERCIAL_MODEL.internalEnterpriseLicense.label})`
        : null,
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'daily_outbound') {
    const hasDigest =
      input.sentToday !== undefined ||
      input.sent24h !== undefined ||
      input.queuedNow !== undefined

    if (hasDigest) {
      const sent = input.sentToday ?? 0
      const sent24h = input.sent24h ?? sent
      const failed = input.failed24h ?? 0
      const bounced = input.bounced24h ?? 0
      const replies = input.replies24h ?? 0
      const rr = (input.replyRate24h ?? 0).toFixed(1)
      const queuedThisCycle = input.queued ?? 0
      const queuedNow = input.queuedNow ?? 0
      const readyNow = input.approvedReadyNow ?? 0
      const ableToSend = readyNow + queuedNow
      const agencySent24h = input.agencySent24h ?? input.agencyQueued ?? 0
      const directSent24h = input.directSent24h ?? input.directQueued ?? 0
      const agencyReady = input.approvedAgencyReadyNow ?? 0
      const directReady = input.approvedDirectReadyNow ?? 0
      const pipeline = input.estimatedPipelineValueUsd
      const fu_due = input.followUpsDue ?? 0
      const fu_pending = input.followUpsPending ?? 0
      const fu_sent = input.followUpsSent24h ?? 0
      const fu_stopped = input.followUpsStopped24h ?? 0
      const queuePending = input.queuePending ?? queuedNow
      const queueProcessing = input.queueProcessing ?? 0
      const queueRetry = input.queueRetry ?? 0
      const queueFailed = input.queueFailed ?? 0
      const completed24h = input.queueCompleted24h ?? 0
      const remainingToFloor = input.remainingToOperatingFloor ?? Math.max(
        0,
        SOVEREIGN_CLIENT_GENERATION_TARGET.operatingSendFloor - sent
      )
      const queueStatus =
        queueFailed > 0 ? 'attention' : queueRetry > 0 ? 'watch' : 'stable'
      const mixTotal = agencySent24h + directSent24h
      const agencyShare = mixTotal > 0 ? Math.round((agencySent24h / mixTotal) * 100) : 0
      const mixAction =
        mixTotal === 0
          ? 'Build both white-label and internal inventory.'
          : agencyShare < 45
            ? 'Prioritize agency / white-label buyers next cycle.'
            : agencyShare > 55
              ? 'Prioritize internal-license buyers next cycle.'
              : '50/50 offer mix is on track.'
      const blocker = input.primaryBlocker
      const topFailure = input.topFailureReason
      const computedNextAction =
        sent === 0 && queuedThisCycle > 0
          ? `${queuedThisCycle} queued this cycle. Sender worker is processing; check Sent Mail again in 30-60 seconds.`
          : input.nextAction

      const lastLines = (input.lastEvents ?? []).slice(0, 4).map((ev) => {
        const label = ev.type === 'sent' ? 'SENT' : ev.type === 'failed' ? 'FAILED' : ev.type === 'reply' ? 'REPLY' : 'BOUNCED'
        const reason = ev.reason ? ` (${clip(ev.reason, 55)})` : ''
        const who = ev.email ? `${maskEmail(ev.email, fullEmails)} ` : ''
        return `${label} ${who}${clip(ev.subject, 55)}${reason}`
      })

      const lines: (string | null)[] = [
        input.dryRun
          ? 'Sovereign Engine — Co-Founder Dry Run'
          : 'Sovereign Engine — Co-Founder Operator Report',
        '━━━━━━━━━━━━━━━━━━━━━━━',
        `Status: ${queueStatus.toUpperCase()} | Provider: resend | Delivery: ${failed} failed / ${bounced} bounced`,
        `Sent: ${sent} today / ${sent24h} in 24h | Range: ${SOVEREIGN_CLIENT_GENERATION_TARGET.operatingSendFloor}-${SOVEREIGN_CLIENT_GENERATION_TARGET.operatingSendCeiling}`,
        `Need for floor: ${remainingToFloor} more today | Able to send now: ${ableToSend}`,
        `Queue: ${queuePending} pending / ${queueProcessing} active / ${queueRetry} retry / ${queueFailed} failed / ${completed24h} completed 24h`,
        '━━━━━━━━━━━━━━━━━━━━━━━',
        `Client conversations: ${replies} replies / ${sent24h} sent = ${rr}% ${percentBar(input.replyRate24h ?? 0)}`,
        `Target: ${SOVEREIGN_CLIENT_GENERATION_TARGET.dailyQualifiedConversationsMin}-${SOVEREIGN_CLIENT_GENERATION_TARGET.dailyQualifiedConversationsMax} qualified conversations/day`,
        '━━━━━━━━━━━━━━━━━━━━━━━',
        `Offer mix 24h: ${agencySent24h} white-label ${XAVIRA_COMMERCIAL_MODEL.whiteLabelCommercialLicense.label} / ${directSent24h} internal ${XAVIRA_COMMERCIAL_MODEL.internalEnterpriseLicense.label}`,
        `Ready inventory: ${agencyReady} agency / ${directReady} direct`,
        `Mix action: ${mixAction}`,
        pipeline
          ? `Pipeline value: *${formatGbp(pipeline)}*`
          : null,
        '━━━━━━━━━━━━━━━━━━━━━━━',
        `Follow-ups: ${fu_due} due / ${fu_pending} pending / ${fu_sent} sent today / ${fu_stopped} stopped`,
        '━━━━━━━━━━━━━━━━━━━━━━━',
        topFailure ? `Top failure: ${clip(topFailure, 100)}` : null,
        blocker && blocker !== 'ready' ? `Blocker: ${clip(blocker, 100)}` : null,
        computedNextAction ? `Next action: ${clip(computedNextAction, 220)}` : null,
        lastLines.length ? `\nRecent proof:\n${lastLines.join('\n')}` : null,
      ]

      return lines.filter(Boolean).join('\n')
    }

    // Fallback — no digest data available yet
    return [
      '🚀 Sovereign Engine',
      input.dryRun ? 'Daily autopilot preview' : 'Daily autopilot run',
      `Imported: ${input.imported ?? 0}`,
      `Approved: ${input.approved ?? 0}`,
      `Queued: ${input.queued ?? 0}`,
      input.estimatedPipelineValueUsd
        ? `Pipeline value: ${formatGbp(input.estimatedPipelineValueUsd)}`
        : null,
      input.agencyQueued || input.directQueued
        ? `Mix: ${input.agencyQueued ?? 0} agency (${XAVIRA_COMMERCIAL_MODEL.whiteLabelCommercialLicense.label}) / ${input.directQueued ?? 0} direct (${XAVIRA_COMMERCIAL_MODEL.internalEnterpriseLicense.label})`
        : null,
      input.targetDailyVolume ? `Target/day: ${input.targetDailyVolume}` : null,
      input.primaryBlocker ? `Blocker: ${clip(input.primaryBlocker, 140)}` : null,
      `Stage failures: ${input.failures ?? 0}`,
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'reputation_recovery') {
    return [
      '🛡️ *Reputation Recovery Alert*',
      '━━━━━━━━━━━━━━━━━━━━━━━',
      `👤 *Client ID:* ${input.clientId}`,
      `⏸️ *Paused Domains:* ${input.paused}`,
      input.domains.length ? `🌐 *Domains:* ${clip(input.domains.join(', '), 180)}` : null,
      `⚠️ *Reason:* _${clip(input.reason, 160)}_`,
      '━━━━━━━━━━━━━━━━━━━━━━━',
      '🛑 *Status:* Sending paused until domain health recovers.',
    ].filter(Boolean).join('\n')
  }

  return [
    '⚠️ *Outbound Queue Skipped*',
    '━━━━━━━━━━━━━━━━━━━━━━━',
    `🔍 *Reason:* _${clip(input.reason, 160)}_`,
    input.source ? `🔌 *Source:* ${input.source}` : null,
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
      text: cleanTelegramText(formatTelegramNotification(input, {
        showFullEmails: envBool(process.env.TELEGRAM_FULL_EMAILS, false),
      })),
      parseMode: 'none',
    })
  } catch (error) {
    console.error('[telegram] notification failed', error)
    return { delivered: false as const, reason: 'telegram send failed' as const }
  }
}
