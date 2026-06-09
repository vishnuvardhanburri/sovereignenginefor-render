export const XAVIRA_AGENCY_GTM_MOTION = {
  version: '2026-06-agency-rescue-motion-v1',
  primaryIcp:
    'Lead generation agencies, RevOps agencies, outbound agencies, appointment-setting agencies, SDR-as-a-service firms, and B2B demand-generation agencies.',
  entryOffer: '£5,000 Campaign Rescue Sprint',
  followOnOffer: '£3,000/month Xavira Control Partner',
  idealAgencySharePct: 80,
  directFallbackSharePct: 20,
  dailyConversationGoal: 10,
  firstCustomerTarget: 10,
  discoveryQuestion:
    'When a client campaign underperforms, what do clients blame first: lead quality, deliverability, follow-ups, or reporting?',
  agencyIntentTerms: [
    'abm',
    'appointment setting',
    'b2b demand generation',
    'b2b lead generation',
    'b2b marketing agency',
    'b2b sales agency',
    'client acquisition',
    'cold email agency',
    'demand generation',
    'done-for-you outbound',
    'gtm agency',
    'lead generation',
    'outbound agency',
    'outbound sales',
    'revops',
    'revenue operations',
    'sales development',
    'sdr as a service',
  ],
  agencyPainSignals: [
    'client reporting proof',
    'deliverability uncertainty',
    'duplicate outreach',
    'follow-up ownership',
    'inbox placement doubt',
    'lead quality blame',
    'low replies',
    'sender/domain risk',
  ],
  forbiddenFirstTouch: [
    'book a demo',
    'schedule a call',
    'hop on a call',
    'pricing',
    'license',
    'white-label',
    'reseller rights',
    'maintenance',
  ],
  followUpFrames: [
    {
      day: 0,
      name: 'Specific observation',
      rule: 'Start with agency-specific evidence and ask one diagnostic question.',
    },
    {
      day: 3,
      name: 'Decision clarity',
      rule: 'Ask whether this is worth diagnosing now or not a priority.',
    },
    {
      day: 5,
      name: 'Cost of delay',
      rule: 'Name the consequence of letting campaign underperformance sit.',
    },
    {
      day: 8,
      name: 'Close loop',
      rule: 'Detach cleanly and close the thread without neediness.',
    },
  ],
} as const

const AGENCY_INTENT_RE = new RegExp(
  `\\b(?:${XAVIRA_AGENCY_GTM_MOTION.agencyIntentTerms
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
    .join('|')})\\b`,
  'i'
)

export function isAgencyRescueMotionText(value: string): boolean {
  return AGENCY_INTENT_RE.test(value)
}

export function agencyTargetCount(limit: number): number {
  const normalizedLimit = Math.max(0, Math.trunc(limit))
  return Math.min(
    normalizedLimit,
    Math.ceil((normalizedLimit * XAVIRA_AGENCY_GTM_MOTION.idealAgencySharePct) / 100)
  )
}

export function directFallbackTargetCount(limit: number): number {
  const normalizedLimit = Math.max(0, Math.trunc(limit))
  return Math.max(0, normalizedLimit - agencyTargetCount(normalizedLimit))
}

export function agencyDiscoveryQueries(region: string): string[] {
  const suffix = String(region || 'United States').trim() || 'United States'
  return [
    '"lead generation agency" "client acquisition" "contact"',
    '"outbound sales agency" "appointment setting" "contact"',
    '"RevOps agency" "sales operations" "contact"',
    '"B2B demand generation agency" "case studies" "contact"',
    '"SDR as a service" "B2B" "contact"',
    '"cold email agency" "deliverability" "contact"',
    '"done-for-you outbound" "B2B" "contact"',
    '"go-to-market agency" "pipeline" "contact"',
  ].map((query) => `${query} ${suffix}`)
}
