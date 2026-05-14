import nodemailer from 'nodemailer'
import crypto from 'crypto'

export interface SmtpConfig {
  host: string
  port?: number
  secure?: boolean
  user: string
  pass: string
}

export interface SendEmailRequest {
  from: string
  to: string
  subject: string
  html?: string
  text?: string
  headers?: Record<string, string>
  headerContext?: HeaderFactoryContext
}

export interface HeaderFactoryContext {
  clientId?: number
  campaignId?: number | null
  queueJobId?: number | null
  idempotencyKey?: string | null
  sendingDomain?: string | null
  provider?: string | null
  traceId?: string | null
}

export interface BuiltSmtpHeaders {
  messageId: string
  headers: Record<string, string>
}

function cleanHeaderValue(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^\t\x20-\x7e]/g, '')
    .trim()
}

function cleanHeaderName(value: unknown): string {
  const name = String(value ?? '').trim()
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) ? name : ''
}

function domainFromEmail(email: string): string {
  const domain = email.split('@')[1]?.trim().toLowerCase()
  return domain && /^[a-z0-9.-]+$/.test(domain) ? domain : 'localhost'
}

function stableHex(parts: Array<unknown>, len = 24): string {
  return crypto.createHash('sha256').update(parts.map((part) => String(part ?? '')).join('|')).digest('hex').slice(0, len)
}

/**
 * Compliance-safe SMTP header factory.
 *
 * This intentionally does not impersonate consumer/webmail clients. The goal is
 * RFC-clean, stable, traceable enterprise mail headers that align with the
 * authenticated sending domain and avoid accidental header leakage.
 */
export function buildCompliantSmtpHeaders(req: SendEmailRequest): BuiltSmtpHeaders {
  const ctx = req.headerContext ?? {}
  const sendingDomain = cleanHeaderValue(ctx.sendingDomain) || domainFromEmail(req.from)
  const traceId = cleanHeaderValue(ctx.traceId) || stableHex([
    ctx.clientId,
    ctx.campaignId,
    ctx.queueJobId,
    ctx.idempotencyKey,
    req.to,
  ], 32)
  const localPart = [
    'xo',
    stableHex([traceId, ctx.idempotencyKey, ctx.provider], 12),
    Date.now().toString(36),
  ].join('.')

  const baseHeaders: Record<string, string> = {
    'X-Entity-Ref-ID': traceId,
    'MIME-Version': '1.0',
  }

  const userHeaders = Object.fromEntries(
    Object.entries(req.headers ?? {})
      .filter(([key]) => !/^message-id$/i.test(key))
      .map(([key, value]) => [cleanHeaderName(key), cleanHeaderValue(value)])
      .filter(([key]) => Boolean(key))
  )

  return {
    messageId: `<${localPart}@${sendingDomain}>`,
    headers: {
      ...baseHeaders,
      ...userHeaders,
    },
  }
}

function secretFromMisplacedProviderEnv(name: 'BREVO_API_KEY' | 'RESEND_API_KEY'): string {
  const raw = [process.env.EMAIL_PROVIDER, process.env.SEND_PROVIDER]
    .filter(Boolean)
    .join('\n')
    .trim()

  if (!raw) return ''

  const keyMatch = raw.match(new RegExp(`${name}\\s*=\\s*([^\\s,;]+)`, 'i'))
  const candidate = keyMatch?.[1]?.trim().replace(/^['"]|['"]$/g, '')
  if (candidate) return candidate

  if (name === 'BREVO_API_KEY' && /^xsmtpsib-/i.test(raw)) return raw
  if (name === 'RESEND_API_KEY' && /^re_/i.test(raw)) return raw

  return ''
}

function hasSecret(name: 'BREVO_API_KEY' | 'RESEND_API_KEY'): boolean {
  return Boolean(process.env[name] || secretFromMisplacedProviderEnv(name))
}

function providerMode(): 'smtp' | 'brevo' | 'resend' {
  const explicitMode = process.env.EMAIL_PROVIDER || process.env.SEND_PROVIDER
  const inferredMode = hasSecret('BREVO_API_KEY') ? 'brevo' : hasSecret('RESEND_API_KEY') ? 'resend' : 'smtp'
  const mode = String(explicitMode || inferredMode)
    .trim()
    .toLowerCase()
  if (mode.includes('brevo_api_key=') || mode.startsWith('xsmtpsib-')) return 'brevo'
  if (mode.includes('resend_api_key=') || mode.startsWith('re_')) return 'resend'
  return mode === 'brevo' || mode === 'resend' ? mode : 'smtp'
}

function reqSecret(name: 'BREVO_API_KEY' | 'RESEND_API_KEY'): string {
  const value = process.env[name] || secretFromMisplacedProviderEnv(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

async function sendBrevo(req: SendEmailRequest, built: BuiltSmtpHeaders): Promise<{ messageId: string }> {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': reqSecret('BREVO_API_KEY'),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: req.from },
      to: [{ email: req.to }],
      subject: req.subject,
      htmlContent: req.html,
      textContent: req.text,
      headers: {
        ...built.headers,
        'Message-ID': built.messageId,
      },
    }),
  })

  const body = (await response.json().catch(() => ({}))) as { messageId?: string; message?: string }
  if (!response.ok) {
    throw new Error(`brevo_send_failed:${response.status}:${body.message || response.statusText}`)
  }

  return { messageId: body.messageId || built.messageId }
}

async function sendResend(req: SendEmailRequest, built: BuiltSmtpHeaders): Promise<{ messageId: string }> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${reqSecret('RESEND_API_KEY')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: req.from,
      to: [req.to],
      subject: req.subject,
      html: req.html,
      text: req.text,
      headers: built.headers,
    }),
  })

  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string; error?: string }
  if (!response.ok) {
    throw new Error(`resend_send_failed:${response.status}:${body.message || body.error || response.statusText}`)
  }

  return { messageId: body.id || built.messageId }
}

export async function sendSmtp(config: SmtpConfig, req: SendEmailRequest): Promise<{ messageId: string }> {
  const built = buildCompliantSmtpHeaders(req)
  const mode = providerMode()

  if (mode === 'brevo') {
    return sendBrevo(req, built)
  }

  if (mode === 'resend') {
    return sendResend(req, built)
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port ?? (config.secure ? 465 : 587),
    secure: Boolean(config.secure),
    // Hosted mailbox SMTP can be slower than ESP APIs; keep bounded, but avoid false timeouts.
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  })

  const info = await transporter.sendMail({
    from: req.from,
    to: req.to,
    subject: req.subject,
    html: req.html,
    text: req.text,
    messageId: built.messageId,
    headers: built.headers,
  })

  return { messageId: info.messageId ?? '' }
}
