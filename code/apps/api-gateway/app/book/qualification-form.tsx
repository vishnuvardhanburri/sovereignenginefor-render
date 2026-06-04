'use client'

import { FormEvent, useState } from 'react'
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Send,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const painOptions = [
  'Sender health',
  'Delivery proof',
  'Queue discipline',
  'Client reporting',
  'AI governance',
  'Follow-up control',
]

const pathOptions = [
  {
    value: 'internal_40000',
    label: '£40,000 internal',
    description: 'Internal enterprise operations license.',
  },
  {
    value: 'white_label_160000',
    label: '£160,000 white-label',
    description: 'Commercial rights for client-facing deployments.',
  },
  {
    value: 'strategic_200000_plus',
    label: '£200,000+ strategic',
    description: 'Acquisition, partnership, or strategic control path.',
  },
  {
    value: 'need_guidance',
    label: 'Need guidance',
    description: 'Use the call to select the correct path.',
  },
]

const useCaseOptions = [
  { value: 'internal_operations', label: 'Internal operations' },
  { value: 'white_label', label: 'Client-facing / white-label' },
  { value: 'strategic_acquisition', label: 'Strategic / acquisition' },
]

const timelineOptions = [
  { value: 'this_week', label: 'This week' },
  { value: 'this_month', label: 'This month' },
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'exploring', label: 'Exploring' },
]

const calendarFallbackUrl =
  process.env.NEXT_PUBLIC_SOVEREIGN_CALENDAR_URL || 'https://cal.com/vishnuvardhanburri/30min'
const paymentFallbackUrl = process.env.NEXT_PUBLIC_INFINITY_PAYMENT_URL || ''

const paymentReadinessOptions = [
  { value: 'pay_today', label: 'Ready to pay today' },
  { value: 'invoice_today', label: 'Needs invoice today' },
  { value: 'payment_link_today', label: 'Needs Infinity payment link today' },
  { value: 'procurement_review', label: 'Needs procurement/review' },
]

type SubmitState =
  | { status: 'idle'; message?: string }
  | { status: 'submitting'; message?: string }
  | { status: 'success'; message: string; calendarUrl: string; paymentUrl: string }
  | { status: 'error'; message: string }

export function QualificationForm() {
  const [state, setState] = useState<SubmitState>({ status: 'idle' })

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const payload = {
      fullName: String(formData.get('fullName') ?? ''),
      workEmail: String(formData.get('workEmail') ?? ''),
      company: String(formData.get('company') ?? ''),
      role: String(formData.get('role') ?? ''),
      website: String(formData.get('website') ?? ''),
      useCase: String(formData.get('useCase') ?? ''),
      currentSetup: String(formData.get('currentSetup') ?? ''),
      monthlyOutboundVolume: String(formData.get('monthlyOutboundVolume') ?? ''),
      painPoints: formData.getAll('painPoints').map(String),
      timeline: String(formData.get('timeline') ?? ''),
      decisionOwner: String(formData.get('decisionOwner') ?? ''),
      commercialPath: String(formData.get('commercialPath') ?? ''),
      preferredCallWindow: String(formData.get('preferredCallWindow') ?? ''),
      notes: String(formData.get('notes') ?? ''),
      legalBuyerName: String(formData.get('legalBuyerName') ?? ''),
      billingEmail: String(formData.get('billingEmail') ?? ''),
      billingCountry: String(formData.get('billingCountry') ?? ''),
      billingAddress: String(formData.get('billingAddress') ?? ''),
      taxId: String(formData.get('taxId') ?? ''),
      purchaseOrder: String(formData.get('purchaseOrder') ?? ''),
      authorizedSigner: String(formData.get('authorizedSigner') ?? ''),
      paymentReadiness: String(formData.get('paymentReadiness') ?? ''),
      paymentNotes: String(formData.get('paymentNotes') ?? ''),
      source: String(formData.get('source') ?? 'book_page'),
      contactId: String(formData.get('contactId') ?? ''),
      campaignId: String(formData.get('campaignId') ?? ''),
      websiteTrap: String(formData.get('websiteTrap') ?? ''),
      consent: formData.get('consent') === 'on',
    }

    setState({ status: 'submitting' })

    try {
      const response = await fetch('/api/qualification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result?.error || 'Submit failed')
      setState({
        status: 'success',
        message: result?.message || 'Qualification received. The operator has the call packet.',
        calendarUrl: result?.calendarUrl || calendarFallbackUrl,
        paymentUrl: result?.paymentUrl || paymentFallbackUrl,
      })
      form.reset()
    } catch (error) {
      setState({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Could not submit the qualification packet.',
      })
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-white/10 bg-zinc-950/[0.78] p-5 shadow-2xl shadow-black/30 sm:p-6"
    >
      <input type="hidden" name="source" value="book_page" />
      <input type="hidden" name="contactId" value="" />
      <input type="hidden" name="campaignId" value="" />
      <div className="hidden">
        <Label htmlFor="websiteTrap">Website</Label>
        <Input id="websiteTrap" name="websiteTrap" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="flex flex-col gap-3 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Call qualification</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-400">
            Share the setup, path, and timing so the walkthrough starts at decision level.
          </p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm font-medium text-emerald-200">
          <CalendarClock className="size-4" />
          Operator reviewed
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" name="fullName" required autoComplete="name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="workEmail">Work email</Label>
          <Input id="workEmail" name="workEmail" type="email" required autoComplete="email" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="company">Company</Label>
          <Input id="company" name="company" required autoComplete="organization" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="role">Role</Label>
          <Input id="role" name="role" autoComplete="organization-title" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="website">Website</Label>
          <Input id="website" name="website" placeholder="company.com" inputMode="url" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="monthlyOutboundVolume">Monthly outbound volume</Label>
          <Input
            id="monthlyOutboundVolume"
            name="monthlyOutboundVolume"
            required
            placeholder="Example: 8,000 emails/month"
          />
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <Label>Commercial path</Label>
        <div className="grid gap-3 md:grid-cols-2">
          {pathOptions.map((option, index) => (
            <label key={option.value} className="block cursor-pointer">
              <input
                className="peer sr-only"
                type="radio"
                name="commercialPath"
                value={option.value}
                defaultChecked={index === 0}
                required
              />
              <span className="block min-h-24 rounded-lg border border-white/10 bg-white/[0.03] p-4 transition peer-checked:border-blue-400 peer-checked:bg-blue-500/10 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-300">
                <span className="block text-sm font-semibold text-white">{option.label}</span>
                <span className="mt-2 block text-sm leading-6 text-zinc-400">
                  {option.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="useCase">Use case</Label>
          <select
            id="useCase"
            name="useCase"
            required
            defaultValue="internal_operations"
            className="h-9 w-full rounded-md border border-input bg-zinc-900/60 px-3 text-sm text-white shadow-xs outline-none transition focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {useCaseOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="timeline">Timeline</Label>
          <select
            id="timeline"
            name="timeline"
            required
            defaultValue="this_week"
            className="h-9 w-full rounded-md border border-input bg-zinc-900/60 px-3 text-sm text-white shadow-xs outline-none transition focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {timelineOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-6 space-y-2">
        <Label htmlFor="currentSetup">Current setup</Label>
        <Textarea
          id="currentSetup"
          name="currentSetup"
          required
          rows={4}
          placeholder="Domains, mailboxes, providers, CRM/source list, suppression process, and any current delivery issue."
        />
      </div>

      <div className="mt-6 space-y-3">
        <Label>Priority areas</Label>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {painOptions.map((option) => (
            <label
              key={option}
              className="flex min-h-11 items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-200"
            >
              <input
                type="checkbox"
                name="painPoints"
                value={option}
                className="size-4 rounded border-white/20 bg-zinc-900 accent-blue-500"
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="decisionOwner">Decision owner</Label>
          <Input
            id="decisionOwner"
            name="decisionOwner"
            required
            placeholder="Founder, RevOps lead, partner, or buyer group"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="preferredCallWindow">Preferred call window</Label>
          <Input
            id="preferredCallWindow"
            name="preferredCallWindow"
            required
            placeholder="Today 4-6 PM UK, tomorrow morning, etc."
          />
        </div>
      </div>

      <div className="mt-6 space-y-2">
        <Label htmlFor="notes">Deal notes</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={3}
          placeholder="Buying reason, required proof, stakeholder risk, or anything the operator should know before the call."
        />
      </div>

      <div className="mt-6 rounded-lg border border-blue-400/20 bg-blue-500/[0.06] p-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-white">Infinity payment details</h3>
          <p className="text-sm leading-6 text-zinc-400">
            These details go to the operator email so the invoice or payment link can be sent
            without another back-and-forth.
          </p>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="legalBuyerName">Legal buyer name</Label>
            <Input
              id="legalBuyerName"
              name="legalBuyerName"
              required
              placeholder="Company/legal entity buying the license"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="billingEmail">Billing email</Label>
            <Input
              id="billingEmail"
              name="billingEmail"
              type="email"
              required
              placeholder="finance@company.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="billingCountry">Billing country</Label>
            <Input id="billingCountry" name="billingCountry" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="authorizedSigner">Authorized signer</Label>
            <Input
              id="authorizedSigner"
              name="authorizedSigner"
              required
              placeholder="Person approved to sign/pay"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="taxId">Tax/VAT/GST ID</Label>
            <Input id="taxId" name="taxId" placeholder="Optional if not applicable" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="purchaseOrder">PO/reference</Label>
            <Input id="purchaseOrder" name="purchaseOrder" placeholder="Optional" />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <Label htmlFor="billingAddress">Billing address</Label>
          <Textarea
            id="billingAddress"
            name="billingAddress"
            required
            rows={3}
            placeholder="Registered billing address for invoice/payment records."
          />
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="paymentReadiness">Payment readiness</Label>
            <select
              id="paymentReadiness"
              name="paymentReadiness"
              required
              defaultValue="payment_link_today"
              className="h-9 w-full rounded-md border border-input bg-zinc-900/60 px-3 text-sm text-white shadow-xs outline-none transition focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {paymentReadinessOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="paymentNotes">Payment notes</Label>
            <Input
              id="paymentNotes"
              name="paymentNotes"
              placeholder="Currency, procurement rule, payer contact, etc."
            />
          </div>
        </div>
      </div>

      <label className="mt-6 flex items-start gap-3 text-sm leading-6 text-zinc-300">
        <input
          type="checkbox"
          name="consent"
          required
          className="mt-1 size-4 rounded border-white/20 bg-zinc-900 accent-blue-500"
        />
        <span>
          I am requesting a walkthrough and agree that these details can be used to prepare the
          call.
        </span>
      </label>

      {state.status === 'error' && (
        <div className="mt-5 flex gap-3 rounded-lg border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-100">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}

      {state.status === 'success' && (
        <div className="mt-5 rounded-lg border border-emerald-400/25 bg-emerald-500/10 p-3 text-sm text-emerald-100">
          <div className="flex gap-3">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <span>{state.message}</span>
          </div>
          <a
            href={state.calendarUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-md bg-emerald-200 px-3 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-100"
          >
            Pick 30-minute slot
            <ExternalLink className="size-4" />
          </a>
          {state.paymentUrl && (
            <a
              href={state.paymentUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 ml-0 inline-flex h-9 items-center gap-2 rounded-md bg-blue-200 px-3 text-sm font-semibold text-blue-950 transition hover:bg-blue-100 sm:ml-2"
            >
              Open Infinity payment
              <ExternalLink className="size-4" />
            </a>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-zinc-500">
          The operator receives the full qualification packet immediately.
        </p>
        <Button type="submit" size="lg" disabled={state.status === 'submitting'}>
          {state.status === 'submitting' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          Request walkthrough
        </Button>
      </div>
    </form>
  )
}
