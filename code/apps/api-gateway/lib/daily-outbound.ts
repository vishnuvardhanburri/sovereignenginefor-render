import type { SystemApprovalWindow } from './contact-approval-window'

export type DailyOutboundPlan = {
  enabled: boolean
  dryRun: boolean
  clientId: number
  sheetUrl: string
  sheetLimit: number
  approveLimit: number
  sendLimit: number
  runSheetImport: boolean
  runResearchApproval: boolean
  runQueue: boolean
  guardrails: string[]
}

type EnvLike = Record<string, string | undefined>

type PlanInput = {
  approvalWindow: SystemApprovalWindow
  env: EnvLike
  query: {
    clientId?: string | null
    dryRun?: string | null
    sheetUrl?: string | null
    sheetLimit?: string | null
    approveLimit?: string | null
    sendLimit?: string | null
  }
}

const DEFAULT_CLIENT_ID = 1
const DEFAULT_SHEET_LIMIT = 150
const DEFAULT_SEND_LIMIT = 1
const MAX_SHEET_LIMIT = 500
const MAX_APPROVE_LIMIT = 25
const MAX_SEND_LIMIT = 5

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

function resolveSendLimit(input: {
  requested: string | undefined | null
  env: EnvLike
  approvalWindow: SystemApprovalWindow
  guardrails: string[]
}): number {
  const envLimit = input.env.DAILY_OUTBOUND_SEND_LIMIT
  const envMax = clampInteger(input.env.DAILY_OUTBOUND_MAX_SEND_LIMIT, MAX_SEND_LIMIT, 1, MAX_SEND_LIMIT)
  const requested = input.requested ?? envLimit
  const baseLimit = clampInteger(requested, DEFAULT_SEND_LIMIT, 1, envMax)

  if (input.approvalWindow.remainingCapacity <= 0) {
    input.guardrails.push('No remaining domain capacity; queueing is blocked')
    return 0
  }

  if (input.approvalWindow.averageHealthScore <= 60) {
    input.guardrails.push('Low reputation health caps daily queueing at 1 send')
    return Math.min(baseLimit, 1)
  }

  if (input.approvalWindow.averageHealthScore <= 75) {
    input.guardrails.push('Moderate reputation health caps daily queueing at 2 sends')
    return Math.min(baseLimit, 2)
  }

  if (input.approvalWindow.averageHealthScore <= 90) {
    input.guardrails.push('Healthy-but-watchful reputation caps daily queueing at 3 sends')
    return Math.min(baseLimit, 3)
  }

  return Math.min(baseLimit, input.approvalWindow.remainingCapacity)
}

export function buildDailyOutboundPlan(input: PlanInput): DailyOutboundPlan {
  const enabled = resolveDailyBoolean(input.env.DAILY_OUTBOUND_ENABLED, true)
  const dryRun = resolveDailyBoolean(input.query.dryRun, false)
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
  const guardrails = [
    'Approved contacts only are eligible for queueing',
    'Bounced, unsubscribed, suppressed, and unsafe inboxes stay blocked',
    'Generic inboxes require validation before auto-approval',
    'Daily queueing is capped by reputation health and domain capacity',
    'If Google Sheet intake fails, the system falls back to existing approved contacts',
  ]
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
  })

  if (!enabled) {
    return {
      enabled: false,
      dryRun,
      clientId,
      sheetUrl,
      sheetLimit,
      approveLimit,
      sendLimit: 0,
      runSheetImport: false,
      runResearchApproval: false,
      runQueue: false,
      guardrails,
    }
  }

  return {
    enabled,
    dryRun,
    clientId,
    sheetUrl,
    sheetLimit,
    approveLimit,
    sendLimit,
    runSheetImport: Boolean(sheetUrl),
    runResearchApproval: true,
    runQueue: !dryRun && sendLimit > 0,
    guardrails,
  }
}
