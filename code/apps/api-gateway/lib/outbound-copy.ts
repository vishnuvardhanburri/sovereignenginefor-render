export type SovereignOfferType = 'direct' | 'agency'

export type SovereignCopyLead = {
  first_name?: string | null
  firstName?: string | null
  company?: string | null
  companyDomain?: string | null
  title?: string | null
  source?: string | null
  reason_to_contact?: string | null
  reasonToContact?: string | null
  offer_type?: string | null
  offerType?: string | null
  customFields?: Record<string, unknown> | null
}

export const SOVEREIGN_STACK_DIRECT_SUBJECT =
  'Quick check on your outbound deliverability + AI compliance?'

export const SOVEREIGN_STACK_AGENCY_SUBJECT =
  'White-label outbound + AI security product for your agency'

export function inferSovereignOfferType(input: SovereignCopyLead): SovereignOfferType {
  const custom = input.customFields ?? {}
  const explicit = String(
    input.offer_type ?? input.offerType ?? custom.offer_type ?? custom.offerType ?? ''
  ).toLowerCase()
  if (explicit === 'agency' || explicit === 'agency_master') return 'agency'
  if (explicit === 'direct') return 'direct'

  const text = [
    input.company,
    input.companyDomain,
    input.title,
    input.source,
    input.reason_to_contact,
    input.reasonToContact,
    custom.industry,
    custom.segment,
    custom.persona,
  ]
    .map((value) => String(value ?? '').toLowerCase())
    .join(' ')

  if (
    /\bagency\b|\bagencies\b|marketing agency|performance marketing|digital marketing|growth marketing|seo agency|paid acquisition/.test(
      text
    )
  ) {
    return 'agency'
  }

  return 'direct'
}

export function sovereignDirectEmail1Body(): string {
  return `Hey {{FirstName}},

I noticed {{Company}} is running active outbound campaigns.

Most teams we speak with are losing leads because of:
* Warming domains getting burned
* AI tools leaking PII / sensitive data
* Compliance pressure (GDPR / DPDP)

We built Sovereign Stack - one $25k one-time license that combines:
* Adaptive deliverability OS (protects your domains & inbox placement)
* Private AI Security Gateway (blocks prompt injection + masks PII)

Fully self-hosted, audit-ready, and works on top of Instantly, Smartlead, Apollo, etc.

Would you be open to a 20-minute audit + demo next week?

Best regards,
Vishnu
Xavira Tech Labs
Sovereign Stack

{{physical_address}}

If this is not relevant, reply "no" and I will not follow up.`
}

export function sovereignAgencyEmail1Body(): string {
  return `Hey {{FirstName}},

You run a strong lead generation / RevOps agency.

What if you could offer your clients a premium "Outbound Protection + Private AI Governance" product under your own brand?

Sovereign Stack Agency Master License - $100k one-time:
* Unlimited white-labeled deployments
* You charge clients $15k-$35k each
* We handle core licensing & backend updates

Many agencies recover the full $100k with just 5-8 clients.

Interested in seeing the white-label demo?

Best regards,
Vishnu
Xavira Tech Labs
Sovereign Stack

{{physical_address}}

If this is not relevant, reply "no" and I will not follow up.`
}

export const SOVEREIGN_STACK_DIRECT_SEQUENCE_STEPS = [
  {
    id: 'sovereign-stack-step-1',
    day: 0,
    subject: SOVEREIGN_STACK_DIRECT_SUBJECT,
    body: sovereignDirectEmail1Body(),
  },
  {
    id: 'sovereign-stack-step-2',
    day: 4,
    subject: 'Re: Your outbound + AI risk',
    body: `Hey {{FirstName}},

Following up.

We're helping outbound teams and agencies worldwide stabilize their infrastructure while adding strong AI governance - especially important in EU and India right now.

Curious - are you currently facing any deliverability drops or concerns around AI data leakage?

Happy to run a free 15-min risk check for {{Company}} if useful.

Best regards,
Vishnu
Xavira Tech Labs
Sovereign Stack

{{physical_address}}

If this is not relevant, reply "no" and I will not follow up.`,
  },
  {
    id: 'sovereign-stack-step-3',
    day: 7,
    subject: '$25k Sovereign Stack + payment plan option',
    body: `Hey {{FirstName}},

Last note on this.

We're offering the Sovereign Stack at $25,000 one-time (includes 12 months updates + deployment support).

We can also split it into 3 payments of ~$8,500 if that helps.

Would you like to see the dashboard live and get a custom risk report for your current setup?

Best regards,
Vishnu
Xavira Tech Labs
Sovereign Stack

{{physical_address}}

If this is not relevant, reply "no" and I will not follow up.`,
  },
  {
    id: 'sovereign-stack-step-4',
    day: 11,
    subject: '{{Company}} outbound infrastructure',
    body: `Hey {{FirstName}},

Still interested in protecting your outbound revenue and locking down AI usage?

No pressure - just let me know if you want the 20-min demo or if I should stop following up.

Best regards,
Vishnu
Xavira Tech Labs
Sovereign Stack

{{physical_address}}

If this is not relevant, reply "no" and I will not follow up.`,
  },
  {
    id: 'sovereign-stack-step-5',
    day: 16,
    subject: 'Final note - Sovereign Stack for {{Company}}',
    body: `Hey {{FirstName}},

Last email.

If you're planning to scale outbound this year, Sovereign Stack is one of the highest-ROI infrastructure decisions you can make right now.

Reply "DEMO" if you want to schedule a quick call.

Thanks,
Vishnu
Xavira Tech Labs
Sovereign Stack

{{physical_address}}

If this is not relevant, reply "no" and I will not follow up.`,
  },
]

export function sovereignSubjectForLead(lead: SovereignCopyLead): string {
  return inferSovereignOfferType(lead) === 'agency'
    ? SOVEREIGN_STACK_AGENCY_SUBJECT
    : SOVEREIGN_STACK_DIRECT_SUBJECT
}

export function sovereignBodyForLead(lead: SovereignCopyLead): string {
  return inferSovereignOfferType(lead) === 'agency'
    ? sovereignAgencyEmail1Body()
    : sovereignDirectEmail1Body()
}

export function renderSovereignTemplate(
  template: string,
  lead: SovereignCopyLead,
  physicalAddress: string
): string {
  const firstName = lead.first_name || lead.firstName || 'there'
  const company = lead.company || lead.companyDomain || 'your team'
  const reason =
    lead.reason_to_contact ||
    lead.reasonToContact ||
    'your team works around outbound or growth infrastructure'

  return template
    .replaceAll('{{FirstName}}', firstName)
    .replaceAll('{{Company}}', company)
    .replaceAll('{{first_name}}', firstName)
    .replaceAll('{{company}}', company)
    .replaceAll('{{reason_to_contact}}', reason)
    .replaceAll('{{physical_address}}', physicalAddress)
}
