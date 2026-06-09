import {
  inferSovereignOfferType,
  balanceSovereignOfferMix,
  buildLeadResearchContext,
  buildSovereignBuyerIntelligence,
  buildSovereignCopyDecision,
  buildSovereignCopyForLead,
  buildSovereignPainLine,
  rankSovereignLeads,
  renderSovereignHtmlEmail,
  renderSovereignTemplate,
  SOVEREIGN_BOOKING_URL,
  SOVEREIGN_CLIENT_GENERATION_TARGET,
  SOVEREIGN_STACK_DIRECT_SEQUENCE_STEPS,
  sovereignBookingUrl,
  sovereignDealValueUsd,
  sovereignBodyForLead,
  sovereignClientIntentScore,
  scoreSovereignConversationCopy,
  sovereignSubjectForLead,
} from '@/lib/outbound-copy'

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

const directLead = {
  first_name: 'Ava',
  company: 'Example SaaS',
  companyDomain: 'example-saas.com',
  title: 'VP Sales',
  reason_to_contact: 'active outbound campaigns',
}

const agencyLead = {
  first_name: 'Maya',
  company: 'Example Agency',
  companyDomain: 'example-agency.com',
  title: 'partnerships team',
  reason_to_contact: 'agency outreach because it shows public signals around demand generation',
}

assert(inferSovereignOfferType(directLead) === 'direct', 'direct lead should use rescue sprint copy')
assert(inferSovereignOfferType(agencyLead) === 'agency', 'agency lead should use agency partner copy')
assert(sovereignDealValueUsd(directLead) === 5000, 'direct lead should be valued at the £5,000 rescue sprint')
assert(sovereignDealValueUsd(agencyLead) === 3000, 'agency lead should be valued at the £3,000/month partner motion')
assert(
  rankSovereignLeads([
    { ...directLead, company: 'Low Intent SaaS', customFields: { fit_score: 62 } },
    { ...agencyLead, customFields: { fit_score: 78, public_evidence_url: 'https://example-agency.com' } },
  ])[0]?.company === agencyLead.company,
  'client-generation ranking should prioritize buyer intent plus commercial value'
)
assert(
  sovereignClientIntentScore({
    ...agencyLead,
    title: 'Founder',
    customFields: {
      fit_score: 92,
      public_evidence_url: 'https://example-agency.com/services',
      linkedin_url: 'https://www.linkedin.com/company/example-agency',
    },
  }) >= 85,
  'high-intent agency leads should be scored as serious client opportunities'
)
assert(
  SOVEREIGN_CLIENT_GENERATION_TARGET.operatingSendFloor === 125 &&
    SOVEREIGN_CLIENT_GENERATION_TARGET.operatingSendCeiling === 199 &&
    SOVEREIGN_CLIENT_GENERATION_TARGET.idealAgencySharePct === 80,
  'client-generation operating range should be explicit'
)
const balanced = balanceSovereignOfferMix(
  [
    { ...agencyLead, company: 'Agency A', customFields: { fit_score: 99 } },
    { ...agencyLead, company: 'Agency B', customFields: { fit_score: 98 } },
    { ...agencyLead, company: 'Agency C', customFields: { fit_score: 97 } },
    { ...agencyLead, company: 'Agency D', customFields: { fit_score: 96 } },
    { ...agencyLead, company: 'Agency E', customFields: { fit_score: 95 } },
    { ...agencyLead, company: 'Agency F', customFields: { fit_score: 94 } },
    { ...agencyLead, company: 'Agency G', customFields: { fit_score: 93 } },
    { ...agencyLead, company: 'Agency H', customFields: { fit_score: 92 } },
    { ...directLead, company: 'Direct A', customFields: { fit_score: 97 } },
    { ...directLead, company: 'Direct B', customFields: { fit_score: 96 } },
  ],
  10
)
assert(
  balanced.filter((lead) => inferSovereignOfferType(lead) === 'agency').length === 8,
  'agency-first queue should reserve about 80% for agency rescue prospects'
)
assert(
  balanced.filter((lead) => inferSovereignOfferType(lead) === 'direct').length === 2,
  'agency-first queue should keep direct prospects as the fallback lane'
)
const directHeavyBalanced = balanceSovereignOfferMix(
  [
    { ...agencyLead, company: 'Only Agency', customFields: { fit_score: 99 } },
    { ...directLead, company: 'Direct A', customFields: { fit_score: 98 } },
    { ...directLead, company: 'Direct B', customFields: { fit_score: 97 } },
    { ...directLead, company: 'Direct C', customFields: { fit_score: 96 } },
    { ...directLead, company: 'Direct D', customFields: { fit_score: 95 } },
  ],
  6
)
assert(
  directHeavyBalanced.every((lead) => inferSovereignOfferType(lead) === 'agency'),
  'strict agency-first pools must not fill missing agency slots with direct leads'
)
assert(directHeavyBalanced.length === 1, 'strict agency-first mix should expose agency inventory shortfall')
const directHeavyFilled = balanceSovereignOfferMix(
  [
    { ...agencyLead, company: 'Only Agency', customFields: { fit_score: 99 } },
    { ...directLead, company: 'Direct A', customFields: { fit_score: 98 } },
    { ...directLead, company: 'Direct B', customFields: { fit_score: 97 } },
    { ...directLead, company: 'Direct C', customFields: { fit_score: 96 } },
    { ...directLead, company: 'Direct D', customFields: { fit_score: 95 } },
  ],
  6,
  { allowRemainderFill: true }
)
assert(
  directHeavyFilled.length === 5,
  'agency-first mode should keep sending with best available fallback inventory instead of freezing'
)
const debtAwareAgencyRepair = balanceSovereignOfferMix(
  [
    { ...agencyLead, company: 'Agency Repair A', customFields: { fit_score: 99 } },
    { ...agencyLead, company: 'Agency Repair B', customFields: { fit_score: 98 } },
    { ...agencyLead, company: 'Agency Repair C', customFields: { fit_score: 97 } },
  ],
  6,
  { preferredOfferType: 'agency', preferredSlots: 47 }
)
assert(
  debtAwareAgencyRepair.length === 3 &&
    debtAwareAgencyRepair.every((lead) => inferSovereignOfferType(lead) === 'agency'),
  'debt-aware mix should use agency inventory to repair a direct-heavy day instead of freezing queueing'
)
assert(
  SOVEREIGN_STACK_DIRECT_SEQUENCE_STEPS.map((step) => step.day).join(',') === '0,3,5,8',
  'default sequence should use Day 1, Day 3, Day 5, Day 8 decision-frame cadence'
)
assert(
  SOVEREIGN_STACK_DIRECT_SEQUENCE_STEPS.at(-1)?.subject === 'closing the loop',
  'final sequence step should be the soft breakup'
)
assert(
  sovereignSubjectForLead(directLead).includes('communication visibility'),
  'direct subject should lead with communication visibility'
)
assert(
  /client outreach visibility|partnership communication visibility|follow-up visibility/.test(sovereignSubjectForLead(agencyLead)),
  'agency subject should adapt to buyer role without generic quick-check wording'
)

const agencyDecision = buildSovereignCopyDecision(agencyLead)
assert(agencyDecision.offerType === 'agency', 'agency decision should keep agency offer type')
assert(
  agencyDecision.industry === 'agency' || agencyDecision.industry === 'revops',
  'agency decision should detect agency/revops context'
)
assert(agencyDecision.persona === 'partnerships', 'agency decision should detect partnerships persona')
assert(
  agencyDecision.value === 'Xavira Control Stack was built around that layer.',
  'agency decision should mention Xavira only once without feature dumping'
)
assert(
  !/£1,500|£3,000|£5,000/.test(agencyDecision.value),
  'agency decision should not expose price in cold value line'
)

const technicalDecision = buildSovereignCopyDecision({
  ...directLead,
  company: 'Example AI',
  title: 'CTO',
  reason_to_contact: 'AI infrastructure and developer tools',
})
assert(
  technicalDecision.industry === 'ai' || technicalDecision.industry === 'devtools',
  'technical decision should adapt to AI/devtools industry'
)
assert(technicalDecision.persona === 'technical', 'technical decision should detect technical persona')
assert(
  /systems?|integrations?|reliability/.test(technicalDecision.cta),
  'technical decision should ask about systems, integrations, or reliability'
)

const investorLead = {
  first_name: 'David',
  company: 'StrataX Development',
  companyDomain: 'strataxdev.com',
  title: 'Founder',
  reason_to_contact:
    'StrataX Development appears active around capital raising, investor relationships, lender and broker coordination, and partnership-driven development.',
}
const investorIntelligence = buildSovereignBuyerIntelligence(investorLead)
assert(
  investorIntelligence.communicationComplexity.includes('investors') &&
    investorIntelligence.communicationComplexity.includes('lenders'),
  'buyer intelligence should extract stakeholder communication complexity'
)
assert(
  investorIntelligence.businessSummary.includes('capital-raising') ||
    investorIntelligence.revenueMotion.includes('capital'),
  'buyer intelligence should summarize the revenue motion'
)
const investorDecision = buildSovereignCopyDecision(investorLead)
assert(
  investorDecision.proof.includes('investors, lenders, brokers, partners, and project stakeholders'),
  'observation should focus on coordination, not generic growth'
)
assert(
  investorDecision.pain.includes('visibility') && investorDecision.pain.includes('ownership'),
  'hypothesis should focus on operational control'
)
assert(
  investorDecision.cta.includes('StrataX Development') && investorDecision.cta.includes('?'),
  'question engine should produce one company-specific discovery question'
)

const coldSequenceText = SOVEREIGN_STACK_DIRECT_SEQUENCE_STEPS.map((step) => step.body).join('\n')
assert(
  !coldSequenceText.includes('£1,500') &&
    !coldSequenceText.includes('£3,000') &&
    !coldSequenceText.includes('£5,000') &&
    !coldSequenceText.includes('£500') &&
    !coldSequenceText.includes('£160,000') &&
    !coldSequenceText.includes('£40,000'),
  'cold sequence should not mention pricing'
)
assert(
  !/reseller rights|commercial rights|3-4 serious client/i.test(coldSequenceText),
  'cold sequence should not mention license economics'
)
assert(
  !/just following up|any updates|no pressure|let me know your thoughts/i.test(coldSequenceText),
  'cold sequence should avoid needy follow-up language'
)
assert(
  /Worth diagnosing now, or not a priority/.test(coldSequenceText) &&
    /should I close this for now/.test(coldSequenceText),
  'cold sequence should use decision-frame follow-up language'
)

const previousBookingUrl = process.env.SOVEREIGN_BOOKING_URL
const previousOutboundBookingUrl = process.env.OUTBOUND_BOOKING_URL
const previousAllowedBookingDomains = process.env.SOVEREIGN_ALLOWED_BOOKING_DOMAINS
delete process.env.SOVEREIGN_BOOKING_URL
process.env.OUTBOUND_BOOKING_URL = 'https://cal.com/vishnuvardhanburri/30min'
delete process.env.SOVEREIGN_ALLOWED_BOOKING_DOMAINS
assert(
  sovereignBookingUrl() === SOVEREIGN_BOOKING_URL,
  'booking URL should default to owned domain when external booking host is not allowlisted'
)
process.env.SOVEREIGN_ALLOWED_BOOKING_DOMAINS = 'cal.com'
assert(
  sovereignBookingUrl().startsWith('https://cal.com/'),
  'operators can explicitly allow a third-party booking host'
)
if (previousBookingUrl === undefined) delete process.env.SOVEREIGN_BOOKING_URL
else process.env.SOVEREIGN_BOOKING_URL = previousBookingUrl
if (previousOutboundBookingUrl === undefined) delete process.env.OUTBOUND_BOOKING_URL
else process.env.OUTBOUND_BOOKING_URL = previousOutboundBookingUrl
if (previousAllowedBookingDomains === undefined) delete process.env.SOVEREIGN_ALLOWED_BOOKING_DOMAINS
else process.env.SOVEREIGN_ALLOWED_BOOKING_DOMAINS = previousAllowedBookingDomains

const directBody = renderSovereignTemplate(
  sovereignBodyForLead(directLead),
  directLead,
  'Xavira Tech Labs, India'
)
assert(directBody.includes('Xavira Control Stack'), 'direct body should mention Xavira Control Stack')
assert(
  directBody.includes('Example SaaS appears'),
  'direct body should lead with a company-specific observation'
)
assert(
  /follow-up|follow-ups/.test(directBody) && directBody.includes('visibility'),
  'direct body should name business communication pains without sounding spammy'
)
assert(directBody.includes('Example SaaS'), 'direct body should render company')
assert(!directBody.includes('{{'), 'direct body should render all placeholders')
assert(
  buildSovereignPainLine(directLead).includes('Example SaaS'),
  'pain line should be company-specific'
)
assert(!/Quick check/i.test(sovereignSubjectForLead(directLead)), 'subjects should avoid generic quick-check wording')

const genericInboxBody = renderSovereignTemplate(
  sovereignBodyForLead({ first_name: 'hello', company: 'Inbox Co' }),
  { first_name: 'hello', company: 'Inbox Co' },
  'Xavira Tech Labs, India'
)
assert(genericInboxBody.startsWith('Hi there,'), 'generic inboxes should not render as names')
assert(!genericInboxBody.includes('Hi hello,'), 'generic inbox local parts should be suppressed')

const contentPageLead = {
  first_name: 'feedback',
  company: 'Introduction to Cyber Security',
  companyDomain: 'geeksforgeeks.org',
  reason_to_contact:
    'Public search result matched cybersecurity target profile: Apr 28, 2026 &nbsp;· There are seven types of cybersecurity, each explained below in detail.',
}
const contentPageBody = renderSovereignTemplate(
  sovereignBodyForLead(contentPageLead),
  contentPageLead,
  'Xavira Tech Labs, India'
)
assert(contentPageBody.startsWith('Hi there,'), 'feedback inboxes should not render as names')
assert(!contentPageBody.includes('Introduction to Cyber Security'), 'content page titles should not be treated as companies')
assert(!contentPageBody.includes('There are seven types'), 'article snippets should not leak into outreach copy')
assert(contentPageBody.includes('Geeksforgeeks'), 'content-page fallbacks should use the domain brand')

const guardrailReasonBody = renderSovereignTemplate(
  sovereignBodyForLead({
    first_name: 'hello',
    company: 'SentinelOne',
    companyDomain: 'sentinelone.com',
    reason_to_contact:
      'SentinelOne shows public signals around endpoint security, SOC operations. Public domain and MX records confirm the business domain; selected safe founder inbox hello@sentinelone.com.',
  }),
  {
    first_name: 'hello',
    company: 'SentinelOne',
    companyDomain: 'sentinelone.com',
    reason_to_contact:
      'SentinelOne shows public signals around endpoint security, SOC operations. Public domain and MX records confirm the business domain; selected safe founder inbox hello@sentinelone.com.',
  },
  'Xavira Tech Labs, India'
)
assert(!guardrailReasonBody.includes('selected safe'), 'operator guardrail notes must not leak into copy')
assert(!guardrailReasonBody.includes('MX records confirm'), 'validation notes must not leak into copy')
assert(!guardrailReasonBody.includes('hello@sentinelone.com'), 'recipient evidence must not leak into body copy')

const agencyBody = renderSovereignTemplate(
  sovereignBodyForLead(agencyLead),
  agencyLead,
  'Xavira Tech Labs, India'
)
assert(
  !/£1,500|£3,000|£5,000|£500/.test(agencyBody),
  'first-touch agency body should not mention offer pricing'
)
assert(!/reseller rights/i.test(agencyBody), 'first-touch agency body should not mention reseller rights before a reply')
assert(!/3-4 serious client deployments/i.test(agencyBody), 'first-touch agency body should not explain resale economics')
assert(
  agencyBody.includes('Xavira Control Stack was built around that layer.'),
  'agency body should use the single-sentence Xavira mention'
)
assert(
  agencyBody.includes('?') && !/book|demo|walkthrough|schedule/i.test(agencyBody),
  'agency body should optimize for a reply, not a meeting ask'
)
assert(
  agencyBody.includes('what gets blamed first'),
  'agency body should use the client-blame diagnostic question'
)
assert(
  !/what becomes hardest/i.test(agencyBody),
  'agency body should not fall back to generic visibility wording'
)
assert(agencyBody.includes('Xavira Control Stack'), 'agency body should mention Xavira Control Stack')
assert(!agencyBody.includes('{{'), 'agency body should render all placeholders')

const researchContext = buildLeadResearchContext({
  ...agencyLead,
  customFields: {
    linkedin_url: 'https://www.linkedin.com/company/example-agency',
    linkedin_post_url: 'https://www.linkedin.com/feed/update/example',
    social_signal: 'recent post about outbound scaling',
    competitor_signal: 'category is adopting AI governance',
  },
})
assert(
  researchContext.linkedinPostUrl?.includes('linkedin.com'),
  'research context should preserve LinkedIn post evidence'
)
assert(
  researchContext.competitorSignal === 'category is adopting AI governance',
  'research context should carry competitor/category signal only from evidence'
)

async function main() {
  const rendered = await buildSovereignCopyForLead(directLead, {
    physicalAddress: 'Xavira Tech Labs, India',
    useOpenRouter: false,
  })
  assert(!rendered.html.includes('Book walkthrough'), 'first-touch built copy should not include booking CTA')
  assert(
    rendered.text.includes('If not relevant, no worries.'),
    'built copy should include the conversation-first soft opt-out'
  )
  assert(
    (rendered.text.match(/\?/g) ?? []).length === 1,
    'built copy should ask exactly one thoughtful question'
  )
  assert(
    !/£500|£1,500|£3,000|£5,000|£15,000|£40,000|£160,000|reseller rights|commercial rights/i.test(rendered.text),
    'built copy should not mention pricing or license economics'
  )
  assert(
    !/book|demo|walkthrough|schedule|cal\.com/i.test(rendered.text),
    'built copy should not ask for a meeting directly'
  )
  const scores = scoreSovereignConversationCopy(rendered.text, 'Example SaaS', 'revenue')
  assert(
    Object.values(scores).every((score) => score >= 85),
    `built copy should pass self-scoring gate: ${JSON.stringify(scores)}`
  )
  assert(
    ((rendered.text.split(/\n\nBest,\s*\nVishnu/i)[0] ?? rendered.text).match(/\bXavira\b/g) ?? []).length === 1,
    'built copy body should mention Xavira exactly once before the signature'
  )
  assert(
    !/revolutionary|cutting-edge|game-changing|powerful|innovative|industry-leading|white-label|maintenance|license/i.test(rendered.text),
    'built copy should reject hype, white-label, maintenance, and license language'
  )

  console.log('outbound copy tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
