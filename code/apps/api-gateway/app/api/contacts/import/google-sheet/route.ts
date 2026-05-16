import { NextRequest, NextResponse } from 'next/server'
import { importContacts } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'
import { buildGoogleSheetCsvUrl, prepareSheetContacts } from '@/lib/sheet-import'
import { notifyTelegramEvent } from '@/lib/telegram-notifications'

function bool(value: unknown): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase())
}

async function importFromSheet(request: NextRequest, dryRun: boolean) {
  const body = request.method === 'GET' ? {} : await request.json().catch(() => ({}))
  const params = request.nextUrl.searchParams
  const sheetUrl = String((body as any).sheetUrl ?? params.get('sheetUrl') ?? '').trim()
  const gid = (body as any).gid ?? params.get('gid') ?? undefined
  const limit = Number((body as any).limit ?? params.get('limit') ?? 100)
  const dedupeByDomain =
    typeof (body as any).dedupeByDomain === 'boolean'
      ? (body as any).dedupeByDomain
      : bool(params.get('dedupeByDomain'))

  if (!sheetUrl) {
    return NextResponse.json(
      { ok: false, error: 'sheetUrl is required' },
      { status: 400 }
    )
  }

  const clientId = await resolveClientId({
    body: body as any,
    headers: request.headers,
    searchParams: params,
  })
  const csvUrl = buildGoogleSheetCsvUrl(sheetUrl, gid)
  const response = await fetch(csvUrl, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Could not read Google Sheet CSV export',
        detail: `Google returned ${response.status}. Make sure the sheet is shared as "Anyone with the link can view".`,
      },
      { status: 400 }
    )
  }

  const csv = await response.text()
  if (/<!doctype html|<html/i.test(csv.slice(0, 500))) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Google Sheet did not return CSV',
        detail: 'Open Share in Google Sheets and set General access to "Anyone with the link can view".',
      },
      { status: 400 }
    )
  }

  const prepared = prepareSheetContacts(csv, {
    sourceUrl: sheetUrl,
    limit,
    dedupeByDomain,
  })

  const imported = dryRun
    ? []
    : await importContacts(clientId, {
        contacts: prepared.contacts,
        verify: false,
        enrich: false,
        dedupeByDomain,
      })

  if (!dryRun) {
    void notifyTelegramEvent({
      type: 'sheet_import',
      imported: imported.length,
      prepared: prepared.contacts.length,
      rejected: prepared.rejected.length,
      evidenceBacked: prepared.summary.evidenceBacked,
      sheetUrl,
    })
  }

  return NextResponse.json({
    ok: true,
    clientId,
    dryRun,
    csvUrl,
    imported: imported.length,
    contacts: imported,
    prepared: prepared.contacts.length,
    rejected: prepared.rejected,
    summary: prepared.summary,
    guardrails: [
      'Personal/free-mailbox domains are rejected',
      'Blocked inboxes like support/legal/security/careers are rejected',
      'Imported contacts remain not_approved until operator review',
      'Rows with evidence/source URLs become approval-eligible; rows without evidence stay manual-review only',
    ],
  })
}

export async function POST(request: NextRequest) {
  try {
    return await importFromSheet(request, false)
  } catch (error) {
    console.error('[API] Google Sheet import failed', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to import Google Sheet' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    return await importFromSheet(request, true)
  } catch (error) {
    console.error('[API] Google Sheet preview failed', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to preview Google Sheet' },
      { status: 500 }
    )
  }
}
