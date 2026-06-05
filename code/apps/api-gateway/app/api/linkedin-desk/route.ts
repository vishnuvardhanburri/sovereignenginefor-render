import { NextRequest, NextResponse } from 'next/server'
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs)
    }),
  ])
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

async function insertTierOneSeedContacts(
  clientId: number,
  seeds: ReturnType<typeof tierOneLinkedInCloseSeeds>
): Promise<Contact[]> {
  if (seeds.length === 0) return []

  const emails = seeds.map((seed) => seed.email.toLowerCase())
  const emailDomains = seeds.map((seed) => seed.email.split('@')[1] ?? seed.domain)
  const companies = seeds.map((seed) => seed.company)
  const companyDomains = seeds.map((seed) => seed.domain)
  const titles = seeds.map((seed) => seed.title)
  const sources = seeds.map(() => 'tier_one_linkedin_close_seed')
  const customFields = seeds.map((seed) =>
    JSON.stringify({
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
    })
  )

  const result = await query<Contact>(
    `INSERT INTO contacts (
       client_id,
       email,
       email_domain,
       company,
       company_domain,
       title,
       source,
       custom_fields,
       enrichment,
       verification_status,
       status
     )
     SELECT
       $1,
       email,
       email_domain,
       company,
       company_domain,
       title,
       source,
       custom_fields::jsonb,
       '{}'::jsonb,
       'pending',
       'active'
     FROM UNNEST(
       $2::text[],
       $3::text[],
       $4::text[],
       $5::text[],
       $6::text[],
       $7::text[],
       $8::text[]
     ) AS t(email, email_domain, company, company_domain, title, source, custom_fields)
     ON CONFLICT (client_id, email) DO UPDATE
     SET company = COALESCE(EXCLUDED.company, contacts.company),
         company_domain = COALESCE(EXCLUDED.company_domain, contacts.company_domain),
         title = COALESCE(EXCLUDED.title, contacts.title),
         source = COALESCE(EXCLUDED.source, contacts.source),
         email_domain = COALESCE(EXCLUDED.email_domain, contacts.email_domain),
         custom_fields = COALESCE(contacts.custom_fields, '{}'::jsonb) || COALESCE(EXCLUDED.custom_fields, '{}'::jsonb),
         updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      clientId,
      emails,
      emailDomains,
      companies,
      companyDomains,
      titles,
      sources,
      customFields,
    ]
  )

  return result.rows
}

function seedToFallbackContact(
  seed: ReturnType<typeof tierOneLinkedInCloseSeeds>[number],
  index: number
): Contact {
  const now = new Date().toISOString()
  return {
    id: -10_000 - index,
    client_id: 1,
    email: seed.email,
    email_domain: seed.email.split('@')[1] ?? seed.domain,
    name: null,
    company: seed.company,
    company_domain: seed.domain,
    title: seed.title,
    timezone: null,
    source: 'tier_one_linkedin_close_fallback',
    custom_fields: {
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
      fallback_queue: true,
    },
    enrichment: null,
    verification_status: 'pending',
    verification_sub_status: null,
    status: 'active',
    unsubscribed_at: null,
    bounced_at: null,
    created_at: now,
    updated_at: now,
  }
}

function fallbackSeedQueue(dailyTarget: number) {
  return buildLinkedInDeskQueue(
    tierOneLinkedInCloseSeeds(dailyTarget).map(seedToFallbackContact),
    dailyTarget
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

  if (seedContacts.length === 0) return input.contacts

  const imported = await insertTierOneSeedContacts(input.clientId, seedContacts)

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

    const contacts = await withTimeout(query<Contact>(
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
    ), 6_000)

    if (!contacts) {
      const fallback = fallbackSeedQueue(dailyTarget)
      return NextResponse.json(fallback)
    }

    const seededContacts =
      (await withTimeout(ensureTierOneSeedInventory({
        clientId,
        contacts: contacts.rows,
        dailyTarget,
      }), 8_000)) ?? contacts.rows

    const seededQueue = buildLinkedInDeskQueue(seededContacts, dailyTarget)
    if (seededQueue.queue.length >= dailyTarget) {
      return NextResponse.json(seededQueue)
    }

    const enrichedContacts =
      (await withTimeout(enrichMissingExactLinkedInAccounts({
      clientId,
      contacts: seededContacts,
      dailyTarget,
    }), 8_000)) ?? seededContacts
    const { queue, summary } = buildLinkedInDeskQueue(enrichedContacts, dailyTarget)
    if (queue.length === 0) {
      const fallback = fallbackSeedQueue(dailyTarget)
      return NextResponse.json(fallback)
    }
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
