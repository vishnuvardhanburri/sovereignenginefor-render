#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'

const codeRoot = path.resolve(import.meta.dirname, '..')
const outerRoot = path.resolve(codeRoot, '..')

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function resolveInputPath(input) {
  const raw = input ?? 'docs/acquisition/LEADS_TEMPLATE.csv'
  if (path.isAbsolute(raw)) return raw

  const cwd = process.cwd()
  const candidates =
    cwd === codeRoot
      ? [path.resolve(outerRoot, raw), path.resolve(codeRoot, raw)]
      : [path.resolve(cwd, raw), path.resolve(outerRoot, raw), path.resolve(codeRoot, raw)]

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate
  }

  return candidates[0]
}

async function resolveOutputPath(input) {
  const raw = input ?? 'docs/acquisition/CLIENTS_TODAY.csv'
  if (path.isAbsolute(raw)) return raw

  const cwd = process.cwd()
  const outerCandidate = path.resolve(outerRoot, raw)
  if (cwd === codeRoot && (await exists(path.dirname(outerCandidate)))) return outerCandidate

  return path.resolve(cwd, raw)
}

const sourcePath = await resolveInputPath(process.argv[2])
const outPath = await resolveOutputPath(process.argv[3])

function parseCsvLine(line) {
  const cells = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    const next = line[i + 1]
    if (ch === '"' && quoted && next === '"') {
      cur += '"'
      i += 1
      continue
    }
    if (ch === '"') {
      quoted = !quoted
      continue
    }
    if (ch === ',' && !quoted) {
      cells.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  cells.push(cur)
  return cells.map((cell) => cell.trim())
}

function csvEscape(value) {
  const raw = String(value ?? '')
  return /[",\n\r]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

function isPlaceholderEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  const domain = email.split('@')[1] ?? ''
  return (
    !email ||
    domain === 'example.com' ||
    domain === 'example.org' ||
    domain === 'example.net' ||
    domain.endsWith('.test') ||
    email.includes('placeholder') ||
    email.includes('test@') ||
    email.includes('demo@')
  )
}

function firstName(name) {
  const clean = String(name || '').trim()
  return clean.split(/\s+/)[0] || 'there'
}

const raw = await fs.readFile(sourcePath, 'utf8')
const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
const headers = parseCsvLine(lines[0] ?? '').map((h) => h.toLowerCase())
const rows = lines.slice(1).map((line) => {
  const values = parseCsvLine(line)
  const pick = (...names) => {
    for (const name of names) {
      const idx = headers.indexOf(name)
      if (idx >= 0 && values[idx]) return values[idx]
    }
    return ''
  }
  return {
    email: pick('buyer_email', 'email'),
    firstName: firstName(pick('buyer_name', 'first_name', 'name')),
    company: pick('company'),
    consentSource: pick('consent_source') || 'legitimate_business_interest',
    reason: pick('reason_to_buy', 'reason_to_contact', 'notes'),
    status: pick('status'),
  }
})

const prepared = []
const skipped = []
const seen = new Set()

for (const row of rows) {
  const email = row.email.toLowerCase()
  const reason = row.reason || `${row.company || 'the team'} appears relevant to outbound infrastructure`
  if (!isEmail(email) || isPlaceholderEmail(email)) {
    skipped.push({ email: row.email || '(blank)', reason: 'missing_or_invalid_email' })
    continue
  }
  if (!row.company) {
    skipped.push({ email, reason: 'missing_company' })
    continue
  }
  if (seen.has(email)) {
    skipped.push({ email, reason: 'duplicate' })
    continue
  }
  seen.add(email)
  prepared.push({
    email,
    first_name: row.firstName,
    company: row.company,
    consent_source: row.consentSource,
    reason_to_contact: reason,
  })
}

const output = [
  'email,first_name,company,consent_source,reason_to_contact',
  ...prepared.map((row) =>
    [row.email, row.first_name, row.company, row.consent_source, row.reason_to_contact].map(csvEscape).join(',')
  ),
].join('\n') + '\n'

await fs.mkdir(path.dirname(outPath), { recursive: true })
await fs.writeFile(outPath, output, 'utf8')

console.log(JSON.stringify({
  source: sourcePath,
  output: outPath,
  prepared: prepared.length,
  skipped: skipped.length,
  skippedPreview: skipped.slice(0, 10),
}, null, 2))
