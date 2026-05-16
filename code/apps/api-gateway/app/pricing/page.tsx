import { CheckCircle2, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react'

const plans = [
  {
    name: 'Private License',
    price: '$25,000',
    description: 'For agencies, SaaS teams, and growth operators that want a private outbound and AI security infrastructure layer.',
    features: [
      'One-time Sovereign Stack license',
      'Outbound reputation command center',
      'AI security and PII-risk positioning pack',
      'Self-hosted or managed deployment path',
      'Payment plan: $8k now, $8k in 30 days, $9k in 60 days',
    ],
  },
  {
    name: 'Agency Master License',
    price: '$100,000',
    description: 'For agencies that want to white-label Sovereign Stack as a premium client infrastructure offer.',
    features: [
      'White-label positioning and handoff pack',
      'Unlimited client deployment rights under one agency',
      'Outbound infrastructure plus AI-risk audit offer',
      'Agency sales scripts and client onboarding templates',
      'Built to recover cost across 5-8 client deployments',
    ],
    featured: true,
  },
  {
    name: 'Strategic Acquisition',
    price: 'Contact Sales',
    description: 'For buyers evaluating the full asset, private repo, deployment system, and acquisition-grade data room.',
    features: [
      'Full source-code review and technical diligence pack',
      'Architecture, queue, worker, and audit-chain proof',
      'Buyer data room and deployment runbook',
      'Custom transition and founder handoff',
      'Strategic discussions for $125k+ acquisition paths',
    ],
  },
]

const platformIncludes = [
  'Command center for provider lanes, queue state, worker heartbeat, and reputation events.',
  'AI security positioning for teams worried about PII exposure, model usage, and audit trails.',
  'Postgres, Redis/BullMQ, sender-worker, reputation-worker, audit trail, and health oracle.',
  'Safe evaluation mode with 10,000-event mock proof and no external email traffic.',
  'Production gate that blocks real sending until required operator inputs are configured.',
]

const operatorConnects = [
  'Operator-owned sending domains, DNS records, legal sender identity, and HTTPS host.',
  'SMTP/ESP credentials, API keys, production secrets, and provider quotas.',
  'Consent-aware contact source, suppression list, unsubscribe policy, and compliance process.',
  'Warmup/reputation policy appropriate for the operator’s own domains and sending history.',
]

export const metadata = {
  title: 'Pricing | Sovereign Stack',
  description: 'Pricing for Sovereign Stack, outbound revenue protection and AI security infrastructure.',
}

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="max-w-3xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-200">
            <ShieldCheck size={16} /> Outbound + AI Security Infrastructure
          </div>
          <h1 className="text-4xl font-black tracking-tight md:text-6xl">
            Sovereign Stack protects outbound revenue and AI usage in one license.
          </h1>
          <p className="mt-5 text-lg leading-8 text-slate-300">
            Stop burning domains, reduce deliverability surprises, and give teams a private
            infrastructure layer for outbound operations, AI-risk reviews, audit trails, and
            deployment control.
          </p>
        </div>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl border p-7 ${plan.featured ? 'border-cyan-300 bg-cyan-400/10' : 'border-white/10 bg-white/[0.03]'}`}
            >
              <h2 className="text-2xl font-black">{plan.name}</h2>
              <p className="mt-2 min-h-14 text-sm text-slate-400">{plan.description}</p>
              <div className="mt-7 text-4xl font-black text-cyan-200">{plan.price}</div>
              <ul className="mt-7 space-y-3 text-sm text-slate-200">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-3">
                    <CheckCircle2 className="mt-0.5 shrink-0 text-cyan-300" size={16} />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-8 text-sm text-slate-500">
          Pricing reflects an enterprise infrastructure layer, not commodity email volume.
          Production sending depends on operator-owned domains, ESP quotas, DNS, compliance
          policy, and warmup strategy. No revenue claims are implied.
        </p>

        <div className="mt-12 grid gap-5 md:grid-cols-2">
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-6">
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.22em] text-emerald-200">
              <ShieldCheck size={16} /> Included in Sovereign Stack
            </div>
            <ul className="mt-5 space-y-3 text-sm text-slate-200">
              {platformIncludes.map((item) => (
                <li key={item} className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-300" size={16} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-6">
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.22em] text-amber-200">
              <KeyRound size={16} /> Operator Connects
            </div>
            <ul className="mt-5 space-y-3 text-sm text-slate-200">
              {operatorConnects.map((item) => (
                <li key={item} className="flex gap-3">
                  <LockKeyhole className="mt-0.5 shrink-0 text-amber-300" size={16} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </main>
  )
}
