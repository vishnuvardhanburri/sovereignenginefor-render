import { NextRequest, NextResponse } from 'next/server'
import { importContacts } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'
import { leadScoutToContacts, scoutOpenLeads } from '@/lib/lead-scout'

export const dynamic = 'force-dynamic'

function isAuthorized(request: NextRequest): boolean {
  const configured = process.env.CRON_SECRET
  if (!configured) return false
  const supplied =
    request.headers.get('x-cron-secret') ||
    request.nextUrl.searchParams.get('secret') ||
    ''
  return supplied === configured
}

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)
  return Number.isFinite(value) ? value : fallback
}

function pickIndustry(): string {
  const industries = String(process.env.LEAD_SCOUT_INDUSTRIES || process.env.LEAD_SCOUT_INDUSTRY || 'saas')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  if (industries.length <= 1) return industries[0] || 'saas'

  const day = Math.floor(Date.now() / 86_400_000)
  return industries[day % industries.length]
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized cron' }, { status: 401 })
    }

    const enabled = String(process.env.LEAD_SCOUT_ENABLED || '').toLowerCase() === 'true'
    if (!enabled) {
      return NextResponse.json({
        ok: true,
        enabled: false,
        message: 'Lead scout cron is disabled. Set LEAD_SCOUT_ENABLED=true to activate.',
      })
    }

    const clientId = await resolveClientId({
      searchParams: request.nextUrl.searchParams,
      headers: request.headers,
    })
    const day = Math.floor(Date.now() / 86_400_000)
    const limit = Math.min(Math.max(numberFromEnv('LEAD_SCOUT_DAILY_LIMIT', 25), 1), 100)
    const offset = day * limit

    const result = scoutOpenLeads({
      industry: request.nextUrl.searchParams.get('industry') || pickIndustry(),
      region: request.nextUrl.searchParams.get('region') || process.env.LEAD_SCOUT_REGION || 'global',
      persona: request.nextUrl.searchParams.get('persona') || process.env.LEAD_SCOUT_PERSONA || 'founder',
      limit,
      offset,
    })

    const contacts = await importContacts(clientId, {
      contacts: leadScoutToContacts(result.leads),
      verify: false,
      enrich: false,
      dedupeByDomain: true,
    })

    return NextResponse.json({
      ok: true,
      enabled: true,
      clientId,
      imported: contacts.length,
      model: result.model,
      industry: result.industry,
      persona: result.persona,
      region: result.region,
      leadCount: result.leads.length,
      guardrails: result.guardrails,
    })
  } catch (error) {
    console.error('[LeadScoutCron] Failed', error)
    return NextResponse.json({ ok: false, error: 'Lead scout cron failed' }, { status: 500 })
  }
}
