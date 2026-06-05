import { NextRequest, NextResponse } from 'next/server'
import { importContacts } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'
import { leadScoutToContacts, scoutOpenLeads, verifyOpenLeadEvidenceTimeboxed } from '@/lib/lead-scout'
import { normalizePayingMarketRegion } from '@/lib/target-market'

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
  const raw = process.env[name]?.trim()
  const value = Number(raw || fallback)
  return Number.isFinite(value) ? value : fallback
}

function numberFromParam(request: NextRequest, names: string[], envName: string, fallback: number): number {
  for (const name of names) {
    const raw = request.nextUrl.searchParams.get(name)?.trim()
    if (!raw) continue
    const parsed = Number(raw)
    if (Number.isFinite(parsed)) return parsed
  }
  return numberFromEnv(envName, fallback)
}

function leadScoutOffset(limit: number): number {
  const rotationMinutes = Math.min(Math.max(numberFromEnv('LEAD_SCOUT_ROTATION_MINUTES', 60), 15), 1440)
  const windowMs = rotationMinutes * 60_000
  return Math.floor(Date.now() / windowMs) * limit
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
    const limit = Math.min(Math.max(numberFromEnv('LEAD_SCOUT_DAILY_LIMIT', 250), 1), 1_000)
    const offset = leadScoutOffset(limit)

    const result = scoutOpenLeads({
      industry: request.nextUrl.searchParams.get('industry') || pickIndustry(),
      region: normalizePayingMarketRegion(
        request.nextUrl.searchParams.get('region') || process.env.LEAD_SCOUT_REGION || 'United States'
      ),
      persona: request.nextUrl.searchParams.get('persona') || process.env.LEAD_SCOUT_PERSONA || 'founder',
      limit,
      offset,
    })

    const verifiedLeads = await verifyOpenLeadEvidenceTimeboxed(result.leads, {
      deadlineMs: Math.max(
        5_000,
        Math.min(
          numberFromParam(
            request,
            ['leadScoutEvidenceDeadlineMs', 'evidenceDeadlineMs'],
            'LEAD_SCOUT_EVIDENCE_DEADLINE_MS',
            25_000
          ),
          55_000
        )
      ),
      maxPagesPerLead: Math.max(
        3,
        Math.min(
          numberFromParam(
            request,
            ['leadScoutEvidenceMaxPages', 'evidenceMaxPages'],
            'LEAD_SCOUT_EVIDENCE_MAX_PAGES',
            8
          ),
          12
        )
      ),
      requestTimeoutMs: Math.max(
        800,
        Math.min(
          numberFromParam(
            request,
            ['leadScoutEvidenceRequestTimeoutMs', 'evidenceRequestTimeoutMs'],
            'LEAD_SCOUT_EVIDENCE_REQUEST_TIMEOUT_MS',
            2_000
          ),
          4_000
        )
      ),
    })
    const importUnverified = String(process.env.LEAD_SCOUT_IMPORT_UNVERIFIED || '').toLowerCase() === 'true'
    const importableLeads = importUnverified
      ? verifiedLeads
      : verifiedLeads.filter((lead) => lead.autoApprovalEligible)
    const contacts = await importContacts(clientId, {
      contacts: leadScoutToContacts(importableLeads),
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
      verifiedEvidenceCount: importableLeads.length,
      blockedUnverified: verifiedLeads.length - importableLeads.length,
      guardrails: result.guardrails,
    })
  } catch (error) {
    console.error('[LeadScoutCron] Failed', error)
    return NextResponse.json({ ok: false, error: 'Lead scout cron failed' }, { status: 500 })
  }
}
