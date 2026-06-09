import { ArrowRight, CheckCircle2, ClipboardCheck, Repeat2, ShieldCheck } from 'lucide-react'
import { XAVIRA_COMMERCIAL_MODEL } from '@/lib/commercial-model'

const rescueIncludes = [
  'Review one live outbound campaign, not a fake sample.',
  'Check lead quality, first email, follow-up flow, sender/domain risk, and reply blockers.',
  'Rewrite the first email and one follow-up around the real buyer pain.',
  'Return a simple client-facing summary your agency can use as proof.',
  'Delivered founder-led in 3-5 days.',
]

const notIncluded = [
  'No long enterprise procurement process.',
  'No bulk sending promise.',
  'No generic email template pack.',
  'No dashboard sale before the problem is proven.',
]

const followOnIncludes = [
  'Weekly review of active campaigns and reply learning.',
  'Client-facing proof notes for deliverability, follow-up, and reporting risk.',
  'Ongoing improvement of outbound angles from real campaign evidence.',
  'Founder/operator support while the agency converts the first rescued campaign into a retained client result.',
]

export const metadata = {
  title: 'Campaign Rescue Sprint | Xavira',
  description:
    '£500 founder-led outbound campaign rescue sprint for agencies and operators that need better replies, proof, and client trust.',
}

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="max-w-3xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-200">
            <ClipboardCheck size={16} /> First Customer Offer
          </div>
          <h1 className="text-4xl font-black tracking-tight md:text-6xl">
            Rescue one underperforming outbound campaign for £500.
          </h1>
          <p className="mt-5 text-lg leading-8 text-slate-300">
            Xavira starts as a founder-led Campaign Rescue Sprint. We review the campaign,
            find the real blockers, rewrite the message, and give you a simple proof summary
            before asking anyone to buy a larger system.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              href="/book"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-emerald-300 px-5 text-sm font-bold text-emerald-950 transition hover:bg-emerald-200"
            >
              Start the £500 sprint
              <ArrowRight size={16} />
            </a>
            <a
              href="https://cal.com/vishnuvardhanburri/30min"
              className="inline-flex h-11 items-center justify-center rounded-md border border-white/10 px-5 text-sm font-semibold text-slate-100 transition hover:bg-white/5"
            >
              Ask before paying
            </a>
          </div>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-lg border border-emerald-300/30 bg-emerald-400/10 p-7">
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.22em] text-emerald-200">
              <ShieldCheck size={16} />
              Entry Offer
            </div>
            <h2 className="mt-4 text-3xl font-black">
              {XAVIRA_COMMERCIAL_MODEL.campaignRescueSprint.name}
            </h2>
            <div className="mt-6 text-5xl font-black text-emerald-200">
              {XAVIRA_COMMERCIAL_MODEL.campaignRescueSprint.label}
            </div>
            <p className="mt-3 text-sm font-semibold uppercase tracking-[0.2em] text-emerald-100">
              One-time GBP payment
            </p>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-300">
              Best for lead generation agencies, RevOps agencies, and founders who have a real
              campaign but low replies, weak proof, unclear follow-up ownership, or client pressure
              around why the campaign is not converting.
            </p>
            <ul className="mt-7 space-y-3 text-sm text-slate-100">
              {rescueIncludes.map((feature) => (
                <li key={feature} className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-300" size={16} />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-7">
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.22em] text-slate-300">
              <Repeat2 size={16} />
              After Proof
            </div>
            <h2 className="mt-4 text-2xl font-black">
              {XAVIRA_COMMERCIAL_MODEL.controlPartnerMonthly.name}
            </h2>
            <div className="mt-6 text-4xl font-black text-cyan-200">
              {XAVIRA_COMMERCIAL_MODEL.controlPartnerMonthly.label}
            </div>
            <p className="mt-3 text-sm font-semibold uppercase tracking-[0.2em] text-cyan-100">
              Optional monthly follow-on
            </p>
            <p className="mt-5 text-sm leading-7 text-slate-300">
              This is not the first sale. It only makes sense when the rescue sprint exposes a
              real operating pain and the buyer wants ongoing help keeping client campaigns under
              control.
            </p>
            <ul className="mt-7 space-y-3 text-sm text-slate-200">
              {followOnIncludes.map((feature) => (
                <li key={feature} className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 shrink-0 text-cyan-300" size={16} />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-8 rounded-lg border border-amber-400/20 bg-amber-400/10 p-6">
          <div className="text-sm font-bold uppercase tracking-[0.22em] text-amber-200">
            What this is not
          </div>
          <ul className="mt-5 grid gap-3 text-sm text-slate-200 md:grid-cols-2">
            {notIncluded.map((item) => (
              <li key={item} className="flex gap-3">
                <CheckCircle2 className="mt-0.5 shrink-0 text-amber-300" size={16} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-8 max-w-4xl text-sm leading-7 text-slate-400">
          The goal is simple: get the first useful business conversation from a real campaign.
          If the sprint does not reveal a practical problem worth solving, we do not push a
          bigger platform sale.
        </p>
      </section>
    </main>
  )
}
