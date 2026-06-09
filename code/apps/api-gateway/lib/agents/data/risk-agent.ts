import { query, queryOne } from '@/lib/db'
import { Domain } from '@/lib/db/types'
import { calculateDomainHealthPolicy } from '@sovereign/reputation-engine'

type DomainRecoveryRow = Domain & {
  daily_cap?: number | string | null
  paused?: boolean | null
}

type RecoveryTrickleOptions = {
  enabled: boolean
  cap: number
  minHealth: number
  maxBounceRate: number
}

function envFlag(name: string, fallback = false): boolean {
  const value = process.env[name]
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function envInteger(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name])
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(Math.trunc(parsed), max))
}

function hasOutboundValidationLayer(): boolean {
  return (
    envFlag('DAILY_OUTBOUND_ALLOW_OWNED_VALIDATION', envFlag('OWNED_VALIDATION_ENABLED', true)) ||
    Boolean(process.env.ZEROBOUNCE_API_KEY || process.env.HUNTER_API_KEY)
  )
}

function numeric(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export type DomainRiskDecision = 'pause' | 'cooldown' | 'normal'

export function assessDomainRisk(domain: Domain): DomainRiskDecision {
  if (!domain.spf_valid || !domain.dkim_valid || !domain.dmarc_valid) {
    return 'cooldown'
  }

  if (domain.bounce_rate > 12 || (domain.bounce_rate > 5 && domain.health_score < 30)) {
    return 'pause'
  }

  if (domain.health_score < 50) {
    return 'cooldown'
  }

  return 'normal'
}

export async function recalculateDomainHealth(
  clientId: number,
  domainId: number
): Promise<Domain | null> {
  const domain = await queryOne<Domain>(
    `SELECT *
     FROM domains
     WHERE client_id = $1 AND id = $2`,
    [clientId, domainId]
  )

  if (!domain) {
    return null
  }

  const policy = calculateDomainHealthPolicy({
    sentCount: domain.sent_count,
    bounceCount: domain.bounce_count,
    currentStatus: domain.status,
  })

  return queryOne<Domain>(
    `UPDATE domains
     SET bounce_rate = $3,
         health_score = $4,
         status = $5,
         updated_at = CURRENT_TIMESTAMP
     WHERE client_id = $1 AND id = $2
     RETURNING *`,
    [clientId, domainId, policy.rawBounceRate, policy.healthScore, policy.nextStatus]
  )
}

export function shouldEnableRecoveryTrickle(
  domain: DomainRecoveryRow,
  options: RecoveryTrickleOptions
): boolean {
  if (!options.enabled || options.cap <= 0) return false
  if (domain.paused) return false
  if (!['active', 'paused'].includes(domain.status)) return false
  if (numeric(domain.daily_cap) > 0) return false
  if (numeric(domain.health_score) < options.minHealth) return false
  if (numeric(domain.bounce_rate) > options.maxBounceRate) return false
  return true
}

export async function refreshDomainRiskLimits(clientId?: number) {
  const params: unknown[] = []
  let where = ''
  const hasValidationLayer = hasOutboundValidationLayer()
  const recoveryCapMax = hasValidationLayer ? 100 : 3
  const recoveryCap = envInteger(
    'DOMAIN_RECOVERY_DAILY_CAP',
    envInteger(
      'DAILY_OUTBOUND_RECOVERY_TRICKLE_LIMIT',
      hasValidationLayer ? 50 : 1,
      0,
      recoveryCapMax
    ),
    0,
    recoveryCapMax
  )
  const recoveryEnabled =
    recoveryCap > 0 &&
    envFlag(
      'DOMAIN_RECOVERY_CAP_ENABLED',
      envFlag('DAILY_OUTBOUND_RECOVERY_MODE', hasValidationLayer)
    )
  const recoveryMinHealth = envInteger('DOMAIN_RECOVERY_MIN_HEALTH', 30, 0, 100)
  const recoveryMaxBounceRate = envInteger('DOMAIN_RECOVERY_MAX_BOUNCE_RATE', 35, 0, 100)

  if (clientId) {
    params.push(clientId)
    where = 'WHERE client_id = $1'
  }

  const domains = await query<Domain>(
    `SELECT *
     FROM domains
     ${where}`,
    params
  )

  for (const domain of domains.rows) {
    const identityCountRow = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM identities
       WHERE client_id = $1
         AND domain_id = $2
         AND status = 'active'`,
      [domain.client_id, domain.id]
    )

    const identityCount = Math.max(Number(identityCountRow?.count ?? 0), 1)
    const warmupStage = Math.min(Math.max(Number(domain.warmup_stage ?? 1), 1), 7)
    const stageLimits = [20, 50, 100, 200, 400, 800, 1000]
    const warmupBudget = stageLimits[warmupStage - 1] ?? 20
    const perIdentityLimit = Math.min(500, warmupBudget)
    const domainLimit = Math.min(1000, identityCount * perIdentityLimit)

    await query(
      `UPDATE domains
       SET daily_limit = $3,
           warmup_stage = CASE
             WHEN status = 'warming' AND bounce_rate <= 2 THEN LEAST(warmup_stage + 1, 7)
             ELSE warmup_stage
           END,
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2`,
      [domain.client_id, domain.id, domainLimit]
    )

    const recalculated = (await recalculateDomainHealth(
      domain.client_id,
      domain.id
    )) as DomainRecoveryRow | null

    if (
      recalculated &&
      shouldEnableRecoveryTrickle(recalculated, {
        enabled: recoveryEnabled,
        cap: recoveryCap,
        minHealth: recoveryMinHealth,
        maxBounceRate: recoveryMaxBounceRate,
      })
    ) {
      await query(
        `UPDATE domains
         SET status = 'active',
             daily_cap = LEAST(daily_limit, $3),
             updated_at = CURRENT_TIMESTAMP
         WHERE client_id = $1
           AND id = $2
           AND paused = FALSE`,
        [domain.client_id, domain.id, recoveryCap]
      )
    }
  }

  return { domainsProcessed: domains.rowCount }
}
export interface RiskSignals {
  anomalyDetected: boolean
  reason: string
  suspiciousDomainCount: number
}

export async function detectRisk(clientId: number): Promise<RiskSignals> {
  const row = await queryOne<{
    average_bounce_rate: string
    average_health_score: string
    paused_domains: string
    recent_failed: string
  }>(
    `SELECT
       COALESCE(AVG(domains.bounce_rate)::text, '0') AS average_bounce_rate,
       COALESCE(AVG(domains.health_score)::text, '0') AS average_health_score,
       COALESCE(SUM(CASE WHEN domains.status = 'paused' THEN 1 ELSE 0 END)::text, '0') AS paused_domains,
       COALESCE(SUM(CASE WHEN events.event_type = 'failed' THEN 1 ELSE 0 END)::text, '0') AS recent_failed
     FROM domains
     LEFT JOIN events ON domains.client_id = events.client_id
     WHERE domains.client_id = $1`,
    [clientId]
  )

  const bounceRate = Number(row?.average_bounce_rate ?? '0')
  const healthScore = Number(row?.average_health_score ?? '0')
  const pausedDomains = Number(row?.paused_domains ?? '0')
  const recentFailed = Number(row?.recent_failed ?? '0')
  const anomalyDetected = bounceRate > 4 || healthScore < 60 || recentFailed > 20
  let reason = 'system is stable'

  if (bounceRate > 4) {
    reason = 'bounce rate is elevated'
  } else if (healthScore < 60) {
    reason = 'domain health is degrading'
  } else if (recentFailed > 20) {
    reason = 'delivery failures are increasing'
  }

  return {
    anomalyDetected,
    reason,
    suspiciousDomainCount: pausedDomains,
  }
}
