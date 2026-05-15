import { NextRequest, NextResponse } from 'next/server'
import { importContacts } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'
import { leadScoutToContacts, scoutOpenLeads } from '@/lib/lead-scout'

export const dynamic = 'force-dynamic'

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
    })

    const shouldImport = searchParams.get('import') === '1'
    if (!shouldImport) {
      return NextResponse.json({
        ok: true,
        clientId,
        imported: 0,
        ...result,
      })
    }

    const contacts = await importContacts(clientId, {
      contacts: leadScoutToContacts(result.leads),
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
    })

    if (!body.importContacts) {
      return NextResponse.json({
        ok: true,
        clientId,
        imported: 0,
        ...result,
      })
    }

    const contacts = await importContacts(clientId, {
      contacts: leadScoutToContacts(result.leads),
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
    })
  } catch (error) {
    console.error('[LeadScout] Failed to scout leads', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to scout leads' },
      { status: 500 }
    )
  }
}
