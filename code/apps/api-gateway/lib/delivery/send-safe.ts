import { query } from '@/lib/db'
import { createEvent, deferQueueJob, markQueueJobFailed, markQueueJobSkipped, type QueueExecutionContext, type SendIdentitySelection } from '@/lib/backend'
import { checkAndActOnDomainHealth } from '@/lib/infrastructure/domain-health'
import { notifyTelegramEvent } from '@/lib/telegram-notifications'

export type SafeSendDeps = {
  coordinatorSend: (req: {
    campaignId: string
    to: string
    from?: string
    subject: string
    html: string
    text: string
    metadata?: Record<string, any>
  }) => Promise<{ success: boolean; messageId?: string; inboxUsed?: string; domainUsed?: string; error?: string }>
  smtpSend: (req: {
    fromEmail: string
    toEmail: string
    cc?: string[]
    subject: string
    html: string
    text: string
    headers?: Record<string, string>
  }) => Promise<{ success: boolean; providerMessageId?: string | null; error?: string | null }>
}

export type SafeSendInput = {
  context: QueueExecutionContext
  selection: SendIdentitySelection
  message: { subject: string; html: string; text: string; unsubscribeUrl?: string; pattern_ids?: string[] }
  deps: SafeSendDeps
}

export type SafeSendResult =
  | { ok: true; action: 'sent'; providerMessageId: string | null }
  | { ok: true; action: 'skipped'; reason: string }
  | { ok: true; action: 'deferred'; reason: string; scheduledAt: Date }
  | { ok: false; action: 'failed'; error: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function hasReply(clientId: number, campaignId: number, contactId: number): Promise<boolean> {
  const res = await query(
    `SELECT 1
     FROM events
     WHERE client_id = $1
       AND campaign_id = $2
       AND contact_id = $3
       AND event_type = 'reply'
     LIMIT 1`,
    [clientId, campaignId, contactId]
  )
  return res.rows.length > 0
}

async function isSuppressed(clientId: number, email: string): Promise<boolean> {
  const res = await query(
    `SELECT 1 FROM suppression_list WHERE client_id = $1 AND email = $2 LIMIT 1`,
    [clientId, email.toLowerCase()]
  )
  return res.rows.length > 0
}

async function checkLimits(clientId: number, selection: SendIdentitySelection): Promise<{ ok: true } | { ok: false; reason: string; waitMs: number }> {
  const [identityRes, domainRes] = await Promise.all([
    query<{ daily_limit: number; sent_today: number; status: string }>(
      `SELECT daily_limit, sent_today, status FROM identities WHERE client_id = $1 AND id = $2`,
      [clientId, selection.identity.id]
    ),
    query<{ daily_limit: number; sent_today: number; status: string; paused_until: string | null; bounce_rate: number; spam_rate: number }>(
      `SELECT daily_limit, sent_today, status, paused_until, bounce_rate, spam_rate FROM domains WHERE client_id = $1 AND id = $2`,
      [clientId, selection.domain.id]
    ),
  ])

  const identity = identityRes.rows[0]
  const domain = domainRes.rows[0]
  if (!identity || !domain) {
    return { ok: false, reason: 'sender not found', waitMs: 60_000 }
  }

  if (identity.status !== 'active') {
    return { ok: false, reason: `identity ${identity.status}`, waitMs: 5 * 60_000 }
  }
  if (domain.status !== 'active') {
    // If paused_until exists, defer until then; else 1h.
    const until = domain.paused_until ? new Date(domain.paused_until).getTime() : Date.now() + 60 * 60_000
    return { ok: false, reason: `domain ${domain.status}`, waitMs: Math.max(60_000, until - Date.now()) }
  }

  if (identity.sent_today >= identity.daily_limit) {
    return { ok: false, reason: 'identity daily limit reached', waitMs: 60 * 60_000 }
  }
  if (domain.sent_today >= domain.daily_limit) {
    return { ok: false, reason: 'domain daily limit reached', waitMs: 60 * 60_000 }
  }

  return { ok: true }
}

export async function sendSafe(input: SafeSendInput): Promise<SafeSendResult> {
  const { context, selection, message, deps } = input
  const to = (context.job.recipient_email || context.contact.email || '').trim().toLowerCase()

  // Hard stop: reply already received.
  if (await hasReply(context.job.client_id, context.campaign.id, context.contact.id)) {
    await markQueueJobSkipped(context, 'reply received - stopping follow-ups')
    return { ok: true, action: 'skipped', reason: 'reply received' }
  }

  // Basic validation.
  if (!to || !EMAIL_RE.test(to)) {
    await markQueueJobSkipped(context, 'invalid email format')
    return { ok: true, action: 'skipped', reason: 'invalid email' }
  }

  // Suppression list check.
  if (await isSuppressed(context.job.client_id, to)) {
    await markQueueJobSkipped(context, 'suppressed email')
    return { ok: true, action: 'skipped', reason: 'suppressed' }
  }

  // Domain health gate: may auto-pause domain if bounce/spam thresholds exceeded.
  const alerts = await checkAndActOnDomainHealth(String(selection.domain.id))
  const paused = alerts.some((a) => a.severity === 'critical')
  if (paused) {
    const scheduledAt = new Date(Date.now() + 24 * 60 * 60_000)
    await deferQueueJob(context, scheduledAt, 'domain paused due to health (bounce/spam)')
    return { ok: true, action: 'deferred', reason: 'domain health pause', scheduledAt }
  }

  // Sender limits gate.
  const limits = await checkLimits(context.job.client_id, selection)
  if (!limits.ok) {
    const scheduledAt = new Date(Date.now() + limits.waitMs)
    await deferQueueJob(context, scheduledAt, limits.reason)
    return { ok: true, action: 'deferred', reason: limits.reason, scheduledAt }
  }

  // Record an explicit "queued" event_code for traceability (does not change existing analytics).
  // This makes every action observable even if later steps fail.
  await createEvent(context.job.client_id, {
    eventType: 'queued',
    campaignId: context.campaign.id,
    contactId: context.contact.id,
    identityId: selection.identity.id,
    domainId: selection.domain.id,
    queueJobId: context.job.id,
    metadata: {
      event_code: 'EMAIL_QUEUED',
      subject: message.subject,
      sequence_step: context.sequenceStep.step_index,
    },
  })

  const coordResult = await deps.coordinatorSend({
    campaignId: String(context.campaign.id),
    to,
    from: `Sovereign Engine <${selection.identity.email}>`,
    subject: message.subject,
    html: message.html,
    text: message.text,
    metadata: {
      queueJobId: String(context.job.id),
      contactId: String(context.contact.id),
      campaignId: String(context.campaign.id),
      sequenceId: context.campaign.sequence_id ? String(context.campaign.sequence_id) : undefined,
      unsubscribeUrl: message.unsubscribeUrl,
      pattern_ids: message.pattern_ids ?? [],
    },
  })

  if (!coordResult.success) {
    const error = coordResult.error || 'coordinator send failed'
    await markQueueJobFailed(context, error)
    void notifyTelegramEvent({
      type: 'email_failed',
      to,
      from: selection.identity.email,
      subject: message.subject,
      error,
      campaign: context.campaign.name,
    })
    return { ok: false, action: 'failed', error }
  }

  const smtpResult = await deps.smtpSend({
    fromEmail: `Sovereign Engine <${selection.identity.email}>`,
    toEmail: to,
    cc: context.job.cc_emails ?? undefined,
    subject: message.subject,
    html: message.html,
    text: message.text,
    headers: {
      'X-Campaign-Id': String(context.campaign.id),
      'X-Queue-Job-Id': String(context.job.id),
      'X-Coordinator-Inbox': coordResult.inboxUsed || 'unknown',
      'X-Coordinator-Domain': coordResult.domainUsed || 'unknown',
      ...(message.unsubscribeUrl ? { 'List-Unsubscribe': `<${message.unsubscribeUrl}>` } : {}),
    },
  })

  if (!smtpResult.success) {
    const error = smtpResult.error ?? 'smtp send failed'
    await markQueueJobFailed(context, error)
    void notifyTelegramEvent({
      type: 'email_failed',
      to,
      from: selection.identity.email,
      subject: message.subject,
      error,
      campaign: context.campaign.name,
    })
    return { ok: false, action: 'failed', error }
  }

  void notifyTelegramEvent({
    type: 'email_sent',
    to,
    from: selection.identity.email,
    subject: message.subject,
    providerMessageId: smtpResult.providerMessageId ?? null,
    campaign: context.campaign.name,
  })

  // Success path: caller should invoke markQueueJobCompleted (single source of truth for counters + 'sent' event).
  return { ok: true, action: 'sent', providerMessageId: smtpResult.providerMessageId ?? null }
}
