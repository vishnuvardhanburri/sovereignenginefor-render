import { NextRequest, NextResponse } from 'next/server'
import { resolveClientId } from '@/lib/client-context'
import { queryOne } from '@/lib/db'
import { buildProductionReadinessReport } from '@/lib/setup-readiness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ZipEntry = {
  name: string
  content: string
}

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return value >>> 0
})

function crc32(buffer: Buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980)
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { dosDate, dosTime }
}

function u16(value: number) {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16LE(value)
  return buffer
}

function u32(value: number) {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value >>> 0)
  return buffer
}

function createZip(entries: ZipEntry[]) {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  const { dosDate, dosTime } = dosDateTime()

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const content = Buffer.from(entry.content, 'utf8')
    const crc = crc32(content)

    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(dosTime),
      u16(dosDate),
      u32(crc),
      u32(content.length),
      u32(content.length),
      u16(name.length),
      u16(0),
      name,
    ])

    localParts.push(localHeader, content)

    const centralHeader = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(dosTime),
      u16(dosDate),
      u32(crc),
      u32(content.length),
      u32(content.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ])
    centralParts.push(centralHeader)
    offset += localHeader.length + content.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const localFiles = Buffer.concat(localParts)
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDirectory.length),
    u32(localFiles.length),
    u16(0),
  ])

  return Buffer.concat([localFiles, centralDirectory, end])
}

function lines(values: Array<string | number | null | undefined>) {
  return values.map((value) => String(value ?? '')).join('\n')
}

async function metricCount(sql: string, params: unknown[]) {
  const row = await queryOne<{ count: string | number }>(sql, params).catch(() => null)
  return Number(row?.count ?? 0)
}

export async function GET(request: NextRequest) {
  try {
    const clientId = await resolveClientId({
      searchParams: request.nextUrl.searchParams,
      headers: request.headers,
    })
    const domain = request.nextUrl.searchParams.get('domain') || 'sovereign-demo.example'
    const report = await buildProductionReadinessReport({ domain })
    const [domains, lanes, events24h, audit24h, contacts] = await Promise.all([
      metricCount(`SELECT COUNT(*) AS count FROM domains WHERE client_id = $1`, [clientId]),
      metricCount(`SELECT COUNT(*) AS count FROM reputation_state WHERE client_id = $1`, [clientId]),
      metricCount(`SELECT COUNT(*) AS count FROM reputation_events WHERE client_id = $1 AND created_at >= now() - INTERVAL '24 hours'`, [clientId]),
      metricCount(`SELECT COUNT(*) AS count FROM audit_logs WHERE client_id = $1 AND timestamp_utc >= now() - INTERVAL '24 hours'`, [clientId]),
      metricCount(`SELECT COUNT(*) AS count FROM contacts WHERE client_id = $1`, [clientId]),
    ])

    const readinessActions = report.nextActions.length ? report.nextActions.map((item) => `- ${item}`).join('\n') : '- No readiness blockers.'
    const dnsRecords = report.sections
      .flatMap((section) => section.checks)
      .filter((check) => check.suggestedRecord)
      .map((check) => {
        const record = check.suggestedRecord!
        return `${check.label}: ${record.type} ${record.host}${record.priority ? ` priority ${record.priority}` : ''} = ${record.value}`
      })
      .join('\n')

    const entries: ZipEntry[] = [
      {
        name: '00_EXECUTIVE_SUMMARY.md',
        content: lines([
          '# Sovereign Engine Data Room',
          '',
          `Generated UTC: ${new Date().toISOString()}`,
          `Client ID: ${clientId}`,
          `Readiness: ${report.status} (${report.score}/100)`,
          '',
          'Sovereign Engine is packaged as a demo-safe deliverability operating system with a dashboard, adaptive reputation lanes, worker heartbeats, audit trails, Docker orchestration, and production setup checks.',
          '',
          'Safe buyer posture: demo-ready immediately, production-ready after the buyer connects their own DNS, SMTP/ESP, and compliance assets. Xavira-owned validation is built in.',
        ]),
      },
      {
        name: '01_PROOF_METRICS.md',
        content: lines([
          '# Proof Metrics',
          '',
          `Domains tracked: ${domains}`,
          `Reputation lanes tracked: ${lanes}`,
          `Contacts loaded: ${contacts}`,
          `Reputation events in last 24h: ${events24h}`,
          `Audit actions in last 24h: ${audit24h}`,
          '',
          'Live proof endpoints:',
          '- /api/health/stats',
          '- /api/setup/readiness?domain=sovereign-demo.example',
          '- /api/due-diligence/report?domain=sovereign-demo.example',
          '- /api/activity/replay',
        ]),
      },
      {
        name: '02_BUYER_INPUTS.md',
        content: lines([
          '# Buyer Inputs',
          '',
          '- VPS/cloud host or container platform.',
          '- Dashboard domain with HTTPS.',
          '- Sending domains and DNS access.',
          '- SMTP or ESP credentials from a compliant provider.',
          '- Xavira-owned validation is built in; external validation keys are not required.',
          '- Consent-aware contact data and suppression policy.',
          '- Physical mailing address and unsubscribe policy where required.',
        ]),
      },
      {
        name: '03_SETUP_COMMANDS.md',
        content: lines([
          '# Setup Commands',
          '',
          '```bash',
          'cp .env.example .env',
          'bash setup.sh',
          'docker compose -f docker-compose.prod.yml up -d --build',
          'pnpm db:init',
          'pnpm public-api-key:create -- --name buyer-demo --tier pro',
          'MOCK_SMTP=true MOCK_SMTP_FASTLANE=true SENDER_WORKER_CONCURRENCY=50 pnpm worker:sender',
          'STRESS_COUNT=10000 STRESS_TIMEOUT_MS=60000 pnpm stress:test',
          '```',
        ]),
      },
      {
        name: '04_DNS_SUGGESTIONS.md',
        content: lines(['# DNS Suggestions', '', dnsRecords || 'No DNS suggestions generated.']),
      },
      {
        name: '05_READINESS_NEXT_ACTIONS.md',
        content: lines(['# Readiness Next Actions', '', readinessActions]),
      },
      {
        name: '06_SECURITY_CONTROLS.md',
        content: lines([
          '# Security Controls',
          '',
          '- Tamper-evident SHA-256 audit chain for privileged actions.',
          '- Sensitive value masking before logs or dashboard events.',
          '- Demo mode uses reserved .example data and mock-safe sending.',
          '- Production sending requires buyer-owned domains and provider credentials.',
          '- Health Oracle surfaces DB, Redis, queue, worker, and delivery latency.',
        ]),
      },
    ]

    return new NextResponse(createZip(entries), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="sovereign-engine-data-room.zip"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[api/handoff/data-room] failed', error)
    return NextResponse.json({ ok: false, error: 'Failed to build data room bundle' }, { status: 500 })
  }
}
