import type { SystemApprovalWindow } from './contact-approval-window'

export type DailyOutboundPlan = {
  enabled: boolean
  dryRun: boolean
  mode: DailyOutboundMode
  clientId: number
  sheetUrl: string
  sheetLimit: number
  leadScoutLimit: number
  approveLimit: number
  sendLimit: number
  runSheetImport: boolean
  runLeadScout: boolean
  runResearchApproval: boolean
  runQueue: boolean
  guardrails: string[]
}

type EnvLike = Record<string, string | undefined>
type DailyOutboundMode = 'conservative' | 'growth'

type PlanInput = {
  approvalWindow: SystemApprovalWindow
  env: EnvLike
  query: {
    clientId?: string | null
    dryRun?: string | null
    sheetUrl?: string | null
    sheetLimit?: string | null
    leadScout?: string | null
    leadScoutLimit?: string | null
    approveLimit?: string | null
    sendLimit?: string | null
    mode?: string | null
  }
}

const DEFAULT_CLIENT_ID = 1
const DEFAULT_SHEET_LIMIT = 150
const DEFAULT_SEND_LIMIT = 1
const MAX_SHEET_LIMIT = 500
const DEFAULT_LEAD_SCOUT_LIMIT = 5
const MAX_LEAD_SCOUT_LIMIT = 10
const MAX_APPROVE_LIMIT = 25
const CONSERVATIVE_MAX_SEND_LIMIT = 5
const GROWTH_MAX_SEND_LIMIT = 50

export function resolveDailyBoolean(value: string | undefined | null, fallback: boolean): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(Math.trunc(parsed), max))
}

export function resolveDailySheetUrl(input: {
  querySheetUrl?: string | null
  env: EnvLike
}): string {
  return String(
    input.querySheetUrl ||
      input.env.DAILY_OUTBOUND_SHEET_URL ||
      input.env.GOOGLE_SHEET_URL ||
      input.env.SHEET_URL ||
      ''
  ).trim()
}

function resolveDailyMode(input: { requested?: string | null; env: EnvLike }): DailyOutboundMode {
  const value = String(input.requested ?? input.env.DAILY_OUTBOUND_MODE ?? '')
    .trim()
    .toLowerCase()
  return value === 'growth' ? 'growth' : 'conservative'
}

function resolveSendLimit(input: {
  requested: string | undefined | null
  env: EnvLike
  approvalWindow: SystemApprovalWindow
  guardrails: string[]
  mode: DailyOutboundMode
}): number {
  const envLimit = input.env.DAILY_OUTBOUND_SEND_LIMIT
  const maxSendLimit =
    input.mode === 'growth' ? GROWTH_MAX_SEND_LIMIT : CONSERVATIVE_MAX_SEND_LIMIT
  const envMax = clampInteger(
    input.env.DAILY_OUTBOUND_MAX_SEND_LIMIT,
    maxSendLimit,
    1,
    maxSendLimit
  )
  const requested = input.requested ?? envLimit
  const baseLimit = clampInteger(requested, DEFAULT_SEND_LIMIT, 1, envMax)
  const senderRemainingCapacity = Math.max(
    0,
    Math.trunc(
      input.approvalWindow.senderRemainingCapacity ?? input.approvalWindow.remainingCapacity
    )
  )
  const eligibleSenderIdentities =
    input.approvalWindow.eligibleSenderIdentities ??
    (senderRemainingCapacity > 0 ? 1 : 0)
  const effectiveCapacity = Math.min(input.approvalWindow.remainingCapacity, senderRemainingCapacity)

  if (input.approvalWindow.remainingCapacity <= 0) {
    input.guardrails.push('No remaining domain capacity; queueing is blocked')
    return 0
  }

  if (eligibleSenderIdentities <= 0 || senderRemainingCapacity <= 0) {
    input.guardrails.push(
      'No healthy sender identity is available; queueing is blocked until domain health recovers'
    )
    return 0
  }

  if (input.approvalWindow.averageHealthScore <= 30) {
    input.guardrails.push('Severe reputation health risk pauses daily queueing for recovery')
    return 0
  }

  if (input.mode === 'growth') {
    input.guardrails.push(
      'Growth mode is enabled; volume still follows reputation health, validation, and domain capacity'
    )

    if (input.approvalWindow.averageHealthScore <= 60) {
      input.guardrails.push('Growth mode low reputation health caps daily queueing at 5 sends')
      return Math.min(baseLimit, 5, effectiveCapacity)
    }

    if (input.approvalWindow.averageHealthScore <= 75) {
      input.guardrails.push('Growth mode moderate reputation health caps daily queueing at 15 sends')
      return Math.min(baseLimit, 15, effectiveCapacity)
    }

    if (input.approvalWindow.averageHealthScore <= 90) {
      input.guardrails.push('Growth mode healthy-watchful reputation caps daily queueing at 30 sends')
      return Math.min(baseLimit, 30, effectiveCapacity)
    }

    return Math.min(baseLimit, effectiveCapacity)
  }

  if (input.approvalWindow.averageHealthScore <= 60) {
    input.guardrails.push('Low reputation health caps daily queueing at 1 send')
    return Math.min(baseLimit, 1, effectiveCapacity)
  }

  if (input.approvalWindow.averageHealthScore <= 75) {
    input.guardrails.push('Moderate reputation health caps daily queueing at 2 sends')
    return Math.min(baseLimit, 2, effectiveCapacity)
  }

  if (input.approvalWindow.averageHealthScore <= 90) {
    input.guardrails.push('Healthy-but-watchful reputation caps daily queueing at 3 sends')
    return Math.min(baseLimit, 3, effectiveCapacity)
  }

  return Math.min(baseLimit, effectiveCapacity)
}

export function buildDailyOutboundPlan(input: PlanInput): DailyOutboundPlan {
  const enabled = resolveDailyBoolean(input.env.DAILY_OUTBOUND_ENABLED, true)
  const dryRun = resolveDailyBoolean(input.query.dryRun, false)
  const mode = resolveDailyMode({ requested: input.query.mode, env: input.env })
  const clientId = clampInteger(
    input.query.clientId ?? input.env.DEFAULT_CLIENT_ID,
    DEFAULT_CLIENT_ID,
    1,
    1_000_000
  )
  const sheetUrl = resolveDailySheetUrl({
    querySheetUrl: input.query.sheetUrl,
    env: input.env,
  })
  const sheetLimit = clampInteger(
    input.query.sheetLimit ?? input.env.DAILY_OUTBOUND_SHEET_LIMIT,
    DEFAULT_SHEET_LIMIT,
    1,
    MAX_SHEET_LIMIT
  )
  const leadScoutLimit = clampInteger(
    input.query.leadScoutLimit ?? input.env.LEAD_SCOUT_DAILY_LIMIT,
    DEFAULT_LEAD_SCOUT_LIMIT,
    1,
    MAX_LEAD_SCOUT_LIMIT
  )
  const runLeadScout = resolveDailyBoolean(
    input.query.leadScout ?? input.env.DAILY_OUTBOUND_RUN_LEAD_SCOUT,
    resolveDailyBoolean(input.env.LEAD_SCOUT_ENABLED, false)
  )
  const guardrails = [
    'Approved contacts only are eligible for queueing',
    'Bounced, unsubscribed, suppressed, and unsafe inboxes stay blocked',
    'Generic inboxes require validation before auto-approval',
    'Daily queueing is capped by reputation health and domain capacity',
    'If Google Sheet intake fails, the system falls back to existing approved contacts',
  ]
  if (runLeadScout) {
    guardrails.push(
      'Autonomous lead scout imports only exact public-contact evidence when enabled'
    )
  }
  const approveLimit = Math.min(
    clampInteger(
      input.query.approveLimit ?? input.env.DAILY_OUTBOUND_APPROVE_LIMIT,
      input.approvalWindow.limit,
      1,
      MAX_APPROVE_LIMIT
    ),
    Math.max(1, input.approvalWindow.limit)
  )
  const sendLimit = resolveSendLimit({
    requested: input.query.sendLimit,
    env: input.env,
    approvalWindow: input.approvalWindow,
    guardrails,
    mode,
  })

  if (!enabled) {
    return {
      enabled: false,
      dryRun,
      mode,
      clientId,
      sheetUrl,
      sheetLimit,
      leadScoutLimit,
      approveLimit,
      sendLimit: 0,
      runSheetImport: false,
      runLeadScout: false,
      runResearchApproval: false,
      runQueue: false,
      guardrails,
    }
  }

  return {
    enabled,
    dryRun,
    mode,
    clientId,
    sheetUrl,
    sheetLimit,
    leadScoutLimit,
    approveLimit,
    sendLimit,
    runSheetImport: Boolean(sheetUrl),
    runLeadScout,
    runResearchApproval: true,
    runQueue: !dryRun && sendLimit > 0,
    guardrails,
  }
}
