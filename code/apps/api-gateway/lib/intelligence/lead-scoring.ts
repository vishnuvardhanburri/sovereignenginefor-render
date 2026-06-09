import type { NormalizedLeadRecord } from '@/lib/ingestion/normalize-record'
import { isAgencyRescueMotionText } from '@/lib/xavira-gtm-motion'

export type PriorityLane = 'agency_white_label' | 'enterprise_internal' | 'standard' | 'nurture' | 'suppress'

export interface LeadScore {
  outboundMaturityScore: number
  infrastructureScore: number
  aiGovernanceScore: number
  licensingProbabilityScore: number
  roleScore: number
  deliverabilityRiskScore: number
  agencyFitScore: number
  enterpriseValueScore: number
  priorityScore: number
  priorityLane: PriorityLane
  reasons: string[]
}

const AGENCY_TERMS = ['agency', 'revops', 'growth', 'lead', 'demand', 'sdr', 'outbound', 'marketing']
const AI_GOVERNANCE_TERMS = ['ai', 'ml', 'security', 'cyber', 'governance', 'compliance', 'privacy', 'risk']
const EXECUTIVE_TERMS = ['founder', 'ceo', 'owner', 'partner', 'vp', 'head', 'director', 'chief']
const RISKY_LOCAL_PARTS = new Set(['jobs', 'careers', 'support', 'noreply', 'no-reply', 'billing', 'abuse', 'postmaster'])

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100))
}

function containsAny(value: string, terms: string[]): boolean {
  const normalized = value.toLowerCase()
  return terms.some((term) => normalized.includes(term))
}

function textFor(record: NormalizedLeadRecord): string {
  return [record.company, record.companyDomain, record.title, record.industry, record.website]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function scoreLeadIntelligence(record: NormalizedLeadRecord): LeadScore {
  const text = textFor(record)
  const localPart = record.email.split('@')[0]
  const isAgency = containsAny(text, AGENCY_TERMS) || isAgencyRescueMotionText(text)
  const isAiGovernance = containsAny(text, AI_GOVERNANCE_TERMS)
  const isExecutive = containsAny(record.title ?? '', EXECUTIVE_TERMS)
  const employeeCount = record.employeeCount ?? 0
  const targetSizeFit = employeeCount === 0 ? 12 : employeeCount >= 10 && employeeCount <= 250 ? 26 : employeeCount <= 1000 ? 16 : 6
  const roleScore = clampScore((isExecutive ? 55 : 25) + (record.title ? 15 : 0) + (localPart.includes('.') ? 10 : 0))
  const deliverabilityRiskScore = clampScore(
    (RISKY_LOCAL_PARTS.has(localPart) ? 42 : 12) +
      (record.emailDomain === record.companyDomain ? 0 : 10) +
      (record.emailDomain.includes('gmail.') || record.emailDomain.includes('outlook.') ? 12 : 0)
  )
  const agencyFitScore = clampScore((isAgency ? 68 : 6) + targetSizeFit + (isExecutive ? 14 : 0))
  const aiGovernanceScore = clampScore((isAiGovernance ? 48 : 10) + (text.includes('enterprise') ? 14 : 0) + targetSizeFit)
  const infrastructureScore = clampScore(
    24 +
      targetSizeFit +
      (text.includes('platform') ? 14 : 0) +
      (text.includes('infrastructure') ? 18 : 0) +
      (text.includes('security') ? 10 : 0)
  )
  const outboundMaturityScore = clampScore((isAgency ? 50 : 15) + (text.includes('sales') ? 10 : 0) + targetSizeFit)
  const enterpriseValueScore = clampScore(
    Math.max(agencyFitScore, isAgency ? aiGovernanceScore : aiGovernanceScore * 0.45, isAgency ? infrastructureScore : infrastructureScore * 0.45) +
      (isExecutive ? 8 : 0) -
      deliverabilityRiskScore * 0.18
  )
  const licensingProbabilityScore = clampScore(
    agencyFitScore * 0.36 + aiGovernanceScore * 0.22 + infrastructureScore * 0.22 + roleScore * 0.2 - deliverabilityRiskScore * 0.12
  )
  const priorityScore = clampScore(
    licensingProbabilityScore * 0.4 + enterpriseValueScore * 0.3 + roleScore * 0.2 + outboundMaturityScore * 0.1
  )

  const reasons = [
    isAgency ? 'agency/client-campaign rescue fit detected' : 'non-agency fallback target',
    isAiGovernance ? 'AI/security/governance fit detected' : 'limited AI governance signal',
    isExecutive ? 'executive/operator title' : 'non-executive or unknown title',
    deliverabilityRiskScore >= 40 ? 'role inbox or risky local part' : 'acceptable deliverability risk',
  ]

  const priorityLane: PriorityLane =
    deliverabilityRiskScore >= 70
      ? 'suppress'
      : agencyFitScore >= 70 && priorityScore >= 55
        ? 'agency_white_label'
        : isAgency && (enterpriseValueScore >= 55 || aiGovernanceScore >= 55)
          ? 'enterprise_internal'
          : priorityScore >= 40
            ? 'standard'
            : 'nurture'

  return {
    outboundMaturityScore,
    infrastructureScore,
    aiGovernanceScore,
    licensingProbabilityScore,
    roleScore,
    deliverabilityRiskScore,
    agencyFitScore,
    enterpriseValueScore,
    priorityScore,
    priorityLane,
    reasons,
  }
}
