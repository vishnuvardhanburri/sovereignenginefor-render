import type { ContactInput } from './backend'

export type SheetRejectedLead = {
  row: number
  email: string
  reason: string
}

export type PreparedSheetImport = {
  contacts: ContactInput[]
  rejected: SheetRejectedLead[]
  summary: {
    rows: number
    valid: number
    rejected: number
    evidenceBacked: number
  }
}

const PERSONAL_EMAIL_DOMAINS = new Set([
  'aol.com',
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mail.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'yahoo.com',
  'yandex.com',
])

const BLOCKED_MAILBOX_PREFIXES = new Set([
  'abuse',
  'admin',
  'billing',
  'career',
  'careers',
  'compliance',
  'donotreply',
  'finance',
  'hr',
  'invoice',
  'invoices',
  'jobs',
  'legal',
  'no-reply',
  'noreply',
  'postmaster',
  'privacy',
  'security',
  'support',
  'webmaster',
])

const SAFE_BUSINESS_MAILBOX_PREFIXES = new Set([
  'bd',
  'business',
  'contact',
  'growth',
  'hello',
  'hi',
  'info',
  'inquiries',
  'inquiry',
  'mail',
  'marketing',
  'opportunities',
  'opportunity',
  'partners',
  'partnership',
  'partnerships',
  'sales',
  'team',
])

const HEADER_ALIASES = {
  email: ['email', 'email_address', 'emailaddress', 'work_email', 'workemail', 'work_email_best_estimated', 'best_estimated_email', 'e_mail'],
  name: ['name', 'full_name', 'fullname', 'contact_name'],
  firstName: ['first_name', 'firstname', 'first'],
  lastName: ['last_name', 'lastname', 'last'],
  company: ['company', 'company_name', 'organization', 'organisation', 'account'],
  companyDomain: ['company_domain', 'companydomain', 'domain', 'website', 'company_website'],
  title: ['title', 'job_title', 'jobtitle', 'role', 'position', 'persona'],
  sourceUrl: ['source_url', 'sourceurl', 'evidence_url', 'evidence', 'public_evidence_url', 'linkedin', 'website', 'website_url', 'company_website'],
  reason: ['reason', 'reason_to_contact', 'notes', 'why', 'fit_reason'],
  consentSource: ['consent_source', 'consent', 'source'],
} as const

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
}

function parseCsvRow(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"' && inQuotes && next === '"') {
      current += '"'
      index += 1
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  cells.push(current.trim())
  return cells
}

function pick(record: Record<string, string>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function pickKey(record: Record<string, string>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return key
  }
  return ''
}

function cleanSourceUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || /^\[.*\]$/.test(trimmed)) return ''
  if (!/^https?:\/\//i.test(trimmed)) return ''
  return trimmed
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0]
}

function hasSpecificEvidenceUrl(value: string): boolean {
  if (!value) return false

  try {
    const url = new URL(value)
    const path = `${url.pathname}${url.search}`.toLowerCase()
    return /contact|about|team|people|leadership|partner|partnership|sales|agency|services/.test(path)
  } catch {
    return false
  }
}

function blockedReason(email: string): string | null {
  if (!isEmail(email)) return 'invalid_email'

  const [prefix, domain] = email.toLowerCase().split('@')
  if (!domain || domain === 'example.com' || domain === 'example.org' || domain.endsWith('.test')) {
    return 'placeholder_or_test_domain'
  }

  if (PERSONAL_EMAIL_DOMAINS.has(domain)) return 'personal_email_domain'
  if (BLOCKED_MAILBOX_PREFIXES.has(prefix)) return 'blocked_mailbox_prefix'
  if (prefix.includes('+')) return 'tagged_or_test_address'

  return null
}

export function buildGoogleSheetCsvUrl(input: string, gidOverride?: string | number): string {
  const value = input.trim()
  if (!value) throw new Error('Google Sheet URL is required')
  if (value.includes('/export?') || value.endsWith('.csv')) return value

  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (!match?.[1]) {
    throw new Error('Paste a valid Google Sheets sharing URL')
  }

  const url = new URL(value)
  const hashGid = url.hash.match(/gid=(\d+)/)?.[1]
  const gid = gidOverride ?? url.searchParams.get('gid') ?? hashGid
  const exportUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`
  return gid === undefined || gid === null || String(gid).trim() === ''
    ? exportUrl
    : `${exportUrl}&gid=${encodeURIComponent(String(gid))}`
}

export function prepareSheetContacts(
  csv: string,
  opts?: {
    sourceUrl?: string
    limit?: number
    dedupeByDomain?: boolean
  }
): PreparedSheetImport {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) {
    return { contacts: [], rejected: [], summary: { rows: 0, valid: 0, rejected: 0, evidenceBacked: 0 } }
  }

  const headers = parseCsvRow(lines[0]).map(normalizeHeader)
  const limit = Math.max(1, Math.min(Number(opts?.limit ?? 100), 500))
  const seenEmails = new Set<string>()
  const seenDomains = new Set<string>()
  const contacts: ContactInput[] = []
  const rejected: SheetRejectedLead[] = []

  for (const [offset, line] of lines.slice(1).entries()) {
    if (contacts.length >= limit) break

    const rowNumber = offset + 2
    const values = parseCsvRow(line)
    const record: Record<string, string> = {}
    headers.forEach((header, index) => {
      record[header] = values[index] ?? ''
    })

    const emailKey = pickKey(record, HEADER_ALIASES.email)
    const email = pick(record, HEADER_ALIASES.email).toLowerCase()
    const reason = blockedReason(email)
    if (reason) {
      rejected.push({ row: rowNumber, email, reason })
      continue
    }

    if (seenEmails.has(email)) {
      rejected.push({ row: rowNumber, email, reason: 'duplicate_email' })
      continue
    }

    const [emailPrefix = '', emailDomain = ''] = email.split('@')
    if (opts?.dedupeByDomain && seenDomains.has(emailDomain)) {
      rejected.push({ row: rowNumber, email, reason: 'duplicate_domain' })
      continue
    }

    seenEmails.add(email)
    seenDomains.add(emailDomain)

    const sourceUrl = cleanSourceUrl(pick(record, HEADER_ALIASES.sourceUrl))
    const hasEvidence = Boolean(sourceUrl)
    const hasSpecificEvidence = hasSpecificEvidenceUrl(sourceUrl)
    const emailLooksEstimated =
      emailKey.includes('estimated') ||
      Boolean(record.email_pattern?.trim()) ||
      Boolean(record.emailpattern?.trim())
    if (emailLooksEstimated && !hasEvidence) {
      rejected.push({ row: rowNumber, email, reason: 'estimated_email_needs_public_evidence' })
      continue
    }
    if (
      emailLooksEstimated &&
      !SAFE_BUSINESS_MAILBOX_PREFIXES.has(emailPrefix) &&
      !hasSpecificEvidence
    ) {
      rejected.push({ row: rowNumber, email, reason: 'estimated_person_needs_specific_public_evidence' })
      continue
    }
    const firstName = pick(record, HEADER_ALIASES.firstName)
    const lastName = pick(record, HEADER_ALIASES.lastName)
    const name = pick(record, HEADER_ALIASES.name) || [firstName, lastName].filter(Boolean).join(' ')
    const company = pick(record, HEADER_ALIASES.company) || normalizeDomain(emailDomain)
    const companyDomain = normalizeDomain(pick(record, HEADER_ALIASES.companyDomain) || emailDomain)
    const reasonToContact =
      pick(record, HEADER_ALIASES.reason) ||
      `${company} appears relevant to outbound infrastructure or growth operations.`
    const consentSource = pick(record, HEADER_ALIASES.consentSource) || 'operator_google_sheet'

    contacts.push({
      email,
      name: name || undefined,
      company,
      companyDomain,
      title: pick(record, HEADER_ALIASES.title) || 'business team',
      source: 'google_sheet_import',
      customFields: {
        sheet_import: true,
        sheet_source_url: opts?.sourceUrl ?? null,
        public_evidence_url: sourceUrl || null,
        data_source: 'operator_google_sheet',
        consent_source: consentSource,
        reason_to_contact: reasonToContact,
        send_status: 'not_approved',
        approval_required: true,
        auto_approval_eligible: hasEvidence,
        email_evidence: hasEvidence ? 'operator_sheet_evidence' : 'operator_sheet_unverified',
        sheet_row: rowNumber,
      },
    })
  }

  return {
    contacts,
    rejected,
    summary: {
      rows: Math.max(0, lines.length - 1),
      valid: contacts.length,
      rejected: rejected.length,
      evidenceBacked: contacts.filter((contact) => contact.customFields?.auto_approval_eligible).length,
    },
  }
}
