import { Contact, SequenceStep } from '@/lib/db/types'
import { generateIntroLine as generateDeterministicIntroLine } from '@/lib/ai/generator'

const SPAM_TERMS = [
  'guarantee',
  'free money',
  'risk free',
  'buy now',
  'click here',
  'double your',
]

function toTitleCase(value: string) {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('')
}

function flattenCustomFields(fields: Record<string, unknown>) {
  const mapped: Record<string, string> = {}

  for (const [key, value] of Object.entries(fields)) {
    if (value == null) {
      continue
    }

    mapped[key] = String(value)
    mapped[toTitleCase(key)] = String(value)
  }

  return mapped
}

export function resolveSpinSyntax(template: string) {
  return template.replace(/\{([^{}]+)\}/g, (_, rawOptions: string) => {
    const options = rawOptions
      .split('|')
      .map((item) => item.trim())
      .filter(Boolean)

    if (options.length === 0) {
      return ''
    }

    return options[0]
  })
}

export function renderVariables(
  template: string,
  contact: Pick<Contact, 'email' | 'name' | 'company' | 'title' | 'custom_fields'>
) {
  const [localPart] = contact.email.split('@')
  const firstName = contact.name?.split(' ')[0]?.trim() || 'there'
  const variables: Record<string, string> = {
    FirstName: firstName,
    FullName: contact.name?.trim() || firstName,
    Company: contact.company?.trim() || 'your team',
    Title: contact.title?.trim() || 'team',
    EmailLocalPart: localPart || '',
    physical_address: process.env.SENDER_PHYSICAL_ADDRESS || 'Xavira Tech Labs, India',
    PhysicalAddress: process.env.SENDER_PHYSICAL_ADDRESS || 'Xavira Tech Labs, India',
    ...flattenCustomFields(contact.custom_fields ?? {}),
  }

  const rendered = template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, rawKey: string) => {
    const key = rawKey.trim()
    return variables[key] ?? variables[toTitleCase(key)] ?? ''
  })

  return resolveSpinSyntax(rendered)
}

export function enforceFiveLineEmail(body: string) {
  const lines = body
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  if (lines.length > 5) {
    throw new Error('Email copy exceeds the 5-line policy')
  }

  if (body.length > 700) {
    throw new Error('Email copy exceeds the length policy')
  }

  return lines.join('\n')
}

export function ensureQuestionEnding(body: string) {
  const lines = body
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  if (lines.length === 0) {
    return 'Would you be open to a quick chat?'
  }

  const lastIndex = lines.length - 1
  let lastLine = lines[lastIndex]

  if (!lastLine.endsWith('?')) {
    lastLine = lastLine.replace(/[.!]+$/g, '').trim()
    lines[lastIndex] = `${lastLine || 'Would you be open to a quick chat'}?`
  }

  return lines.join('\n')
}

export function detectSpamSignals(content: string) {
  const lowered = content.toLowerCase()
  return SPAM_TERMS.filter((term) => lowered.includes(term))
}

export async function buildPersonalizedMessage(input: {
  contact: Contact
  step: Pick<SequenceStep, 'subject' | 'body'>
  offerSummary?: string | null
  painSummary?: string | null
}) {
  const needsAiIntro = input.step.body.includes('{{AIIntro}}')
  let renderedBody = renderVariables(input.step.body, input.contact)
  const renderedSubject = renderVariables(input.step.subject, input.contact)

  renderedBody = ensureQuestionEnding(renderedBody)

  if (!needsAiIntro) {
    return {
      subject: renderedSubject,
      text: enforceFiveLineEmail(renderedBody),
      spamFlags: detectSpamSignals(`${renderedSubject}\n${renderedBody}`),
    }
  }

  const intro = generateDeterministicIntroLine({
    contact: input.contact,
    company: input.contact.company,
    role: input.contact.title,
    offer: input.offerSummary,
    pain: input.painSummary,
  }).result.intro as string

  renderedBody = renderVariables(
    input.step.body.replaceAll('{{AIIntro}}', intro),
    input.contact
  )
  renderedBody = ensureQuestionEnding(renderedBody)

  return {
    subject: renderedSubject,
    text: enforceFiveLineEmail(renderedBody),
    spamFlags: detectSpamSignals(`${renderedSubject}\n${renderedBody}`),
  }
}

export function isBusinessHourForTimezone(
  timezone: string | null | undefined,
  now = new Date()
) {
  if (!timezone) {
    return true
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    })
    const hour = Number(formatter.format(now))
    return hour >= 8 && hour <= 17
  } catch {
    return true
  }
}
