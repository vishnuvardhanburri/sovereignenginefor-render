import { query } from '@/lib/db'

const FALLBACK_REVIEW_WINDOW = 5
const SYSTEM_APPROVAL_CEILING = Math.max(
  1,
  Math.min(Number(process.env.CONTACT_APPROVAL_MAX_WINDOW ?? 50), 250)
)

export type SystemApprovalWindow = {
  limit: number
  activeDomains: number
  remainingCapacity: number
  averageHealthScore: number
  policy: 'fallback_review_window' | 'domain_capacity_health_window'
}

export async function resolveSystemApprovalWindow(clientId: number): Promise<SystemApprovalWindow> {
  const row = await query<{
    active_domains: string
    remaining_capacity: string
    average_health_score: string
  }>(
    `SELECT
       COUNT(*)::text AS active_domains,
       COALESCE(SUM(GREATEST(COALESCE(daily_cap, daily_limit) - sent_today, 0)), 0)::text AS remaining_capacity,
       COALESCE(AVG(health_score), 100)::text AS average_health_score
     FROM domains
     WHERE client_id = $1
       AND status = 'active'
       AND paused = false`,
    [clientId]
  )

  const signal = row.rows[0]
  const activeDomains = Number(signal?.active_domains ?? 0)
  const remainingCapacity = Number(signal?.remaining_capacity ?? 0)
  const averageHealthScore = Number(signal?.average_health_score ?? 100)

  if (activeDomains === 0 || remainingCapacity <= 0) {
    return {
      limit: FALLBACK_REVIEW_WINDOW,
      activeDomains,
      remainingCapacity,
      averageHealthScore,
      policy: 'fallback_review_window',
    }
  }

  const reviewPercent = averageHealthScore >= 90 ? 0.2 : averageHealthScore >= 75 ? 0.1 : 0.05
  const computed = Math.floor(remainingCapacity * reviewPercent)
  const limit = Math.max(1, Math.min(SYSTEM_APPROVAL_CEILING, Math.max(FALLBACK_REVIEW_WINDOW, computed)))

  return {
    limit,
    activeDomains,
    remainingCapacity,
    averageHealthScore,
    policy: 'domain_capacity_health_window',
  }
}
