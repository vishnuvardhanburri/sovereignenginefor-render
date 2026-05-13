/* eslint-disable no-console */
import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Queue } from 'bullmq'
import { appEnv } from '@/lib/env'

type LeadRow = {
  email: string
  first_name: string
  company: string
  consent_source: string
  reason_to_contact: string
}

function arg(name: string): string | null {
  const idx = process.argv.findIndex((x) => x === `--${name}`)
  if (idx === -1) return null
  const value = String(process.argv[idx + 1] ?? '').trim()
  return value || null
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    const next = line[i + 1]
    if (ch === '"' && quoted && next === '"') {
      cur += '"'
      i += 1
      continue
    }
    if (ch === '"') {
      quoted = !quoted
      continue
    }
    if (ch === ',' && !quoted) {
      cells.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  cells.push(cur)
  return cells.map((cell) => cell.trim())
}

async function resolveInputPath(inputPath: string): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), inputPath),
    path.resolve(process.cwd(), '../../..', inputPath),
  ]
  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // Try the next common monorepo location.
    }
  }
  throw new Error(`Lead CSV not found. Tried: ${candidates.join(', ')}`)
}

async function readLeads(inputPath: string): Promise<LeadRow[]> {
  const raw = await fs.readFile(await resolveInputPath(inputPath), 'utf8')
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0]!).map((h) => h.toLowerCase())
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line)
    const get = (name: keyof LeadRow) => values[headers.indexOf(name)]?.trim() ?? ''
    return {
      email: get('email').toLowerCase(),
      first_name: get('first_name'),
      company: get('company'),
      consent_source: get('consent_source'),
      reason_to_contact: get('reason_to_contact'),
    }
  })
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function fillTemplate(template: string, row: LeadRow, physicalAddress: string): string {
  const firstName = row.first_name || 'there'
  const company = row.company || 'your team'
  return template
    .replaceAll('{{first_name}}', firstName)
    .replaceAll('{{company}}', company)
    .replaceAll('{{reason_to_contact}}', row.reason_to_contact || 'your team works around outbound or growth infrastructure')
    .replaceAll('{{physical_address}}', physicalAddress)
}

function defaultBody() {
  return `Hi {{first_name}},

I came across {{company}} while researching teams with outbound or sales-led growth workflows.

Quick question: are domain reputation, Gmail/Outlook throttling, or follow-up reliability things your team watches today?

I built Sovereign Engine at Xavira Tech Labs as an outbound revenue infrastructure system, not a basic email tool.

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

function requireRealSendGate(dryRun: boolean) {
  if (dryRun) return
  const blockers: string[] = []
  const smtpAccounts = appEnv.smtpAccounts()
  const hasSingleSmtp = Boolean(appEnv.smtpUser() && appEnv.smtpPass())

  if (process.env.MOCK_SMTP !== 'false') blockers.push('MOCK_SMTP must be false')
  if (!smtpAccounts.length && !hasSingleSmtp) blockers.push('SMTP_ACCOUNTS or SMTP_USER/SMTP_PASS must be configured')
  if (!process.env.SENDER_PHYSICAL_ADDRESS?.trim()) blockers.push('SENDER_PHYSICAL_ADDRESS is required')
  if (process.env.REAL_SEND_ACK !== 'consented-low-volume') {
    blockers.push('REAL_SEND_ACK must equal consented-low-volume')
  }
  if (blockers.length) {
    console.error('Real outbound blocked:')
    for (const blocker of blockers) console.error(`- ${blocker}`)
    process.exit(1)
  }
}

async function main() {
  const csv = arg('csv')
  const dryRun = hasFlag('dry-run')
  if (!csv) {
    console.error('Usage: pnpm outbound:send -- --csv docs/acquisition/OUTBOUND_CLIENTS_TEMPLATE.csv --dry-run')
    process.exit(1)
  }

  requireRealSendGate(dryRun)

  const rawLimit = Number(arg('limit') ?? '10')
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 10, 1), 50)
  const subject = arg('subject') ?? 'quick question on outbound scale'
  const bodyPath = arg('body-file')
  const bodyTemplate = bodyPath ? await fs.readFile(bodyPath, 'utf8') : defaultBody()
  const physicalAddress = process.env.SENDER_PHYSICAL_ADDRESS || 'Xavira Tech Labs'

  const leads = (await readLeads(csv))
    .filter((row) => isEmail(row.email))
    .filter((row) => row.consent_source || row.reason_to_contact)
    .slice(0, limit)

  if (!leads.length) {
    console.error('No valid leads found. Required columns: email, first_name, company, consent_source, reason_to_contact')
    process.exit(1)
  }

  console.log(`Prepared ${leads.length} lead(s). Mode: ${dryRun ? 'dry-run' : 'real-queue'}`)
  console.log(`Subject: ${subject}`)
  if (!dryRun && process.env.SEND_ALLOW_UNKNOWN_VALIDATION !== 'false') {
    console.warn('Warning: validation provider is not enforced. Keep this to tiny test batches only.')
  }

  if (dryRun) {
    const preview = leads.slice(0, 3).map((row) => ({
      to: row.email,
      subject,
      text: fillTemplate(bodyTemplate, row, physicalAddress),
    }))
    console.log(JSON.stringify({ preview }, null, 2))
    return
  }

  const queueName = process.env.SEND_QUEUE ?? 'xv-send-queue'
  const q = new Queue(queueName, { connection: { url: appEnv.redisUrl() } })
  const clientId = appEnv.defaultClientId()
  const jobs = []

  for (const row of leads) {
    const idem = crypto
      .createHash('sha256')
      .update(`sales:${clientId}:${row.email}:${subject}`)
      .digest('hex')

    jobs.push({
      name: 'outbound_sales',
      data: {
        clientId,
        toEmail: row.email,
        subject,
        text: fillTemplate(bodyTemplate, row, physicalAddress),
        idempotencyKey: idem,
      },
      opts: {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
      },
    })
  }

  const added = await q.addBulk(jobs)
  await q.close()
  console.log(
    JSON.stringify(
      {
        queue: queueName,
        enqueued: added.length,
        cappedAt: limit,
        firstJobId: added[0]?.id ?? null,
        lastJobId: added.at(-1)?.id ?? null,
      },
      null,
      2
    )
  )
}

main().catch((err) => {
  console.error('outbound:send failed', err)
  process.exit(1)
})
