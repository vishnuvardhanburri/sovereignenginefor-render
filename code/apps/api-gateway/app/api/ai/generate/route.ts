import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { tryOpenRouterJson } from '@/lib/ai/openrouter'

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const action = body.action as string

    if (action === 'predict_performance') {
      const subject = String(body.subject ?? '')
      const content = String(body.content ?? '')
      const base = clamp01(Math.min(0.35, 0.12 + subject.length / 1000 + content.length / 4000))

      return NextResponse.json({
        success: true,
        data: {
          predictedOpenRate: Number((base + 0.08).toFixed(3)),
          predictedClickRate: Number((base / 3).toFixed(3)),
          predictedReplyRate: Number((base / 5).toFixed(3)),
          optimalSendTime: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString(),
          recommendedSubject: subject || 'Follow-up',
          confidence: 0.72,
          factors: ['Subject length', 'Content length', 'Historical baseline'],
        },
      })
    }

    if (action === 'smart_personalization') {
      const fallback = {
        recipientProfile: body.recipientData ?? {},
        contentStrategy: {
          tone: 'professional',
          focus: ['relevance', 'clarity'],
          valueProps: ['domain reputation protection', 'AI compliance risk reduction'],
          callToAction: 'Open to a quick infrastructure risk check?',
        },
        personalizationScore: 0.72,
        recommendedContent:
          'Short, relevant, and specific to the recipient. Lead with outbound deliverability or AI compliance risk.',
      }
      const generated = await tryOpenRouterJson({
        task: action,
        system:
          'You write compliant B2B outbound personalization for Sovereign Stack. Return JSON only. Avoid spam claims, bypass language, fake revenue, or unverifiable statements.',
        user: JSON.stringify({
          recipientData: body.recipientData ?? {},
          campaignContext: body.campaignContext ?? {},
          requiredOffer:
            'Sovereign Stack: $25k one-time license combining outbound deliverability OS and private AI security gateway.',
        }),
        fallback,
      })

      return NextResponse.json({
        success: true,
        data: {
          ...fallback,
          ...(generated.data as Record<string, unknown>),
          aiSource: generated.source,
          aiError: generated.error ?? null,
          aiModel: generated.model ?? null,
        },
      })
    }

    if (action === 'competitive_intelligence') {
      const fallback = {
        marketTrends: ['Outbound teams are prioritizing domain reputation', 'AI usage needs auditability'],
        competitorStrategies: ['Point tools focus on sequencing, not infrastructure risk'],
        industryBenchmarks: { openRate: 0.22, clickRate: 0.035, replyRate: 0.008 },
        emergingOpportunities: ['Free infrastructure risk audits', 'Agency master license packaging'],
        recommendedDifferentiators: ['One license for deliverability and AI security', 'Self-hosted audit trail'],
      }
      const generated = await tryOpenRouterJson({
        task: action,
        system:
          'You are a B2B revenue infrastructure analyst. Return JSON only. Keep claims conservative and evidence-safe.',
        user: JSON.stringify({
          company: body.company ?? body.recipientData?.company ?? null,
          industry: body.industry ?? body.campaignContext?.industry ?? null,
          offer:
            'Sovereign Stack: outbound deliverability OS plus private AI security gateway. Direct license $25k; agency master license $100k.',
        }),
        fallback,
      })

      return NextResponse.json({
        success: true,
        data: {
          ...fallback,
          ...(generated.data as Record<string, unknown>),
          aiSource: generated.source,
          aiError: generated.error ?? null,
          aiModel: generated.model ?? null,
        },
      })
    }

    if (action === 'ai_coaching') {
      const fallback = {
        coaching:
          'Keep the message problem-first: domain burn, inbox placement risk, and AI data leakage. Offer a short audit, not a hard pitch.',
        suggestions: ['Use fewer words', 'Lead with relevance', 'Mention one concrete risk'],
        warnings: ['Avoid bypass language', 'Avoid bulk-volume claims', 'Do not claim revenue without proof'],
        nextBestActions: ['Review lead evidence', 'Validate inboxes before send', 'Send only to approved contacts'],
      }
      const generated = await tryOpenRouterJson({
        task: action,
        system:
          'You coach compliant B2B outbound. Return JSON only with coaching, suggestions, warnings, and nextBestActions.',
        user: JSON.stringify({
          draft: body.draft ?? body.content ?? '',
          goal: 'Book a demo or risk audit for Sovereign Stack',
        }),
        fallback,
      })

      return NextResponse.json({
        success: true,
        data: {
          ...fallback,
          ...(generated.data as Record<string, unknown>),
          aiSource: generated.source,
          aiError: generated.error ?? null,
          aiModel: generated.model ?? null,
        },
      })
    }

    if (action === 'predict_conversion') {
      return NextResponse.json({
        success: true,
        data: {
          conversionProbability: 0.16,
          score: 16,
          factors: [{ factor: 'Engagement baseline', impact: 0.1, reason: 'Historical average' }],
          recommendedApproach: 'Personalized follow-up',
          expectedValue: 500,
        },
      })
    }

    if (action === 'optimize_campaign') {
      return NextResponse.json({
        success: true,
        data: [
          {
            type: 'test_subject',
            reason: 'Improve open rates with a tighter subject line',
            expectedImpact: 0.12,
            priority: 'high',
            data: {},
          },
        ],
      })
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('[API] ai/generate failed', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
