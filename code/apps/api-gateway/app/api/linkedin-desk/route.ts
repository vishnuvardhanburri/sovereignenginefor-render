import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import type { Contact } from '@/lib/db/types'
import { resolveClientId } from '@/lib/client-context'
import {
  buildLinkedInDeskQueue,
  contactToLinkedInDeskLead,
  dailyLinkedInDmTarget,
} from '@/lib/linkedin-desk'

function clampLimit(value: string | null): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return dailyLinkedInDmTarget()
  return Math.max(20, Math.min(100, Math.trunc(parsed)))
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
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

    const { queue, summary } = buildLinkedInDeskQueue(contacts.rows, dailyTarget)
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

    return NextResponse.json({ lead: contactToLinkedInDeskLead(updated) })
  } catch (error) {
    console.error('[LinkedIn Desk] Failed to update action', error)
    return NextResponse.json({ error: 'Failed to update LinkedIn action' }, { status: 500 })
  }
}
