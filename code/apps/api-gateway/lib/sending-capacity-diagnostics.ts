import { query } from '@/lib/db'

type DomainCapacityRow = {
  id: string | number
  domain: string
  status: string
  paused: boolean | null
  spf_valid: boolean | null
  dkim_valid: boolean | null
  dmarc_valid: boolean | null
  daily_limit: string | number | null
  effective_daily_cap: string | number | null
  sent_today: string | number | null
  sent_count: string | number | null
  bounce_count: string | number | null
  capacity_sent_count: string | number | null
  capacity_bounce_count: string | number | null
  health_score: string | number | null
  computed_health_score: string | number | null
  raw_bounce_rate: string | number | null
  active_identity_count: string | number | null
  identity_remaining_capacity: string | number | null
}

export type DomainCapacityDiagnostic = {
  id: number
  domain: string
  status: string
  paused: boolean
  dnsReady: boolean
  healthScore: number
  computedHealthScore: number
  bounceRate: number
  sentToday: number
  effectiveDailyCap: number
  domainRemainingCapacity: number
  activeSenderIdentities: number
  identityRemainingCapacity: number
  effectiveRemainingCapacity: number
  eligibleForQueueing: boolean
  blockers: string[]
}

export type SendingCapacityDiagnosis = {
  clientId: number
  targetDailyVolume: number
  currentRemainingCapacity: number
  targetGap: number
  activeDomains: number
  healthyDomains: number
  eligibleSenderIdentities: number
  primaryBlocker: string
  nextAction: string
  scaleModel: {
    perIdentityDailyPlanningTarget: number
    identitiesNeededForTarget: number
    additionalHealthyIdentitiesNeeded: number
    domainsNeededAtFiveIdentitiesEach: number
  }
  guardrails: string[]
  domains: DomainCapacityDiagnostic[]
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name])
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(Math.trunc(parsed), max))
}

function unique(values: string[]) {
  return Array.from(new Set(values))
}

function capacityHealthWindowSql(): string {
  const raw = process.env.DOMAIN_CAPACITY_HEALTH_WINDOW ?? 'today'
  return raw.trim().toLowerCase() === '24h' ? "NOW() - INTERVAL '24 hours'" : 'CURRENT_DATE'
}

function diagnoseDomain(row: DomainCapacityRow): DomainCapacityDiagnostic {
  const activeSenderIdentities = Math.max(0, Math.trunc(toNumber(row.active_identity_count)))
  const sentToday = Math.max(0, Math.trunc(toNumber(row.sent_today)))
  const effectiveDailyCap = Math.max(0, Math.trunc(toNumber(row.effective_daily_cap)))
  const domainRemainingCapacity = Math.max(0, effectiveDailyCap - sentToday)
  const identityRemainingCapacity = Math.max(0, Math.trunc(toNumber(row.identity_remaining_capacity)))
  const effectiveRemainingCapacity = Math.min(domainRemainingCapacity, identityRemainingCapacity)
  const bounceRate = toNumber(row.raw_bounce_rate)
  const healthScore = toNumber(row.health_score)
  const computedHealthScore = toNumber(row.computed_health_score, healthScore)
  const dnsReady = Boolean(row.spf_valid && row.dkim_valid && row.dmarc_valid)
  const paused = Boolean(row.paused)
  const blockers: string[] = []
  const recoveryMaxBounceRate = envInt('DOMAIN_RECOVERY_MAX_BOUNCE_RATE', 35, 0, 100)
  const recoveryLaneEligible =
    effectiveDailyCap > 0 &&
    domainRemainingCapacity > 0 &&
    computedHealthScore >= 30 &&
    bounceRate <= recoveryMaxBounceRate

  if (row.status !== 'active') blockers.push(`domain_status_${row.status || 'unknown'}`)
  if (paused) blockers.push('operator_paused')
  if (activeSenderIdentities <= 0) blockers.push('no_active_sender_identity')
  if (effectiveDailyCap <= 0) blockers.push('domain_daily_cap_zero')
  if (domainRemainingCapacity <= 0) blockers.push('domain_daily_capacity_used')
  if (identityRemainingCapacity <= 0) blockers.push('identity_daily_capacity_used')
  if (computedHealthScore < 30) blockers.push('domain_health_below_recovery_floor')
  if (
    (toNumber(row.capacity_sent_count) >= 20 || toNumber(row.capacity_bounce_count) >= 3) &&
    bounceRate > 5
  ) {
    blockers.push(
      recoveryLaneEligible ? 'recovery_lane_bounce_pressure' : 'proven_bounce_pressure_gt_5_percent'
    )
  }
  if (!dnsReady) blockers.push('dns_authentication_incomplete')

  return {
    id: Math.trunc(toNumber(row.id)),
    domain: row.domain,
    status: row.status,
    paused,
    dnsReady,
    healthScore,
    computedHealthScore,
    bounceRate,
    sentToday,
    effectiveDailyCap,
    domainRemainingCapacity,
    activeSenderIdentities,
    identityRemainingCapacity,
    effectiveRemainingCapacity,
    eligibleForQueueing:
      row.status === 'active' &&
      !paused &&
      activeSenderIdentities > 0 &&
      effectiveRemainingCapacity > 0 &&
      computedHealthScore >= 30 &&
      !blockers.includes('proven_bounce_pressure_gt_5_percent'),
    blockers: unique(blockers),
  }
}

export function summarizeCapacityBlocker(domains: DomainCapacityDiagnostic[]): {
  primaryBlocker: string
  nextAction: string
} {
  if (domains.length === 0) {
    return {
      primaryBlocker: 'no_domains_configured',
      nextAction: 'Add verified sending domains and at least one active sender identity.',
    }
  }

  const eligible = domains.filter((domain) => domain.eligibleForQueueing)
  if (eligible.some((domain) => domain.effectiveRemainingCapacity > 0)) {
    return {
      primaryBlocker: 'ready',
      nextAction: 'Run daily outbound; queueing can proceed inside current safe capacity.',
    }
  }

  const allBlockers = unique(domains.flatMap((domain) => domain.blockers))
  if (allBlockers.includes('proven_bounce_pressure_gt_5_percent')) {
    return {
      primaryBlocker: 'bounce_pressure',
      nextAction:
        'Stop increasing volume, validate contacts with ZeroBounce/Hunter, and add fresh verified sender identities before scaling.',
    }
  }
  if (allBlockers.includes('domain_daily_capacity_used') || allBlockers.includes('identity_daily_capacity_used')) {
    return {
      primaryBlocker: 'daily_capacity_used',
      nextAction:
        'Wait for the daily reset or add another verified sender identity/domain with clean DNS and unused capacity.',
    }
  }
  if (allBlockers.includes('no_active_sender_identity')) {
    return {
      primaryBlocker: 'no_active_sender_identity',
      nextAction: 'Add active identities for each verified domain, then redeploy so sender rotation can use them.',
    }
  }
  if (allBlockers.includes('dns_authentication_incomplete')) {
    return {
      primaryBlocker: 'dns_authentication_incomplete',
      nextAction: 'Complete SPF, DKIM, and DMARC alignment before increasing outbound volume.',
    }
  }

  return {
    primaryBlocker: allBlockers[0] || 'capacity_blocked',
    nextAction: 'Open Sending Health and resolve the listed domain blockers before queueing more mail.',
  }
}

export async function getSendingCapacityDiagnosis(
  clientId: number,
  options?: { targetDailyVolume?: number }
): Promise<SendingCapacityDiagnosis> {
  const envTargetDailyVolume = envInt(
    'DAILY_OUTBOUND_TARGET_DAILY_VOLUME',
    envInt('TARGET_DAILY_VOLUME', envInt('INFRASTRUCTURE_TARGET_DAILY_VOLUME', 150, 1, 1_000_000), 1, 1_000_000),
    1,
    1_000_000
  )
  const targetDailyVolume = Math.max(
    1,
    Math.min(Math.trunc(options?.targetDailyVolume ?? envTargetDailyVolume), 1_000_000)
  )
  const perIdentityDailyPlanningTarget = envInt(
    'CAPACITY_PLANNER_PER_IDENTITY_DAILY_TARGET',
    75,
    1,
    500
  )

  const rows = await query<DomainCapacityRow>(
    `WITH recent_events AS (
       SELECT
         domain_id,
         COUNT(*) FILTER (WHERE event_type = 'sent') AS recent_sent_count,
         COUNT(*) FILTER (WHERE event_type = 'bounce') AS recent_bounce_count
       FROM events
       WHERE client_id = $1
         AND domain_id IS NOT NULL
         AND created_at >= ${capacityHealthWindowSql()}
         AND event_type IN ('sent', 'bounce')
       GROUP BY domain_id
     ),
     domain_rows AS (
       SELECT
         d.id,
         d.domain,
         d.status,
         d.paused,
         d.spf_valid,
         d.dkim_valid,
         d.dmarc_valid,
         COALESCE(d.daily_limit, 0) AS daily_limit,
         COALESCE(d.daily_cap, d.daily_limit, 0) AS effective_daily_cap,
         COALESCE(d.sent_today, 0) AS sent_today,
         COALESCE(d.sent_count, 0) AS sent_count,
         COALESCE(d.bounce_count, 0) AS bounce_count,
         COALESCE(re.recent_sent_count, 0) AS capacity_sent_count,
         COALESCE(re.recent_bounce_count, 0) AS capacity_bounce_count,
         COALESCE(d.health_score, 0) AS health_score,
         GREATEST(
           0,
           LEAST(
             100,
             ROUND(100 - ((COALESCE(re.recent_bounce_count, 0)::numeric / GREATEST(COALESCE(re.recent_sent_count, 0) + 25, 1)) * 100 * 8))
           )
         ) AS computed_health_score,
         CASE
           WHEN COALESCE(re.recent_sent_count, 0) > 0
             THEN (COALESCE(re.recent_bounce_count, 0)::numeric / NULLIF(re.recent_sent_count, 0)) * 100
           ELSE 0
         END AS raw_bounce_rate
       FROM domains d
       LEFT JOIN recent_events re ON re.domain_id = d.id
       WHERE d.client_id = $1
     ),
     identity_rows AS (
       SELECT
         i.domain_id,
         COUNT(*) FILTER (WHERE i.status = 'active') AS active_identity_count,
         COALESCE(
           SUM(GREATEST(COALESCE(i.daily_limit, 0) - COALESCE(i.sent_today, 0), 0))
             FILTER (WHERE i.status = 'active'),
           0
         ) AS identity_remaining_capacity
       FROM identities i
       WHERE i.client_id = $1
       GROUP BY i.domain_id
     )
     SELECT
       d.*,
       COALESCE(i.active_identity_count, 0) AS active_identity_count,
       COALESCE(i.identity_remaining_capacity, 0) AS identity_remaining_capacity
     FROM domain_rows d
     LEFT JOIN identity_rows i ON i.domain_id = d.id
     ORDER BY d.status ASC, d.health_score DESC, d.raw_bounce_rate ASC, d.domain ASC`,
    [clientId]
  )

  const domains = rows.rows.map(diagnoseDomain)
  const currentRemainingCapacity = domains.reduce(
    (sum, domain) => sum + (domain.eligibleForQueueing ? domain.effectiveRemainingCapacity : 0),
    0
  )
  const activeDomains = domains.filter((domain) => domain.status === 'active' && !domain.paused).length
  const healthyDomains = domains.filter((domain) => domain.eligibleForQueueing).length
  const eligibleSenderIdentities = domains
    .filter((domain) => domain.eligibleForQueueing)
    .reduce((sum, domain) => sum + domain.activeSenderIdentities, 0)
  const { primaryBlocker, nextAction } = summarizeCapacityBlocker(domains)
  const identitiesNeededForTarget = Math.ceil(targetDailyVolume / perIdentityDailyPlanningTarget)
  const targetGap = Math.max(0, targetDailyVolume - currentRemainingCapacity)

  return {
    clientId,
    targetDailyVolume,
    currentRemainingCapacity,
    targetGap,
    activeDomains,
    healthyDomains,
    eligibleSenderIdentities,
    primaryBlocker,
    nextAction,
    scaleModel: {
      perIdentityDailyPlanningTarget,
      identitiesNeededForTarget,
      additionalHealthyIdentitiesNeeded: Math.max(0, identitiesNeededForTarget - eligibleSenderIdentities),
      domainsNeededAtFiveIdentitiesEach: Math.ceil(identitiesNeededForTarget / 5),
    },
    guardrails: [
      'Health is not reset by operator approval; bounce and complaint evidence remain durable.',
      'This deployment is capped at 150/day total across both sender inboxes; follow-ups consume the same capacity as first-touch sends.',
      '100k+/day is infrastructure-scale capability: it requires permissioned or transactional volume, many healthy domains, many identities, and provider approval.',
      'Cold outbound must remain reputation-aware, suppression-aware, and validation-backed before volume is increased.',
    ],
    domains,
  }
}
