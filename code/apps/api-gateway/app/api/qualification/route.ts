import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { appEnv } from '@/lib/env'
import { sendViaSmtp } from '@/lib/integrations/billionmail'
import { appendOperationalEvent, stableHash } from '@/lib/operational-events'
import { sendTelegramMessage } from '@/lib/telegram'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SOVEREIGN_CALENDAR_URL =
  process.env.SOVEREIGN_CALENDAR_URL ||
  process.env.NEXT_PUBLIC_SOVEREIGN_CALENDAR_URL ||
  'https://cal.com/vishnuvardhanburri/30min'
const INFINITY_PAYMENT_URL =
  process.env.INFINITY_PAYMENT_URL || process.env.NEXT_PUBLIC_INFINITY_PAYMENT_URL || ''
const INFINITY_CLIENTS_URL =
  process.env.INFINITY_CLIENTS_URL || 'https://dashboard.infinityapp.in/app/clients'

const option = (values: readonly [string, ...string[]]) => z.enum(values)

const qualificationSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  workEmail: z.string().trim().email().max(180),
  company: z.string().trim().min(2).max(160),
  role: z.string().trim().max(120).optional().default(''),
  website: z.string().trim().max(220).optional().default(''),
  useCase: option([
    'agency_client_campaign',
    'internal_outbound_campaign',
    'partner_client_delivery',
    'internal_operations',
    'white_label',
    'strategic_acquisition',
  ]),
  currentSetup: z.string().trim().min(10).max(1200),
  monthlyOutboundVolume: z.string().trim().min(1).max(80),
  painPoints: z.array(z.string().trim().max(80)).max(10).optional().default([]),
  timeline: option(['this_week', 'next_week', 'this_month', 'this_quarter', 'exploring']),
  decisionOwner: z.string().trim().min(2).max(180),
  commercialPath: option([
    'campaign_rescue_500',
    'monthly_partner_1500',
    'internal_40000',
    'white_label_160000',
    'strategic_200000_plus',
    'need_guidance',
  ]),
  preferredCallWindow: z.string().trim().min(2).max(160),
  notes: z.string().trim().max(1200).optional().default(''),
  legalBuyerName: z.string().trim().min(2).max(180),
  billingEmail: z.string().trim().email().max(180),
  billingCountry: z.string().trim().min(2).max(120),
  billingAddress: z.string().trim().min(8).max(700),
  taxId: z.string().trim().max(120).optional().default(''),
  purchaseOrder: z.string().trim().max(120).optional().default(''),
  authorizedSigner: z.string().trim().min(2).max(160),
  paymentReadiness: option([
    'pay_today',
    'invoice_today',
    'payment_link_today',
    'bank_transfer_today',
    'procurement_review',
  ]),
  paymentNotes: z.string().trim().max(700).optional().default(''),
  source: z.string().trim().max(120).optional().default('book_page'),
  contactId: z.string().trim().max(80).optional().default(''),
  campaignId: z.string().trim().max(80).optional().default(''),
  websiteTrap: z.string().trim().max(200).optional().default(''),
  consent: z.boolean(),
})

type QualificationInput = z.infer<typeof qualificationSchema>

const commercialPathLabels: Record<QualificationInput['commercialPath'], string> = {
  campaign_rescue_500: '£500 Campaign Rescue Sprint',
  monthly_partner_1500: '£1,500/month Xavira Control Partner',
  internal_40000: 'Legacy £500 Campaign Rescue Sprint',
  white_label_160000: 'Legacy £1,500/month Xavira Control Partner',
  strategic_200000_plus: 'Custom path after rescue proof',
  need_guidance: 'Needs guidance',
}

const timelineLabels: Record<QualificationInput['timeline'], string> = {
  this_week: 'This week',
  next_week: 'Next week',
  this_month: 'This month',
  this_quarter: 'This quarter',
  exploring: 'Exploring',
}

const paymentReadinessLabels: Record<QualificationInput['paymentReadiness'], string> = {
  pay_today: 'Ready to pay today',
  invoice_today: 'Needs invoice today',
  payment_link_today: 'Needs Infinity payment link today',
  bank_transfer_today: 'Ready for GBP bank transfer today',
  procurement_review: 'Needs procurement/review',
}

type BankTransferDetails = {
  currency: string
  accountName: string
  bankName: string
  accountNumber: string
  sortCode: string
  accountType: string
  beneficiaryAddress: string
  paymentReference: string
}

function requestIpHash(request: NextRequest): string | null {
  const raw =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    ''
  return raw ? stableHash(raw).slice(0, 16) : null
}

function cleanWebsite(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function firstConfiguredEmailList(...values: Array<string | undefined>): string {
  for (const value of values) {
    const cleaned = String(value ?? '').trim()
    if (!cleaned) continue
    const emails = cleaned
      .split(',')
      .map((item) => item.trim())
      .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item))
    if (emails.length) return emails.join(', ')
  }
  return ''
}

function operatorNotificationRecipients(): string {
  return firstConfiguredEmailList(
    process.env.QUALIFICATION_NOTIFY_EMAIL,
    process.env.DEAL_NOTIFY_EMAIL,
    process.env.OPERATOR_NOTIFY_EMAIL,
    process.env.OUTBOUND_CRON_RECIPIENTS,
    process.env.RESEND_FROM_EMAIL,
    process.env.SMTP_FROM_EMAIL,
    process.env.BOOTSTRAP_ADMIN_EMAIL
  )
}

function operatorNotificationFrom(): string {
  return (
    process.env.QUALIFICATION_FROM_EMAIL ||
    process.env.RESEND_FROM_EMAIL ||
    process.env.SMTP_FROM_EMAIL ||
    appEnv.smtpFromEmail()
  )
}

function infinityBankTransferDetails(): BankTransferDetails | null {
  const accountName = String(process.env.INFINITY_GBP_ACCOUNT_NAME ?? '').trim()
  const bankName = String(process.env.INFINITY_GBP_BANK_NAME ?? '').trim()
  const accountNumber = String(process.env.INFINITY_GBP_ACCOUNT_NUMBER ?? '').trim()
  const sortCode = String(process.env.INFINITY_GBP_SORT_CODE ?? '').trim()
  const accountType = String(process.env.INFINITY_GBP_ACCOUNT_TYPE ?? 'Business Checking').trim()
  const beneficiaryAddress = String(process.env.INFINITY_GBP_BENEFICIARY_ADDRESS ?? '').trim()
  const paymentReference = String(
    process.env.INFINITY_GBP_PAYMENT_REFERENCE ?? 'Use invoice number or buyer company name'
  ).trim()

  if (!accountName || !bankName || !accountNumber || !sortCode) return null

  return {
    currency: 'GBP',
    accountName,
    bankName,
    accountNumber,
    sortCode,
    accountType,
    beneficiaryAddress,
    paymentReference,
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function qualificationMessage(input: QualificationInput): string {
  const bankTransfer = infinityBankTransferDetails()
  return [
    'Xavira Campaign Rescue Sprint intake submitted',
    `Name: ${input.fullName}`,
    `Email: ${input.workEmail}`,
    `Company: ${input.company}`,
    input.role ? `Role: ${input.role}` : null,
    input.website ? `Website: ${input.website}` : null,
    `Offer: ${commercialPathLabels[input.commercialPath]}`,
    `Timeline: ${timelineLabels[input.timeline]}`,
    `Owner: ${input.decisionOwner}`,
    `Preferred call: ${input.preferredCallWindow}`,
    `Campaign volume: ${input.monthlyOutboundVolume}`,
    `Use case: ${input.useCase.replace(/_/g, ' ')}`,
    input.painPoints.length ? `Priority areas: ${input.painPoints.join(', ')}` : null,
    `Setup: ${input.currentSetup}`,
    input.notes ? `Campaign notes: ${input.notes}` : null,
    '',
    'Payment / invoice details',
    `Legal buyer: ${input.legalBuyerName}`,
    `Billing email: ${input.billingEmail}`,
    `Billing country: ${input.billingCountry}`,
    `Billing address: ${input.billingAddress}`,
    input.taxId ? `Tax/VAT/GST ID: ${input.taxId}` : null,
    input.purchaseOrder ? `PO/reference: ${input.purchaseOrder}` : null,
    `Authorized signer: ${input.authorizedSigner}`,
    `Payment readiness: ${paymentReadinessLabels[input.paymentReadiness]}`,
    input.paymentNotes ? `Payment notes: ${input.paymentNotes}` : null,
    `Calendar: ${SOVEREIGN_CALENDAR_URL}`,
    INFINITY_PAYMENT_URL ? `Infinity payment: ${INFINITY_PAYMENT_URL}` : null,
    INFINITY_CLIENTS_URL ? `Infinity clients dashboard: ${INFINITY_CLIENTS_URL}` : null,
    bankTransfer ? '' : null,
    bankTransfer ? 'Infinity GBP bank transfer details' : null,
    bankTransfer ? `Currency: ${bankTransfer.currency}` : null,
    bankTransfer ? `Bank name: ${bankTransfer.bankName}` : null,
    bankTransfer ? `Account name: ${bankTransfer.accountName}` : null,
    bankTransfer ? `Account number: ${bankTransfer.accountNumber}` : null,
    bankTransfer ? `Sort code: ${bankTransfer.sortCode}` : null,
    bankTransfer?.accountType ? `Account type: ${bankTransfer.accountType}` : null,
    bankTransfer?.beneficiaryAddress
      ? `Beneficiary address: ${bankTransfer.beneficiaryAddress}`
      : null,
    bankTransfer ? `Payment reference: ${bankTransfer.paymentReference}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

function qualificationEmailHtml(input: QualificationInput): string {
  const bankTransfer = infinityBankTransferDetails()
  const rows = [
    ['Name', input.fullName],
    ['Email', input.workEmail],
    ['Company', input.company],
    ['Role', input.role],
    ['Website', input.website],
    ['Offer', commercialPathLabels[input.commercialPath]],
    ['Timeline', timelineLabels[input.timeline]],
    ['Owner', input.decisionOwner],
    ['Preferred call', input.preferredCallWindow],
    ['Campaign volume', input.monthlyOutboundVolume],
    ['Use case', input.useCase.replace(/_/g, ' ')],
    ['Priority areas', input.painPoints.join(', ')],
    ['Current setup', input.currentSetup],
    ['Campaign notes', input.notes],
    ['Legal buyer', input.legalBuyerName],
    ['Billing email', input.billingEmail],
    ['Billing country', input.billingCountry],
    ['Billing address', input.billingAddress],
    ['Tax/VAT/GST ID', input.taxId],
    ['PO/reference', input.purchaseOrder],
    ['Authorized signer', input.authorizedSigner],
    ['Payment readiness', paymentReadinessLabels[input.paymentReadiness]],
    ['Payment notes', input.paymentNotes],
    ['Calendar', SOVEREIGN_CALENDAR_URL],
    ['Infinity payment', INFINITY_PAYMENT_URL],
    ['Infinity clients dashboard', INFINITY_CLIENTS_URL],
    ['GBP currency', bankTransfer?.currency ?? ''],
    ['GBP bank name', bankTransfer?.bankName ?? ''],
    ['GBP account name', bankTransfer?.accountName ?? ''],
    ['GBP account number', bankTransfer?.accountNumber ?? ''],
    ['GBP sort code', bankTransfer?.sortCode ?? ''],
    ['GBP account type', bankTransfer?.accountType ?? ''],
    ['GBP beneficiary address', bankTransfer?.beneficiaryAddress ?? ''],
    ['GBP payment reference', bankTransfer?.paymentReference ?? ''],
  ].filter(([, value]) => String(value ?? '').trim())

  const bodyRows = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;vertical-align:top;width:180px;">${escapeHtml(label)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(String(value))}</td>
        </tr>`
    )
    .join('')

  return `
    <div style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:24px;color:#111827;">
      <div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <div style="padding:20px 22px;background:#0f172a;color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#93c5fd;">Xavira</div>
          <h1 style="margin:8px 0 0 0;font-size:22px;line-height:1.25;">New Campaign Rescue Sprint intake</h1>
          <p style="margin:8px 0 0 0;color:#cbd5e1;font-size:14px;">Review the campaign details, then use the Cal.com slot and Infinity payment details to start the £500 sprint.</p>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          ${bodyRows}
        </table>
        <div style="padding:18px 22px;">
          <a href="${escapeHtml(SOVEREIGN_CALENDAR_URL)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;padding:11px 14px;font-weight:700;font-size:14px;">Open 30-minute calendar</a>
          ${
            INFINITY_PAYMENT_URL
              ? `<a href="${escapeHtml(INFINITY_PAYMENT_URL)}" style="display:inline-block;margin-left:8px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;padding:11px 14px;font-weight:700;font-size:14px;">Open Infinity payment</a>`
              : ''
          }
          <a href="${escapeHtml(INFINITY_CLIENTS_URL)}" style="display:inline-block;margin-left:8px;background:#0f766e;color:#ffffff;text-decoration:none;border-radius:8px;padding:11px 14px;font-weight:700;font-size:14px;">Open Infinity client</a>
        </div>
      </div>
    </div>
  `
}

async function notifyOperatorTelegram(input: QualificationInput): Promise<void> {
  const botToken = appEnv.telegramBotToken()
  const chatId = process.env.TELEGRAM_CHAT_ID || ''
  if (!botToken || !chatId) return

  try {
    await sendTelegramMessage({
      botToken,
      chatId,
      parseMode: 'none',
      text: qualificationMessage(input).slice(0, 3900),
    })
  } catch (error) {
    console.error('[qualification] telegram notification failed', error)
  }
}

async function notifyOperatorEmail(input: QualificationInput): Promise<void> {
  const toEmail = operatorNotificationRecipients()
  if (!toEmail) {
    console.warn('[qualification] no operator email recipient configured')
    return
  }

  try {
    const subject = `New Campaign Rescue Sprint: ${input.company} (${commercialPathLabels[input.commercialPath]})`
    const result = await sendViaSmtp({
      fromEmail: operatorNotificationFrom(),
      toEmail,
      subject,
      text: qualificationMessage(input),
      html: qualificationEmailHtml(input),
      headers: {
        'X-Sovereign-Event': 'qualification_submitted',
        'X-Sovereign-Source': input.source || 'book_page',
      },
    })

    if (!result.success) {
      console.error('[qualification] operator email failed', result.error)
    }
  } catch (error) {
    console.error('[qualification] operator email failed', error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json()
    const parsed = qualificationSchema.safeParse({
      ...raw,
      painPoints: Array.isArray(raw?.painPoints) ? raw.painPoints : [],
      consent: raw?.consent === true,
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Check the required sprint intake fields and try again.' },
        { status: 400 }
      )
    }

    const input = {
      ...parsed.data,
      workEmail: parsed.data.workEmail.toLowerCase(),
      website: cleanWebsite(parsed.data.website),
    }

    if (input.websiteTrap) {
      return NextResponse.json({ ok: true })
    }

    if (!input.consent) {
      return NextResponse.json(
        { error: 'Please confirm the Campaign Rescue Sprint request before submitting.' },
        { status: 400 }
      )
    }

    const clientId = appEnv.defaultClientId()
    const bankTransfer = infinityBankTransferDetails()
    const event = await appendOperationalEvent({
      clientId,
      eventType: 'qualification_submitted',
      aggregateType: 'deal_qualification',
      aggregateId: input.workEmail,
      actorType: 'api_key',
      actorId: 'public-book-page',
      payload: {
        fullName: input.fullName,
        workEmail: input.workEmail,
        company: input.company,
        role: input.role,
        website: input.website,
        useCase: input.useCase,
        currentSetup: input.currentSetup,
        monthlyOutboundVolume: input.monthlyOutboundVolume,
        painPoints: input.painPoints,
        timeline: input.timeline,
        decisionOwner: input.decisionOwner,
        commercialPath: input.commercialPath,
        commercialPathLabel: commercialPathLabels[input.commercialPath],
        preferredCallWindow: input.preferredCallWindow,
        notes: input.notes,
        legalBuyerName: input.legalBuyerName,
        billingEmail: input.billingEmail,
        billingCountry: input.billingCountry,
        billingAddress: input.billingAddress,
        taxId: input.taxId,
        purchaseOrder: input.purchaseOrder,
        authorizedSigner: input.authorizedSigner,
        paymentReadiness: input.paymentReadiness,
        paymentReadinessLabel: paymentReadinessLabels[input.paymentReadiness],
        paymentNotes: input.paymentNotes,
        infinityPaymentUrl: INFINITY_PAYMENT_URL,
        infinityClientsUrl: INFINITY_CLIENTS_URL,
        bankTransfer,
        source: input.source,
        contactId: input.contactId,
        campaignId: input.campaignId,
      },
      metadata: {
        ipHash: requestIpHash(request),
        userAgent: request.headers.get('user-agent')?.slice(0, 240) || null,
        referrer: request.headers.get('referer')?.slice(0, 500) || null,
      },
    })

    await Promise.allSettled([notifyOperatorTelegram(input), notifyOperatorEmail(input)])

    return NextResponse.json({
      ok: true,
      id: event.id,
      calendarUrl: SOVEREIGN_CALENDAR_URL,
      paymentUrl: INFINITY_PAYMENT_URL,
      bankTransfer,
      message: 'Sprint intake received. The operator has the campaign packet.',
    })
  } catch (error) {
    console.error('[qualification] submit failed', error)
    return NextResponse.json({ error: 'Qualification submit failed' }, { status: 500 })
  }
}
