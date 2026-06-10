import type { SovereignOfferType, SovereignCopyLead } from './outbound-copy'
import { XAVIRA_COMMERCIAL_MODEL } from './commercial-model'
import { XAVIRA_AGENCY_GTM_MOTION } from './xavira-gtm-motion'

export const SOVEREIGN_SALES_BRAIN_VERSION = XAVIRA_AGENCY_GTM_MOTION.version

export const SOVEREIGN_SALES_BRAIN_SOURCES = [
  'MILLION-DOLLAR SALES FRAMEWORK',
  'COLD EMAIL DOMINATION FRAMEWORK',
  'COMPETITIVE ANALYSIS',
  'Funnel Creation & The Content Magnet System',
  'High-Ticket Ads Playbook',
  'Inbound vs Outbound',
  'My Sales script',
  'N8N SALES AUTOMATION PLAYBOOK',
  'The Invisible Loopholes That Decide Who Wins in Any Field',
  'THE REAL REASON YOU ARE NOT CLOSING',
  'VALUE STACKING FOR $10K-$200K OFFERS',
]

const CORE_RULES = [
  'Position Xavira Tech Labs as a founder-led campaign rescue and control partner, not a cold email tool or generic agency.',
  `Primary ICP for the next 30 days: ${XAVIRA_AGENCY_GTM_MOTION.primaryIcp}`,
  'Lead with the buyer question: why buy this, what risk or profit does it affect, and why now.',
  'Lead with pain before product: low replies, client blame, inbox placement doubt, weak follow-up ownership, poor reporting proof, and sender/domain risk.',
  `Make one clear entry offer after interest: ${XAVIRA_AGENCY_GTM_MOTION.entryOffer} reviews one live agency/client campaign and returns practical fixes before any larger platform discussion.`,
  `Keep the ask low-friction: ask this diagnostic question or a close variant: "${XAVIRA_AGENCY_GTM_MOTION.discoveryQuestion}"`,
  'Use proof language over hype: one campaign, real evidence, practical rewrite, simple client-facing summary, no fake customer claims.',
  'Write like a founder/operator: short sentences, specific business pain, calm confidence, no buzzword pileups, no AI-sounding filler.',
  'Preferred language: client blame, campaign proof, reply blockers, spam folders or Promotions tabs, inbox placement, follow-up ownership, client reporting, sender risk, simple diagnosis, campaign rescue.',
  'Avoid language that sounds like spam or hype: bulk email software, mass blasting, unlimited emails, growth hacks, AI spam system, send millions, scale instantly, buy today, limited time.',
  `Preserve entry value: the Campaign Rescue Sprint is ${XAVIRA_COMMERCIAL_MODEL.campaignRescueSprint.label} GBP one-time; the optional Control Partner follow-on is ${XAVIRA_COMMERCIAL_MODEL.controlPartnerMonthly.label} only after proof.`,
  'Use recurring offer language only after the sprint exposes a real ongoing pain.',
  'Personalize from verified public evidence only; never invent a founder, campaign, revenue number, or private fact.',
  'Use social, LinkedIn, or competitor context only when it is present in the lead research payload; otherwise skip it.',
  'Never claim competitors are customers unless the lead record contains explicit competitor evidence.',
  'Every email must include one thoughtful discovery question and a polite opt-out line.',
]

const DIRECT_RULES = [
  `Direct offer after interest: ${XAVIRA_COMMERCIAL_MODEL.campaignRescueSprint.label} GBP Campaign Rescue Sprint.`,
  'Direct non-agency prospects are fallback only; do not let them crowd out agency owners.',
  'Frame ROI as finding why replies are low, reducing wasted follow-ups, improving proof, and clarifying whether lead quality, spam folders, Promotions tabs, or delivery is the real blocker.',
  'Mention Xavira once in plain business language only.',
  'Best CTA after curiosity: review one real campaign, not a generic demo.',
]

const AGENCY_RULES = [
  `Agency entry offer after interest: ${XAVIRA_COMMERCIAL_MODEL.campaignRescueSprint.label} GBP Campaign Rescue Sprint.`,
  `Agency follow-on only after proof: ${XAVIRA_COMMERCIAL_MODEL.controlPartnerMonthly.label} Xavira Control Partner.`,
  'Frame it as helping agencies diagnose client campaign underperformance before clients default to blaming lead quality, copy, follow-ups, or reporting.',
  'Do not mention white-label rights, reseller rights, maintenance, or license language in outbound copy.',
  'Best CTA after curiosity: rescue one live client campaign.',
]

const FOLLOW_UP_RULES = [
  'Sequence steps: Day 1 specific observation, Day 3 binary decision clarity, Day 5 priority/cost-of-delay check, Day 8 close-the-loop detachment.',
  'Stop follow-ups on replies, bounces, unsubscribes, invalid validation, or suppression match.',
  'Never say "just checking in", "any updates", "no pressure", or "let me know your thoughts".',
  'Follow-ups should direct the process calmly without guilt, begging, fake scarcity, or threats.',
]

export function buildSalesBrainContext(
  lead: SovereignCopyLead,
  offerType: SovereignOfferType
): string {
  const custom = lead.customFields ?? {}
  const company = String(lead.company || lead.companyDomain || 'the company')
  const region = String(custom.region || custom.country || custom.location || 'global')
  const evidence = String(
    custom.research_evidence_url ||
      custom.public_evidence_url ||
      custom.sheet_source_url ||
      lead.source ||
      'operator-owned lead source'
  )
  const socialContext = [
    custom.linkedin_url ? `LinkedIn: ${custom.linkedin_url}` : '',
    custom.linkedin_post_url ? `LinkedIn post: ${custom.linkedin_post_url}` : '',
    custom.social_signal ? `Social signal: ${custom.social_signal}` : '',
    custom.competitor_signal ? `Competitor/category signal: ${custom.competitor_signal}` : '',
    custom.research_summary ? `Research summary: ${custom.research_summary}` : '',
  ].filter(Boolean)
  const rules = offerType === 'agency' ? AGENCY_RULES : DIRECT_RULES

  return [
    `Sovereign Sales Brain ${SOVEREIGN_SALES_BRAIN_VERSION}`,
    `Lead: ${company}`,
    `Region/context: ${region}`,
    `Evidence source: ${evidence}`,
    socialContext.length > 0 ? 'Lead research context:' : '',
    ...socialContext.map((item) => `- ${item}`),
    'Core rules:',
    ...CORE_RULES.map((rule) => `- ${rule}`),
    'Offer rules:',
    ...rules.map((rule) => `- ${rule}`),
    'Agency motion:',
    `- Target mix: ${XAVIRA_AGENCY_GTM_MOTION.idealAgencySharePct}% agency rescue prospects / ${XAVIRA_AGENCY_GTM_MOTION.directFallbackSharePct}% direct fallback.`,
    `- First customer target: ${XAVIRA_AGENCY_GTM_MOTION.firstCustomerTarget} paid rescue sprints.`,
    'Follow-up rules:',
    ...FOLLOW_UP_RULES.map((rule) => `- ${rule}`),
  ].join('\n')
}

export function salesBrainBulletPoints(offerType: SovereignOfferType): string[] {
  return [
    'Pain-first opener tied to outbound revenue risk',
    offerType === 'agency'
      ? `${XAVIRA_COMMERCIAL_MODEL.controlPartnerMonthly.label} agency follow-on only after a ${XAVIRA_COMMERCIAL_MODEL.campaignRescueSprint.label} sprint proves pain`
      : `${XAVIRA_COMMERCIAL_MODEL.campaignRescueSprint.label} direct campaign rescue value stack`,
    'Low-friction diagnostic question before any booking link',
    'Evidence-backed personalization only',
    'Compliance-safe opt-out and follow-up stop conditions',
  ]
}
