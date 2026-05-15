import { NextRequest, NextResponse } from 'next/server'
import { importContacts } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'
import { leadScoutToContacts, scoutOpenLeads, verifyOpenLeadEvidence } from '@/lib/lead-scout'

export const dynamic = 'force-dynamic'

function filterImportableLeads<T extends { autoApprovalEligible?: boolean }>(
  leads: T[],
  includeUnverified: boolean
) {
  return includeUnverified ? leads : leads.filter((lead) => lead.autoApprovalEligible)
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const clientId = await resolveClientId({
      searchParams,
      headers: request.headers,
    })

    const result = scoutOpenLeads({
      industry: searchParams.get('industry') ?? undefined,
      region: searchParams.get('region') ?? undefined,
      persona: searchParams.get('persona') ?? undefined,
      limit: Number(searchParams.get('limit') ?? 25),
      offset: Number(searchParams.get('offset') ?? 0),
    })

    const verifiedLeads = await verifyOpenLeadEvidence(result.leads)
    const shouldImport = searchParams.get('import') === '1'
    const includeUnverified = searchParams.get('include_unverified') === '1'
    if (!shouldImport) {
      return NextResponse.json({
        ok: true,
        clientId,
        imported: 0,
        ...result,
        leads: verifiedLeads,
        verifiedEvidenceCount: verifiedLeads.filter((lead) => lead.autoApprovalEligible).length,
      })
    }

    const importableLeads = filterImportableLeads(verifiedLeads, includeUnverified)
    const contacts = await importContacts(clientId, {
      contacts: leadScoutToContacts(importableLeads),
      verify: false,
      enrich: false,
      dedupeByDomain: true,
    })

    return NextResponse.json({
      ok: true,
      clientId,
      imported: contacts.length,
      contacts,
      ...result,
      leads: verifiedLeads,
      verifiedEvidenceCount: importableLeads.length,
      blockedUnverified: verifiedLeads.length - importableLeads.length,
    })
  } catch (error) {
    console.error('[LeadScout] Failed to scout leads', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to scout leads' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const clientId = await resolveClientId({
      body,
      headers: request.headers,
    })

    const result = scoutOpenLeads({
      industry: body.industry,
      region: body.region,
      persona: body.persona,
      limit: body.limit,
      offset: body.offset,
    })

    const verifiedLeads = await verifyOpenLeadEvidence(result.leads)
    if (!body.importContacts) {
      return NextResponse.json({
        ok: true,
        clientId,
        imported: 0,
        ...result,
        leads: verifiedLeads,
        verifiedEvidenceCount: verifiedLeads.filter((lead) => lead.autoApprovalEligible).length,
      })
    }

    const importableLeads = filterImportableLeads(verifiedLeads, Boolean(body.includeUnverified))
    const contacts = await importContacts(clientId, {
      contacts: leadScoutToContacts(importableLeads),
      verify: false,
      enrich: false,
      dedupeByDomain: true,
    })

    return NextResponse.json({
      ok: true,
      clientId,
      imported: contacts.length,
      contacts,
      ...result,
      leads: verifiedLeads,
      verifiedEvidenceCount: importableLeads.length,
      blockedUnverified: verifiedLeads.length - importableLeads.length,
    })
  } catch (error) {
    console.error('[LeadScout] Failed to scout leads', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to scout leads' },
      { status: 500 }
    )
  }
}
