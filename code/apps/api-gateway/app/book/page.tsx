import type { Metadata } from 'next'
import { ArrowRight, Building2, CheckCircle2, ShieldCheck } from 'lucide-react'
import { QualificationForm } from './qualification-form'

export const metadata: Metadata = {
  title: 'Book Walkthrough | Sovereign Engine',
  description:
    'Qualification page for Sovereign Engine and Xavira Control Stack walkthrough calls.',
}

const callPacket = [
  'Use case and commercial path',
  'Domains, mailboxes, providers, and outbound volume',
  'Timeline, decision owner, and required proof',
  '30-minute Cal.com slot after details are submitted',
]

export default function BookPage() {
  return (
    <main className="min-h-screen bg-[#08090b] text-white">
      <header className="border-b border-white/10 bg-black/40">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold">
              SE
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-white">Sovereign Engine</div>
              <div className="truncate text-xs text-zinc-500">
                Communication Operations Infrastructure
              </div>
            </div>
          </div>
          <a
            href="/pricing"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm font-medium text-zinc-200 transition hover:bg-white/5"
          >
            Pricing
            <ArrowRight className="size-4" />
          </a>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-7 px-5 py-7 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-5">
          <div className="space-y-3">
            <div className="flex size-11 items-center justify-center rounded-lg border border-blue-400/30 bg-blue-500/10 text-blue-200">
              <ShieldCheck className="size-5" />
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Book the operator walkthrough.
            </h1>
            <p className="text-sm leading-7 text-zinc-400">
              This page collects the details required before a serious licensing call for Xavira
              Control Stack.
            </p>
          </div>

          <div className="rounded-lg border border-white/10 bg-zinc-950/70 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-200">
              <Building2 className="size-4" />
              Commercial paths
            </div>
            <div className="mt-4 space-y-4">
              <div>
                <div className="text-2xl font-semibold text-white">£40,000</div>
                <p className="mt-1 text-sm leading-6 text-zinc-400">
                  Internal enterprise operations license.
                </p>
              </div>
              <div className="border-t border-white/10 pt-4">
                <div className="text-2xl font-semibold text-white">£160,000</div>
                <p className="mt-1 text-sm leading-6 text-zinc-400">
                  White-label commercial license for client-facing deployment rights.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-zinc-950/70 p-4">
            <div className="text-sm font-semibold text-white">Call packet</div>
            <ul className="mt-4 space-y-3">
              {callPacket.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-6 text-zinc-300">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-300" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <QualificationForm />
      </section>
    </main>
  )
}
