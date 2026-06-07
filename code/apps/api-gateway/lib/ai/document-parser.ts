import { createReadStream } from 'fs'
import { readFile } from 'fs/promises'
import path from 'path'

import { extractIntent } from './intent'

export interface ParsedLeadDocument {
  name: string
  email: string
  company: string
}

function cleanValue(value: string): string {
  return value.trim().replace(/^"|"$/g, '')
}

export async function parseCsvLeadFile(filePath: string): Promise<ParsedLeadDocument[]> {
  const content = await readFile(filePath, 'utf8')
  const [headerLine, ...rows] = content.split(/\r?\n/).filter(Boolean)
  if (!headerLine) {
    return []
  }

  const headers = headerLine.split(',').map(cleanValue)
  return rows
    .map((row) => row.split(',').map(cleanValue))
    .map((cols) => {
      const record = Object.fromEntries(headers.map((header, index) => [header, cols[index] ?? '']))
      return normalizeLeadRecord({
        name: String(record.name ?? record.full_name ?? ''),
        email: String(record.email ?? ''),
        company: String(record.company ?? ''),
      })
    })
    .flatMap((item) => (item ? [item] : []))
}

export async function parseTextLeadFile(filePath: string): Promise<ParsedLeadDocument[]> {
  const raw = await readFile(filePath, 'utf8')
  return extractLeadRecordsFromText(raw)
}

export function extractLeadRecordsFromText(rawText: string): ParsedLeadDocument[] {
  const text = rawText.trim()
  if (!text) {
    return []
  }

  const emailMatches = [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)]
  const intents = extractIntent(text)
  const company = intents.intent !== 'unknown' ? 'Unknown' : ''

  return emailMatches
    .map((match) => normalizeLeadRecord({
      name: '',
      email: match[0],
      company,
    }))
    .flatMap((item) => (item ? [item] : []))
}

function normalizeLeadRecord(input: ParsedLeadDocument): ParsedLeadDocument | null {
  const email = input.email.trim().toLowerCase()
  if (!email || !email.includes('@')) {
    return null
  }

  return {
    name: input.name.trim(),
    email,
    company: input.company.trim(),
  }
}
