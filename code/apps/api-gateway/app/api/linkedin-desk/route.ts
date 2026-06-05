import { NextRequest, NextResponse } from 'next/server'
import { importContacts } from '@/lib/backend'
import { query, queryOne } from '@/lib/db'
import type { Contact } from '@/lib/db/types'
import { resolveClientId } from '@/lib/client-context'
import {
  buildLinkedInDeskQueue,
  contactToLinkedInDeskAccount,
  dailyLinkedInDmTarget,
  findExactLinkedInAccountUrl,
  tierOneLinkedInCloseSeeds,
} from '@/lib/linkedin-desk'
import { isTargetPayingMarketLead } from '@/lib/target-market'

function clampLimit(value: string | null): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return dailyLinkedInDmTarget()
  return Math.max(34, Math.min(100, Math.trunc(parsed)))
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function exactLookupBatchSize(): number {
  const parsed = Number(process.env.LINKEDIN_EXACT_ACCOUNT_LOOKUP_BATCH ?? 12)
  if (!Number.isFinite(parsed)) return 12
  return Math.max(0, Math.min(25, Math.trunc(parsed)))
}

function contactDomain(contact: Contact): string {
  return contact.company_domain || contact.email.split('@')[1] || ''
}

function contactLinkedInUrl(contact: Contact): string {
  return String(
    contact.custom_fields?.linkedin_url ||
      contact.custom_fields?.company_linkedin_url ||
      contact.custom_fields?.linkedin_exact_account_url ||
      ''
  )
}

function isEligibleForToday(contact: Contact): boolean {
  const custom = contact.custom_fields ?? {}
  return (
    contact.status === 'active' &&
    String(custom.send_status ?? '') !== 'blocked' &&
    String(custom.linkedin_dm_status ?? '') !== 'blocked' &&
    String(custom.linkedin_dm_last_sent_date ?? '') !== todayIsoDate()
  )
}

async function enrichMissingExactLinkedInAccounts(input: {
  clientId: number
  contacts: Contact[]
  dailyTarget: number
}): Promise<Contact[]> {
  const initial = buildLinkedInDeskQueue(input.contacts, input.dailyTarget)
  if (initial.queue.length >= input.dailyTarget) return input.contacts

  const batchSize = exactLookupBatchSize()
  if (batchSize <= 0) return input.contacts

  const candidates = input.contacts
    .filter((contact) => contact.status === 'active')
    .filter((contact) => !contactToLinkedInDeskAccount(contact).linkedinUrl)
    .filter((contact) =>
      isTargetPayingMarketLead({
        email: contact.email,
        domain: contact.company_domain,
        company: contact.company,
        title: contact.title,
        source: contact.source,
        customFields: contact.custom_fields,
      })
    )
    .filter((contact) => Boolean(contact.company || contactDomain(contact)))
    .slice(0, batchSize)

  if (candidates.length === 0) return input.contacts

  const found = await Promise.all(
    candidates.map(async (contact) => {
      const linkedinUrl = await findExactLinkedInAccountUrl({
        company: contact.company || '',
        domain: contactDomain(contact),
      })
      if (!linkedinUrl) return null

      const patch = {
        linkedin_url: linkedinUrl,
        company_linkedin_url: linkedinUrl,
        linkedin_exact_account_url: linkedinUrl,
        linkedin_exact_lookup_at: new Date().toISOString(),
        linkedin_exact_lookup_source: 'public_search',
        target_market: true,
      }

      await query(
        `UPDATE contacts
         SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $3::jsonb,
             updated_at = CURRENT_TIMESTAMP
         WHERE client_id = $1
           AND id = $2`,
        [input.clientId, contact.id, JSON.stringify(patch)]
      )

      return { id: contact.id, patch }
    })
  )

  const patchesById = new Map(found.filter(Boolean).map((result) => [result!.id, result!.patch]))
  if (patchesById.size === 0) return input.contacts

  return input.contacts.map((contact) => {
    const patch = patchesById.get(contact.id)
    if (!patch) return contact
    return {
      ...contact,
      custom_fields: {
        ...(contact.custom_fields ?? {}),
        ...patch,
      },
    }
  })
}

async function ensureTierOneSeedInventory(input: {
  clientId: number
  contacts: Contact[]
  dailyTarget: number
}): Promise<Contact[]> {
  const current = buildLinkedInDeskQueue(input.contacts, input.dailyTarget)
  if (current.queue.length >= input.dailyTarget) return input.contacts

  const existing = new Set<string>()
  for (const contact of input.contacts) {
    existing.add(contact.email.toLowerCase())
    const linkedinUrl = contactLinkedInUrl(contact).toLowerCase()
    if (linkedinUrl) existing.add(linkedinUrl)
  }

  const shortfall = input.dailyTarget - current.queue.length
  const seedContacts = tierOneLinkedInCloseSeeds(input.dailyTarget + 12)
    .filter((seed) => !existing.has(seed.email.toLowerCase()))
    .filter((seed) => !existing.has(seed.linkedinUrl.toLowerCase()))
    .slice(0, Math.max(shortfall, input.dailyTarget))
    .map((seed) => ({
      email: seed.email,
      company: seed.company,
      companyDomain: seed.domain,
      title: seed.title,
      source: 'tier_one_linkedin_close_seed',
      customFields: {
        linkedin_first_seed: true,
        close_channel: 'linkedin_manual',
        target_market: true,
        target_region: 'us_foreign_paying_market',
        region: seed.region,
        website_url: seed.websiteUrl,
        public_evidence_url: seed.websiteUrl,
        research_evidence_url: seed.websiteUrl,
        linkedin_url: seed.linkedinUrl,
        company_linkedin_url: seed.linkedinUrl,
        linkedin_exact_account_url: seed.linkedinUrl,
        offer_type: seed.offerType,
        sovereign_offer_type: seed.offerType,
        approval_required: true,
        email_evidence: 'role_pattern_needs_public_verification',
        contact_role: seed.title,
        confidence: 'medium',
        close_score_override: seed.closeScore,
        public_signals: seed.publicSignals,
        research_summary: seed.reason,
        reason_to_contact: seed.reason,
      },
    }))

  if (seedContacts.length === 0) return input.contacts

  const imported = await importContacts(input.clientId, {
    contacts: seedContacts,
    verify: false,
    enrich: false,
    dedupeByDomain: false,
  })

  return [...input.contacts, ...imported.filter(isEligibleForToday)]
}

function patchForAction(action: string, notes: string): Record<string, unknown> {
  const now = new Date().toISOString()
  if (action === 'dm_sent') {
    return {
      linkedin_dm_status: 'sent',
      linkedin_dm_last_sent_at: now,
      linkedin_dm_last_sent_date: todayIsoDate(),
      linkedin_dm_last_action_at: now,
      linkedin_dm_notes: notes,
    }
  }
  if (action === 'interested') {
    return {
      linkedin_dm_status: 'interested',
      linkedin_dm_last_action_at: now,
      linkedin_dm_notes: notes,
    }
  }
  if (action === 'skipped') {
    return {
      linkedin_dm_status: 'skipped',
      linkedin_dm_last_action_at: now,
      linkedin_dm_notes: notes,
    }
  }
  if (action === 'blocked') {
    return {
      linkedin_dm_status: 'blocked',
      linkedin_dm_last_action_at: now,
      linkedin_dm_notes: notes,
    }
  }
  return {
    linkedin_dm_status: 'new',
    linkedin_dm_last_action_at: now,
    linkedin_dm_notes: notes,
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const clientId = await resolveClientId({
      searchParams,
      headers: request.headers,
    })
    const dailyTarget = clampLimit(searchParams.get('dailyTarget'))
    const fetchLimit = Math.max(dailyTarget * 6, 160)
    const today = todayIsoDate()

    const contacts = await query<Contact>(
      `SELECT c.*
       FROM contacts c
       WHERE c.client_id = $1
         AND c.status = 'active'
         AND COALESCE(c.custom_fields->>'send_status', '') <> 'blocked'
         AND COALESCE(c.custom_fields->>'linkedin_dm_status', '') <> 'blocked'
         AND COALESCE(c.custom_fields->>'linkedin_dm_last_sent_date', '') <> $2
       ORDER BY
         CASE WHEN COALESCE(c.custom_fields, '{}'::jsonb) ? 'linkedin_url' THEN 0 ELSE 1 END,
         CASE WHEN COALESCE(c.custom_fields->>'send_status', '') = 'approved' THEN 0 ELSE 1 END,
         c.created_at DESC
       LIMIT $3`,
      [clientId, today, fetchLimit]
    )

    const enrichedContacts = await enrichMissingExactLinkedInAccounts({
      clientId,
      contacts: contacts.rows,
      dailyTarget,
    })
    const seededContacts = await ensureTierOneSeedInventory({
      clientId,
      contacts: enrichedContacts,
      dailyTarget,
    })
    const { queue, summary } = buildLinkedInDeskQueue(seededContacts, dailyTarget)
    return NextResponse.json({ queue, summary })
  } catch (error) {
    console.error('[LinkedIn Desk] Failed to build queue', error)
    return NextResponse.json({ error: 'Failed to build LinkedIn DM queue' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const clientId = await resolveClientId({
      body,
      headers: request.headers,
    })
    const contactId = Number(body.contactId)
    const action = String(body.action ?? '').trim()
    const notes = String(body.notes ?? '').trim().slice(0, 1000)

    if (!Number.isFinite(contactId) || contactId <= 0) {
      return NextResponse.json({ error: 'contactId is required' }, { status: 400 })
    }

    const patch = patchForAction(action, notes)
    const updated = await queryOne<Contact>(
      `UPDATE contacts
       SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $3::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1
         AND id = $2
       RETURNING *`,
      [clientId, contactId, JSON.stringify(patch)]
    )

    if (!updated) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    return NextResponse.json({ account: contactToLinkedInDeskAccount(updated) })
  } catch (error) {
    console.error('[LinkedIn Desk] Failed to update action', error)
    return NextResponse.json({ error: 'Failed to update LinkedIn action' }, { status: 500 })
  }
}
