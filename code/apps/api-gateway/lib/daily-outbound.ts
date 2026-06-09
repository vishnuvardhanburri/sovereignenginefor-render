import type { SystemApprovalWindow } from './contact-approval-window'

export type DailyOutboundPlan = {
  enabled: boolean
  dryRun: boolean
  mode: DailyOutboundMode
  recoveryMode: boolean
  clientId: number
  sheetUrl: string
  sheetLimit: number
  mapsDatasetId: string
  mapsLimit: number
  publicSearchLimit: number
  leadScoutLimit: number
  approveLimit: number
  sendLimit: number
  researchUnlimited: boolean
  readyInventoryTarget: number
  runSheetImport: boolean
  runMapsImport: boolean
  runPublicSearch: boolean
  runLeadScout: boolean
  runResearchApproval: boolean
  runQueue: boolean
  guardrails: string[]
}

export type DailyVolumeBand = {
  minDailyVolume: number
  maxDailyVolume: number
}

export type DailyVolumeAdjustment = {
  sendLimit: number
  runQueue: boolean
  band: DailyVolumeBand
  sentToday: number
  remainingToMin: number
  remainingToMax: number
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
    mapsDatasetId?: string | null
    mapsLimit?: string | null
    mapsImport?: string | null
    publicSearch?: string | null
    publicSearchLimit?: string | null
    serpApi?: string | null
    serpApiLimit?: string | null
    leadScout?: string | null
    leadScoutLimit?: string | null
    approveLimit?: string | null
    researchApproveLimit?: string | null
    researchUnlimited?: string | null
    researchLimit?: string | null
    readyInventoryTarget?: string | null
    mapsResearchLimit?: string | null
    publicSearchResearchLimit?: string | null
    leadScoutResearchLimit?: string | null
    sendLimit?: string | null
    mode?: string | null
    recoveryMode?: string | null
  }
}

const DEFAULT_CLIENT_ID = 1
const DEFAULT_SHEET_LIMIT = 150
const DEFAULT_MAPS_LIMIT = 100
const DEFAULT_PUBLIC_SEARCH_LIMIT = 250
const DEFAULT_SEND_LIMIT = 1
const MAX_SHEET_LIMIT = 500
const MAX_MAPS_LIMIT = 500
const MAX_PUBLIC_SEARCH_LIMIT = 5_000
const DEFAULT_LEAD_SCOUT_LIMIT = 25
const MAX_LEAD_SCOUT_LIMIT = 1_000
const SMALL_MEMORY_MAX_MAPS_LIMIT = 60
const SMALL_MEMORY_MAX_PUBLIC_SEARCH_LIMIT = 120
const SMALL_MEMORY_MAX_LEAD_SCOUT_LIMIT = 120
const DEFAULT_RESEARCH_LIMIT = 250
const DEFAULT_SMALL_RESEARCH_LIMIT = 80
const DEFAULT_RESEARCH_MAPS_LIMIT = 50
const DEFAULT_SMALL_RESEARCH_MAPS_LIMIT = 10
const DEFAULT_READY_INVENTORY_TARGET = 800
const MAX_APPROVE_LIMIT = 1_000_000
const DEFAULT_GROWTH_APPROVAL_FLOOR = 1_000_000
const CONSERVATIVE_MAX_SEND_LIMIT = 5
const DEFAULT_GROWTH_MAX_SEND_LIMIT = 100
const ABSOLUTE_GROWTH_MAX_SEND_LIMIT = 800
const DEFAULT_MIN_DAILY_VOLUME = 125
const DEFAULT_MAX_DAILY_VOLUME = 199

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

function isSmallMemoryRuntime(env: EnvLike): boolean {
  const profile = String(env.WEB_MEMORY_PROFILE ?? '').trim().toLowerCase()
  if (profile) return profile === 'small' || profile === 'free'
  return resolveDailyBoolean(env.RENDER, false)
}

function memoryBudget(input: { env: EnvLike }) {
  if (!isSmallMemoryRuntime(input.env)) {
    return {
      mapsMax: MAX_MAPS_LIMIT,
      publicSearchMax: MAX_PUBLIC_SEARCH_LIMIT,
      leadScoutMax: MAX_LEAD_SCOUT_LIMIT,
      constrained: false,
    }
  }

  const profile = String(input.env.WEB_MEMORY_PROFILE ?? '').trim().toLowerCase()
  const isFreeProfile = profile === 'free' || resolveDailyBoolean(input.env.WEB_FREE_TIER_SAFE_MODE, false)
  const defaultMapsMax = isFreeProfile ? 5 : SMALL_MEMORY_MAX_MAPS_LIMIT
  const defaultPublicSearchMax = isFreeProfile ? 10 : SMALL_MEMORY_MAX_PUBLIC_SEARCH_LIMIT
  const defaultLeadScoutMax = isFreeProfile ? 15 : SMALL_MEMORY_MAX_LEAD_SCOUT_LIMIT

  return {
    mapsMax: clampInteger(
      input.env.DAILY_OUTBOUND_SMALL_MAX_MAPS_LIMIT,
      defaultMapsMax,
      0,
      MAX_MAPS_LIMIT
    ),
    publicSearchMax: clampInteger(
      input.env.DAILY_OUTBOUND_SMALL_MAX_PUBLIC_SEARCH_LIMIT,
      defaultPublicSearchMax,
      0,
      MAX_PUBLIC_SEARCH_LIMIT
    ),
    leadScoutMax: clampInteger(
      input.env.DAILY_OUTBOUND_SMALL_MAX_LEAD_SCOUT_LIMIT,
      defaultLeadScoutMax,
      1,
      MAX_LEAD_SCOUT_LIMIT
    ),
    constrained: true,
  }
}

function resolveResearchUnlimited(input: {
  query: PlanInput['query']
  env: EnvLike
}): boolean {
  return resolveDailyBoolean(
    input.query.researchUnlimited ?? input.env.DAILY_OUTBOUND_RESEARCH_UNLIMITED,
    false
  )
}

function resolveReadyInventoryTarget(input: {
  query: PlanInput['query']
  env: EnvLike
}): number {
  return clampInteger(
    input.query.readyInventoryTarget ??
      input.env.DAILY_OUTBOUND_READY_INVENTORY_TARGET ??
      input.env.DAILY_OUTBOUND_RESEARCH_READY_TARGET,
    DEFAULT_READY_INVENTORY_TARGET,
    1,
    MAX_APPROVE_LIMIT
  )
}

function resolveResearchSourceLimit(input: {
  researchUnlimited: boolean
  requestedLimit: number
  specificQuery?: string | null
  specificEnv?: string
  genericQuery?: string | null
  genericEnv?: string
  fallback: number
  max: number
}): number {
  if (!input.researchUnlimited) return input.requestedLimit

  const researchLimit = clampInteger(
    input.specificQuery ??
      input.specificEnv ??
      input.genericQuery ??
      input.genericEnv,
    input.fallback,
    0,
    input.max
  )

  return Math.max(input.requestedLimit, researchLimit)
}

function resolveResearchApproveLimit(input: {
  researchUnlimited: boolean
  baseApproveLimit: number
  requested?: string | null
  env: EnvLike
  readyInventoryTarget: number
  approvalWindow: SystemApprovalWindow
}): number {
  if (!input.researchUnlimited) return input.baseApproveLimit

  const researchApproveLimit = clampInteger(
    input.requested ?? input.env.DAILY_OUTBOUND_RESEARCH_APPROVE_LIMIT,
    input.readyInventoryTarget,
    1,
    MAX_APPROVE_LIMIT
  )

  return Math.max(
    input.baseApproveLimit,
    Math.min(researchApproveLimit, input.approvalWindow.limit, MAX_APPROVE_LIMIT)
  )
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

function resolveRecoveryMode(input: {
  requested?: string | null
  env: EnvLike
}): boolean {
  const hasValidationProvider = Boolean(input.env.ZEROBOUNCE_API_KEY || input.env.HUNTER_API_KEY)
  if (resolveDailyBoolean(input.env.DAILY_OUTBOUND_RECOVERY_FORCE_OFF, false)) return false
  if (String(input.requested ?? '').trim()) {
    return resolveDailyBoolean(input.requested, hasValidationProvider)
  }
  if (hasValidationProvider) return true
  return resolveDailyBoolean(
    input.env.DAILY_OUTBOUND_RECOVERY_MODE ?? input.env.DOMAIN_RECOVERY_CAP_ENABLED,
    false
  )
}

function resolveSendLimit(input: {
  requested: string | undefined | null
  env: EnvLike
  approvalWindow: SystemApprovalWindow
  guardrails: string[]
  mode: DailyOutboundMode
  recoveryMode: boolean
}): number {
  if (String(input.requested ?? '').trim() === '0') {
    input.guardrails.push('Send limit is 0; discovery and approval can run without queueing email')
    return 0
  }

  const envLimit = input.env.DAILY_OUTBOUND_SEND_LIMIT
  const growthMaxSendLimit = clampInteger(
    input.env.DAILY_OUTBOUND_GROWTH_MAX_SEND_LIMIT ||
      input.env.DAILY_OUTBOUND_PROVIDER_MAX_SEND_LIMIT,
    DEFAULT_GROWTH_MAX_SEND_LIMIT,
    1,
    ABSOLUTE_GROWTH_MAX_SEND_LIMIT
  )
  const maxSendLimit =
    input.mode === 'growth' ? growthMaxSendLimit : CONSERVATIVE_MAX_SEND_LIMIT
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
  const hasValidationProvider = Boolean(input.env.ZEROBOUNCE_API_KEY || input.env.HUNTER_API_KEY)
  const recoveryTrickleLimit = clampInteger(
    input.env.DAILY_OUTBOUND_RECOVERY_TRICKLE_LIMIT ||
      input.env.DOMAIN_RECOVERY_DAILY_CAP,
    hasValidationProvider ? 50 : 1,
    0,
    hasValidationProvider ? 100 : 3
  )
  const recoveryTrickleEnabled =
    input.recoveryMode &&
    recoveryTrickleLimit > 0 &&
    input.approvalWindow.activeDomains > 0

  if (input.approvalWindow.remainingCapacity <= 0) {
    input.guardrails.push('No remaining domain capacity; queueing is blocked')
    if (recoveryTrickleEnabled) {
      input.guardrails.push(
        `Recovery mode allows a verified-only recovery batch capped at ${recoveryTrickleLimit} sends`
      )
      return Math.min(baseLimit, recoveryTrickleLimit)
    }
    return 0
  }

  if (eligibleSenderIdentities <= 0 || senderRemainingCapacity <= 0) {
    input.guardrails.push(
      'No healthy sender identity is available; queueing is blocked until domain health recovers'
    )
    if (recoveryTrickleEnabled) {
      input.guardrails.push(
        `Recovery mode allows a verified-only recovery batch while sender health rebuilds, capped at ${recoveryTrickleLimit} sends`
      )
      return Math.min(baseLimit, recoveryTrickleLimit)
    }
    return 0
  }

  if (input.approvalWindow.averageHealthScore <= 30) {
    input.guardrails.push('Severe reputation health risk pauses daily queueing for recovery')
    if (recoveryTrickleEnabled) {
      input.guardrails.push(
        'Severe reputation recovery trickle is capped at verified-only sends'
      )
      return Math.min(baseLimit, recoveryTrickleLimit, Math.max(1, effectiveCapacity))
    }
    return 0
  }

  if (input.mode === 'growth') {
    input.guardrails.push(
      'Growth mode is enabled; volume still follows reputation health, validation, and domain capacity'
    )
    if (growthMaxSendLimit > DEFAULT_GROWTH_MAX_SEND_LIMIT) {
      input.guardrails.push(
        `Provider-backed growth ceiling is configured at ${growthMaxSendLimit}/day; queueing still requires verified contacts, healthy domains, and active sender capacity`
      )
    }

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

export function resolveDailyVolumeBand(input: {
  env: EnvLike
  query?: {
    minDailyVolume?: string | null
    maxDailyVolume?: string | null
  }
}): DailyVolumeBand {
  const minDailyVolume = clampInteger(
    input.query?.minDailyVolume ??
      input.env.DAILY_OUTBOUND_MIN_DAILY_VOLUME ??
      input.env.DAILY_OUTBOUND_DAILY_FLOOR,
    DEFAULT_MIN_DAILY_VOLUME,
    1,
    ABSOLUTE_GROWTH_MAX_SEND_LIMIT
  )
  const maxDailyVolume = clampInteger(
    input.query?.maxDailyVolume ??
      input.env.DAILY_OUTBOUND_MAX_DAILY_VOLUME ??
      input.env.DAILY_OUTBOUND_DAILY_CEILING,
    DEFAULT_MAX_DAILY_VOLUME,
    minDailyVolume,
    ABSOLUTE_GROWTH_MAX_SEND_LIMIT
  )

  return {
    minDailyVolume,
    maxDailyVolume,
  }
}

export function applyDailyVolumeBand(input: {
  plan: DailyOutboundPlan
  approvalWindow: SystemApprovalWindow
  sentToday: number
  env: EnvLike
  query?: {
    minDailyVolume?: string | null
    maxDailyVolume?: string | null
  }
}): DailyVolumeAdjustment {
  const band = resolveDailyVolumeBand({ env: input.env, query: input.query })
  const sentToday = Math.max(0, Math.trunc(input.sentToday))
  const remainingToMin = Math.max(0, band.minDailyVolume - sentToday)
  const remainingToMax = Math.max(0, band.maxDailyVolume - sentToday)
  const guardrails = [
    `Daily volume controller active: floor ${band.minDailyVolume}, ceiling ${band.maxDailyVolume}`,
  ]

  if (!input.plan.enabled || input.plan.dryRun || input.plan.sendLimit <= 0) {
    return {
      sendLimit: 0,
      runQueue: false,
      band,
      sentToday,
      remainingToMin,
      remainingToMax,
      guardrails,
    }
  }

  if (remainingToMax <= 0) {
    guardrails.push('Daily ceiling reached; queueing is stopped for today')
    return {
      sendLimit: 0,
      runQueue: false,
      band,
      sentToday,
      remainingToMin,
      remainingToMax,
      guardrails,
    }
  }

  const senderRemainingCapacity = Math.max(
    0,
    Math.trunc(
      input.approvalWindow.senderRemainingCapacity ?? input.approvalWindow.remainingCapacity
    )
  )
  const effectiveCapacity = Math.max(
    0,
    Math.min(Math.trunc(input.approvalWindow.remainingCapacity), senderRemainingCapacity)
  )
  const growthMaxSendLimit = clampInteger(
    input.env.DAILY_OUTBOUND_GROWTH_MAX_SEND_LIMIT ||
      input.env.DAILY_OUTBOUND_PROVIDER_MAX_SEND_LIMIT,
    DEFAULT_GROWTH_MAX_SEND_LIMIT,
    1,
    ABSOLUTE_GROWTH_MAX_SEND_LIMIT
  )
  const maxRunLimit = input.plan.mode === 'growth' ? growthMaxSendLimit : CONSERVATIVE_MAX_SEND_LIMIT
  const requestedLimit = Math.max(0, Math.trunc(input.plan.sendLimit))
  const catchUpLimit =
    remainingToMin > 0
      ? Math.max(requestedLimit, remainingToMin)
      : requestedLimit
  const sendLimit = Math.max(
    0,
    Math.min(catchUpLimit, remainingToMax, effectiveCapacity, maxRunLimit)
  )

  if (remainingToMin > 0 && sendLimit > requestedLimit) {
    guardrails.push(
      `Under daily floor by ${remainingToMin}; raising this cycle from ${requestedLimit} to ${sendLimit}`
    )
  }

  if (sendLimit <= 0) {
    guardrails.push('No safe sender/domain capacity remains for this cycle')
  }

  return {
    sendLimit,
    runQueue: sendLimit > 0,
    band,
    sentToday,
    remainingToMin,
    remainingToMax,
    guardrails,
  }
}

function resolveApproveLimit(input: {
  requested: string | undefined | null
  env: EnvLike
  approvalWindow: SystemApprovalWindow
  mode: DailyOutboundMode
}): number {
  const hasQueryOverride = String(input.requested ?? '').trim().length > 0
  const requested = input.requested ?? input.env.DAILY_OUTBOUND_APPROVE_LIMIT
  const baseLimit = clampInteger(
    requested,
    input.approvalWindow.limit,
    1,
    MAX_APPROVE_LIMIT
  )
  const growthFloor = clampInteger(
    input.env.DAILY_OUTBOUND_MIN_APPROVE_LIMIT,
    DEFAULT_GROWTH_APPROVAL_FLOOR,
    1,
    MAX_APPROVE_LIMIT
  )
  const floor = !hasQueryOverride && input.mode === 'growth' ? growthFloor : 1

  return Math.min(
    Math.max(baseLimit, floor),
    Math.max(1, input.approvalWindow.limit),
    MAX_APPROVE_LIMIT
  )
}

export function buildDailyOutboundPlan(input: PlanInput): DailyOutboundPlan {
  const enabled = resolveDailyBoolean(input.env.DAILY_OUTBOUND_ENABLED, true)
  const dryRun = resolveDailyBoolean(input.query.dryRun, false)
  const mode = resolveDailyMode({ requested: input.query.mode, env: input.env })
  const recoveryMode = resolveRecoveryMode({
    requested: input.query.recoveryMode,
    env: input.env,
  })
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
  const mapsDatasetId = String(
    input.query.mapsDatasetId ||
      input.env.APIFY_GOOGLE_MAPS_DATASET_ID ||
      input.env.GOOGLE_MAPS_DATASET_ID ||
      ''
  ).trim()
  const budget = memoryBudget({ env: input.env })
  const researchUnlimited = resolveResearchUnlimited({
    query: input.query,
    env: input.env,
  })
  const readyInventoryTarget = resolveReadyInventoryTarget({
    query: input.query,
    env: input.env,
  })
  const defaultResearchLimit = budget.constrained
    ? DEFAULT_SMALL_RESEARCH_LIMIT
    : DEFAULT_RESEARCH_LIMIT
  const baseMapsLimit = clampInteger(
    input.query.mapsLimit ?? input.env.GOOGLE_MAPS_DAILY_LIMIT,
    DEFAULT_MAPS_LIMIT,
    0,
    budget.mapsMax
  )
  const mapsLimit = resolveResearchSourceLimit({
    researchUnlimited,
    requestedLimit: baseMapsLimit,
    specificQuery: input.query.mapsResearchLimit,
    specificEnv: input.env.GOOGLE_MAPS_RESEARCH_LIMIT ?? input.env.DAILY_OUTBOUND_MAPS_RESEARCH_LIMIT,
    genericQuery: input.query.researchLimit,
    genericEnv: input.env.DAILY_OUTBOUND_RESEARCH_LIMIT,
    fallback: budget.constrained ? DEFAULT_SMALL_RESEARCH_MAPS_LIMIT : DEFAULT_RESEARCH_MAPS_LIMIT,
    max: budget.mapsMax,
  })
  const runMapsImport = resolveDailyBoolean(
    input.query.mapsImport ?? input.env.DAILY_OUTBOUND_RUN_MAPS,
    resolveDailyBoolean(
      input.env.GOOGLE_MAPS_SOURCE_ENABLED ?? input.env.GOOGLE_MAPS_SOURCE_ENABLE,
      false
    )
  )
  const basePublicSearchLimit = clampInteger(
    input.query.publicSearchLimit ??
      input.query.serpApiLimit ??
      input.env.PUBLIC_SEARCH_DAILY_LIMIT ??
      input.env.SERPAPI_DAILY_LIMIT,
    DEFAULT_PUBLIC_SEARCH_LIMIT,
    0,
    budget.publicSearchMax
  )
  const publicSearchLimit = resolveResearchSourceLimit({
    researchUnlimited,
    requestedLimit: basePublicSearchLimit,
    specificQuery: input.query.publicSearchResearchLimit,
    specificEnv:
      input.env.PUBLIC_SEARCH_RESEARCH_LIMIT ?? input.env.DAILY_OUTBOUND_PUBLIC_SEARCH_RESEARCH_LIMIT,
    genericQuery: input.query.researchLimit,
    genericEnv: input.env.DAILY_OUTBOUND_RESEARCH_LIMIT,
    fallback: defaultResearchLimit,
    max: budget.publicSearchMax,
  })
  const runPublicSearch = resolveDailyBoolean(
    input.query.publicSearch ?? input.query.serpApi ?? input.env.DAILY_OUTBOUND_RUN_PUBLIC_SEARCH,
    resolveDailyBoolean(input.env.PUBLIC_SEARCH_SOURCE_ENABLED, true)
  )
  const baseLeadScoutLimit = clampInteger(
    input.query.leadScoutLimit ?? input.env.LEAD_SCOUT_DAILY_LIMIT,
    DEFAULT_LEAD_SCOUT_LIMIT,
    1,
    budget.leadScoutMax
  )
  const leadScoutLimit = resolveResearchSourceLimit({
    researchUnlimited,
    requestedLimit: baseLeadScoutLimit,
    specificQuery: input.query.leadScoutResearchLimit,
    specificEnv: input.env.LEAD_SCOUT_RESEARCH_LIMIT ?? input.env.DAILY_OUTBOUND_LEAD_SCOUT_RESEARCH_LIMIT,
    genericQuery: input.query.researchLimit,
    genericEnv: input.env.DAILY_OUTBOUND_RESEARCH_LIMIT,
    fallback: defaultResearchLimit,
    max: budget.leadScoutMax,
  })
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
  if (runMapsImport && mapsLimit > 0) {
    guardrails.push(
      'Google Maps/Apify intake imports public business leads only after evidence filtering'
    )
  }
  if (runLeadScout) {
    guardrails.push(
      'Autonomous lead scout crawls public company pages and imports only proof-backed contacts'
    )
  }
  if (runPublicSearch && publicSearchLimit > 0) {
    guardrails.push(
      'Public search expands discovery through query/domain extraction, then evidence checks decide approval'
    )
  }
  if (budget.constrained) {
    guardrails.push(
      'Small/free-memory deployment batches discovery work so research cannot crash the web process'
    )
  }
  if (researchUnlimited) {
    guardrails.push(
      `Research inventory is decoupled from send limits; per-cycle safety caps apply until ready inventory reaches at least ${readyInventoryTarget}`
    )
    guardrails.push(
      'Research may use public sources and owned/authorized private sources; mail sending remains capped separately by domain health'
    )
  }
  const baseApproveLimit = resolveApproveLimit({
    requested: input.query.approveLimit,
    env: input.env,
    approvalWindow: input.approvalWindow,
    mode,
  })
  const approveLimit = resolveResearchApproveLimit({
    researchUnlimited,
    baseApproveLimit,
    requested: input.query.researchApproveLimit,
    env: input.env,
    readyInventoryTarget,
    approvalWindow: input.approvalWindow,
  })
  const sendLimit = resolveSendLimit({
    requested: input.query.sendLimit,
    env: input.env,
    approvalWindow: input.approvalWindow,
    guardrails,
    mode,
    recoveryMode,
  })

  if (!enabled) {
    return {
      enabled: false,
      dryRun,
      mode,
      recoveryMode,
      clientId,
      sheetUrl,
      sheetLimit,
      mapsDatasetId,
      mapsLimit,
      publicSearchLimit,
      leadScoutLimit,
      approveLimit,
      sendLimit: 0,
      researchUnlimited,
      readyInventoryTarget,
      runSheetImport: false,
      runMapsImport: false,
      runPublicSearch: false,
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
    recoveryMode,
    clientId,
    sheetUrl,
    sheetLimit,
    mapsDatasetId,
    mapsLimit,
    publicSearchLimit,
    leadScoutLimit,
    approveLimit,
    sendLimit,
    researchUnlimited,
    readyInventoryTarget,
    runSheetImport: Boolean(sheetUrl),
    runMapsImport: Boolean(
      runMapsImport && mapsLimit > 0 && (mapsDatasetId || input.env.APIFY_API_TOKEN)
    ),
    runPublicSearch: Boolean(runPublicSearch && publicSearchLimit > 0),
    runLeadScout,
    runResearchApproval: true,
    runQueue: !dryRun && sendLimit > 0,
    guardrails,
  }
}
