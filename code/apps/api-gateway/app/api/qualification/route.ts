import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { appEnv } from '@/lib/env'
import { appendOperationalEvent, stableHash } from '@/lib/operational-events'
import { sendTelegramMessage } from '@/lib/telegram'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SOVEREIGN_CALENDAR_URL =
  process.env.SOVEREIGN_CALENDAR_URL ||
  process.env.NEXT_PUBLIC_SOVEREIGN_CALENDAR_URL ||
  'https://cal.com/vishnuvardhanburri/30min'

const option = (values: readonly [string, ...string[]]) => z.enum(values)

const qualificationSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  workEmail: z.string().trim().email().max(180),
  company: z.string().trim().min(2).max(160),
  role: z.string().trim().max(120).optional().default(''),
  website: z.string().trim().max(220).optional().default(''),
  useCase: option(['internal_operations', 'white_label', 'strategic_acquisition']),
  currentSetup: z.string().trim().min(10).max(1200),
  monthlyOutboundVolume: z.string().trim().min(1).max(80),
  painPoints: z.array(z.string().trim().max(80)).max(10).optional().default([]),
  timeline: option(['this_week', 'this_month', 'this_quarter', 'exploring']),
  decisionOwner: z.string().trim().min(2).max(180),
  commercialPath: option([
    'internal_40000',
    'white_label_160000',
    'strategic_200000_plus',
    'need_guidance',
  ]),
  preferredCallWindow: z.string().trim().min(2).max(160),
  notes: z.string().trim().max(1200).optional().default(''),
  source: z.string().trim().max(120).optional().default('book_page'),
  contactId: z.string().trim().max(80).optional().default(''),
  campaignId: z.string().trim().max(80).optional().default(''),
  websiteTrap: z.string().trim().max(200).optional().default(''),
  consent: z.boolean(),
})

type QualificationInput = z.infer<typeof qualificationSchema>

const commercialPathLabels: Record<QualificationInput['commercialPath'], string> = {
  internal_40000: '£40,000 internal enterprise license',
  white_label_160000: '£160,000 white-label commercial license',
  strategic_200000_plus: '£200,000+ strategic/acquisition path',
  need_guidance: 'Needs commercial guidance',
}

const timelineLabels: Record<QualificationInput['timeline'], string> = {
  this_week: 'This week',
  this_month: 'This month',
  this_quarter: 'This quarter',
  exploring: 'Exploring',
}

function requestIpHash(request: NextRequest): string | null {
  const raw =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    ''
  return raw ? stableHash(raw).slice(0, 16) : null
}

function cleanWebsite(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function qualificationMessage(input: QualificationInput): string {
  return [
    'Sovereign Engine qualification submitted',
    `Name: ${input.fullName}`,
    `Email: ${input.workEmail}`,
    `Company: ${input.company}`,
    input.role ? `Role: ${input.role}` : null,
    input.website ? `Website: ${input.website}` : null,
    `Path: ${commercialPathLabels[input.commercialPath]}`,
    `Timeline: ${timelineLabels[input.timeline]}`,
    `Decision owner: ${input.decisionOwner}`,
    `Preferred call: ${input.preferredCallWindow}`,
    `Monthly outbound: ${input.monthlyOutboundVolume}`,
    `Use case: ${input.useCase.replace(/_/g, ' ')}`,
    input.painPoints.length ? `Pain points: ${input.painPoints.join(', ')}` : null,
    `Setup: ${input.currentSetup}`,
    input.notes ? `Notes: ${input.notes}` : null,
    `Calendar: ${SOVEREIGN_CALENDAR_URL}`,
  ]
    .filter(Boolean)
    .join('\n')
}

async function notifyOperator(input: QualificationInput): Promise<void> {
  const botToken = appEnv.telegramBotToken()
  const chatId = process.env.TELEGRAM_CHAT_ID || ''
  if (!botToken || !chatId) return

  try {
    await sendTelegramMessage({
      botToken,
      chatId,
      parseMode: 'none',
      text: qualificationMessage(input).slice(0, 3900),
    })
  } catch (error) {
    console.error('[qualification] telegram notification failed', error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json()
    const parsed = qualificationSchema.safeParse({
      ...raw,
      painPoints: Array.isArray(raw?.painPoints) ? raw.painPoints : [],
      consent: raw?.consent === true,
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Check the required qualification fields and try again.' },
        { status: 400 }
      )
    }

    const input = {
      ...parsed.data,
      workEmail: parsed.data.workEmail.toLowerCase(),
      website: cleanWebsite(parsed.data.website),
    }

    if (input.websiteTrap) {
      return NextResponse.json({ ok: true })
    }

    if (!input.consent) {
      return NextResponse.json(
        { error: 'Please confirm the walkthrough request before submitting.' },
        { status: 400 }
      )
    }

    const clientId = appEnv.defaultClientId()
    const event = await appendOperationalEvent({
      clientId,
      eventType: 'qualification_submitted',
      aggregateType: 'deal_qualification',
      aggregateId: input.workEmail,
      actorType: 'api_key',
      actorId: 'public-book-page',
      payload: {
        fullName: input.fullName,
        workEmail: input.workEmail,
        company: input.company,
        role: input.role,
        website: input.website,
        useCase: input.useCase,
        currentSetup: input.currentSetup,
        monthlyOutboundVolume: input.monthlyOutboundVolume,
        painPoints: input.painPoints,
        timeline: input.timeline,
        decisionOwner: input.decisionOwner,
        commercialPath: input.commercialPath,
        commercialPathLabel: commercialPathLabels[input.commercialPath],
        preferredCallWindow: input.preferredCallWindow,
        notes: input.notes,
        source: input.source,
        contactId: input.contactId,
        campaignId: input.campaignId,
      },
      metadata: {
        ipHash: requestIpHash(request),
        userAgent: request.headers.get('user-agent')?.slice(0, 240) || null,
        referrer: request.headers.get('referer')?.slice(0, 500) || null,
      },
    })

    void notifyOperator(input)

    return NextResponse.json({
      ok: true,
      id: event.id,
      calendarUrl: SOVEREIGN_CALENDAR_URL,
      message: 'Qualification received. The operator has the call packet.',
    })
  } catch (error) {
    console.error('[qualification] submit failed', error)
    return NextResponse.json({ error: 'Qualification submit failed' }, { status: 500 })
  }
}
