import { NextRequest, NextResponse } from 'next/server'
import { importContacts } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'
import {
  scrapePublicBusinessEmails,
  type LinkedInOfferMode,
} from '@/lib/linkedin-desk'

function normalizeOfferMode(value: unknown): LinkedInOfferMode {
  const mode = String(value ?? 'auto').trim().toLowerCase()
  if (mode === 'agency' || mode === 'direct') return mode
  return 'auto'
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const clientId = await resolveClientId({
      body,
      headers: request.headers,
    })
    const targets = String(body.targets ?? body.input ?? '').trim()
    const importFound = body.importFound !== false
    const offerMode = normalizeOfferMode(body.offerMode)

    if (!targets) {
      return NextResponse.json({ error: 'targets is required' }, { status: 400 })
    }

    const scrape = await scrapePublicBusinessEmails(targets, offerMode)
    const imported =
      importFound && scrape.found.length > 0
        ? await importContacts(clientId, {
            contacts: scrape.found.map((result) => ({
              email: result.email,
              company: result.company,
              companyDomain: result.domain,
              source: 'linkedin_manual_public_email_scrape',
              customFields: {
                close_channel: 'linkedin_email',
                email_evidence: 'public_website_scrape',
                public_evidence_url: result.sourceUrl,
                linkedin_url: result.linkedinUrl,
                offer_type: result.offerType,
                sovereign_offer_type: result.offerType,
                linkedin_dm_status: 'new',
                scraped_for_linkedin_close: true,
              },
            })),
            verify: false,
            enrich: false,
            dedupeByDomain: false,
          })
        : []

    return NextResponse.json({
      ...scrape,
      imported: imported.length,
      importFound,
    })
  } catch (error) {
    console.error('[LinkedIn Desk] Public email scrape failed', error)
    return NextResponse.json({ error: 'Failed to scrape public emails' }, { status: 500 })
  }
}
