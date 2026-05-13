import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { Queue } from 'bullmq'
import { appEnv } from '@/lib/env'

type CronLead = {
  email?: string
  first_name?: string
  firstName?: string
  company?: string
  consent_source?: string
  reason_to_contact?: string
}

type PreparedCronLead = {
  email: string
  first_name: string
  company: string
  consent_source: string
  reason_to_contact: string
}

function enabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isPlaceholderEmail(value: string): boolean {
  const email = value.toLowerCase()
  const domain = email.split('@')[1] ?? ''
  return (
    domain === 'example.com' ||
    domain === 'example.org' ||
    domain === 'example.net' ||
    domain.endsWith('.test') ||
    email.includes('placeholder') ||
    email.includes('demo@') ||
    email.includes('test@')
  )
}

function safeLimit(raw: string | null): number {
  const maxLimit = Math.max(1, Math.min(Number(process.env.OUTBOUND_CRON_MAX_LIMIT ?? 5), 25))
  const fallback = Math.max(1, Math.min(Number(process.env.OUTBOUND_CRON_LIMIT ?? 1), maxLimit))
  const parsed = Number(raw ?? fallback)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(parsed, maxLimit))
}

function parseLeads(): CronLead[] {
  const rawJson = String(process.env.OUTBOUND_CRON_LEADS_JSON || '').trim()
  if (rawJson) {
    const parsed = JSON.parse(rawJson)
    if (!Array.isArray(parsed)) throw new Error('OUTBOUND_CRON_LEADS_JSON must be an array')
    return parsed
  }

  const rawLines = String(process.env.OUTBOUND_CRON_RECIPIENTS || '').trim()
  if (!rawLines) return []

  return rawLines
    .split(/[\n,;]+/)
    .map((email) => email.trim())
    .filter(Boolean)
    .map((email) => ({
      email,
      first_name: email.split('@')[0],
      company: email.split('@')[1] ?? 'your team',
      consent_source: 'legitimate_business_interest',
      reason_to_contact: 'reviewed business outreach list',
    }))
}

function fillTemplate(template: string, lead: PreparedCronLead, physicalAddress: string): string {
  return template
    .replaceAll('{{first_name}}', lead.first_name || 'there')
    .replaceAll('{{company}}', lead.company || 'your team')
    .replaceAll('{{reason_to_contact}}', lead.reason_to_contact || 'your team works around outbound or growth infrastructure')
    .replaceAll('{{physical_address}}', physicalAddress)
}

function defaultBody(): string {
  return `Hi {{first_name}},

I came across {{company}} while researching teams with outbound or sales-led growth workflows.

Quick question: are domain reputation, Gmail/Outlook throttling, or follow-up reliability things your team watches today?

I built Sovereign Engine at Xavira Tech Labs as outbound revenue infrastructure, not a basic email tool.

It is designed to help teams run outbound through one controlled system:

- lead validation and suppression safety
- provider-aware sending lanes
- queue and worker monitoring
- autonomous follow-up sequencing
- reply and bounce visibility
- reputation controls before domains burn
- production architecture designed for 100k+ emails/day with the right SMTP/ESP and domain setup

I am offering a short walkthrough for a few outbound-heavy teams this week.

Would a short 5-minute walkthrough be useful?

Best,
Vishnu

{{physical_address}}

If this is not relevant, reply "no" and I will not follow up.`
}

function authorize(request: NextRequest): boolean {
  const expected = appEnv.cronSecret()
  const provided =
    request.headers.get('x-cron-secret') ||
    request.nextUrl.searchParams.get('secret') ||
    ''
  return Boolean(expected && provided && provided === expected)
}

export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  if (!enabled(process.env.OUTBOUND_CRON_ENABLED)) {
    return NextResponse.json({ ok: true, enabled: false, queued: 0 })
  }

  let queue: Queue | null = null
  try {
    const clientId = appEnv.defaultClientId()
    const subject = process.env.OUTBOUND_CRON_SUBJECT || 'quick question on outbound scale'
    const physicalAddress = process.env.SENDER_PHYSICAL_ADDRESS || 'Xavira Tech Labs, India'
    const template = process.env.OUTBOUND_CRON_BODY || defaultBody()
    const limit = safeLimit(request.nextUrl.searchParams.get('limit'))
    const today = new Date().toISOString().slice(0, 10)
    const seen = new Set<string>()

    const leads = parseLeads()
      .map((lead) => {
        const email = String(lead.email || '').trim().toLowerCase()
        return {
          email,
          first_name: String(lead.first_name || lead.firstName || 'there').trim(),
          company: String(lead.company || email.split('@')[1] || 'your team').trim(),
          consent_source: String(lead.consent_source || 'legitimate_business_interest').trim(),
          reason_to_contact: String(lead.reason_to_contact || 'reviewed business outreach list').trim(),
        }
      })
      .filter((lead) => {
        if (!isEmail(lead.email) || isPlaceholderEmail(lead.email)) return false
        if (seen.has(lead.email)) return false
        seen.add(lead.email)
        return Boolean(lead.consent_source || lead.reason_to_contact)
      })
      .slice(0, limit)

    if (leads.length === 0) {
      return NextResponse.json({ ok: true, enabled: true, queued: 0, skipped: 'no_approved_leads' })
    }

    const queueName = process.env.SEND_QUEUE ?? 'xv-send-queue'
    queue = new Queue(queueName, { connection: { url: appEnv.redisUrl() } })
    const jobs = leads.map((lead) => {
      const idempotencyKey = crypto
        .createHash('sha256')
        .update(`cron:${today}:${clientId}:${lead.email}:${subject}`)
        .digest('hex')
      return {
        name: 'cron_outbound_sales',
        data: {
          clientId,
          toEmail: lead.email,
          subject,
          text: fillTemplate(template, lead, physicalAddress),
          idempotencyKey,
        },
        opts: {
          jobId: idempotencyKey,
          attempts: 1,
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      }
    })

    const added = await queue.addBulk(jobs)
    return NextResponse.json({
      ok: true,
      enabled: true,
      queue: queueName,
      queued: added.length,
      limit,
      firstJobId: added[0]?.id ?? null,
      lastJobId: added.at(-1)?.id ?? null,
    })
  } catch (error) {
    console.error('[api/cron/outbound] failed', error)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  } finally {
    await queue?.close()
  }
}
