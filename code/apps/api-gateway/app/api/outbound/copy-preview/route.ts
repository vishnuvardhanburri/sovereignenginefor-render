import { NextRequest, NextResponse } from 'next/server'
import {
  buildSovereignCopyForLead,
  inferSovereignOfferType,
  sovereignDealValueUsd,
  type SovereignCopyLead,
} from '@/lib/outbound-copy'
import { xaviraAiConfigured } from '@/lib/ai/xavira-ai'
import { commercialDealLabel } from '@/lib/commercial-model'

type PreviewLead = SovereignCopyLead & {
  label: string
}

const sampleLeads: PreviewLead[] = [
  {
    label: '£5,000 Campaign Rescue Sprint',
    first_name: 'there',
    company: 'GrowthOps AI',
    companyDomain: 'growthops.ai',
    title: 'founder',
    reason_to_contact:
      'GrowthOps AI appears to run outbound workflows where reply quality, follow-up ownership, and sender risk matter.',
    customFields: {
      offer_type: 'direct',
      research_summary:
        'Relevant to campaign rescue, reply blockers, and practical outbound fixes.',
    },
  },
  {
    label: '£3,000/month Control Partner',
    first_name: 'there',
    company: 'Northstar RevOps',
    companyDomain: 'northstarrevops.com',
    title: 'agency founder',
    reason_to_contact:
      'Northstar RevOps looks like a growth agency that needs client-facing proof when outbound campaigns underperform.',
    customFields: {
      offer_type: 'agency',
      industry: 'growth marketing agency',
      research_summary:
        'Agency lead; start with a £5,000 rescue sprint, then only discuss monthly partner support after proof.',
    },
  },
]

function envEnabled(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

export async function GET(request: NextRequest) {
  const useAiPreview = request.nextUrl.searchParams.get('ai') === '1'
  const physicalAddress = process.env.SENDER_PHYSICAL_ADDRESS || 'Xavira Tech Labs, India'

  try {
    const previews = await Promise.all(
      sampleLeads.map(async (lead) => {
        const rendered = await buildSovereignCopyForLead(lead, {
          physicalAddress,
          useXaviraAi: useAiPreview,
        })
        const offerType = inferSovereignOfferType(lead)

        return {
          label: lead.label,
          offerType,
          dealValueUsd: sovereignDealValueUsd(lead),
          dealValueGbp: sovereignDealValueUsd(lead),
          dealValueLabel: commercialDealLabel(offerType),
          company: lead.company,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          source: rendered.source,
          error: rendered.error ?? null,
        }
      })
    )

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      aiPreview: useAiPreview,
      aiPersonalizationConfigured:
        xaviraAiConfigured() &&
          envEnabled(
            process.env.OUTBOUND_XAVIRA_AI_COPY,
            envEnabled(process.env.OUTBOUND_OPENROUTER_COPY, true)
          ),
      retentionPolicy:
        'Recent sent-event bodies are retained for operator proof and sales review, then redacted by the outbound retention policy.',
      previews,
    })
  } catch (error) {
    console.error('[api/outbound/copy-preview] failed', error)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}
