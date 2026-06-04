# Buyer FAQ

## What is Sovereign Engine?

Sovereign Engine is a Deliverability Operating System: outbound revenue protection infrastructure for teams that rely on healthy domains, controlled queues, and provider-aware reputation monitoring.

## Who is the buyer?

Ideal buyers are outbound SaaS teams, agencies, growth infrastructure companies, RevOps tooling companies, and technical operators who want to add deliverability control-plane infrastructure to an existing distribution channel.

## Is there revenue?

No revenue is claimed. Pricing and ROI views are monetization signals only.

## Are the metrics real?

The proof metrics are simulated and clearly labeled. The system generates seeded 10,000-event proof data to demonstrate architecture, queue flow, reputation scoring, and buyer diligence readiness.

## Can it send 100k+ emails per day?

Sovereign Engine is positioned as a 100k+/day control-plane and orchestration layer. The software includes queueing, worker telemetry, reputation state, provider-lane controls, safe-ramp logic, health checks, and stress-proof tooling. Actual real-world sending volume depends on the operator’s domains, ESP/MTA limits, DNS authentication, warmup history, compliance policy, suppression quality, and provider rules.

## What is simulated versus real?

Simulated: demo metrics, 10,000-event stress proof, seeded provider lanes, sample contacts, and ROI-style evaluation values.

Real: Docker stack, Next.js app, Postgres schema, Redis/BullMQ queueing, worker heartbeat surfaces, API routes, audit-chain implementation, production gate, launch script, and data-room generation.

## Why is real sending gated?

Real sending is intentionally locked until operator-owned inputs are connected. This prevents accidental traffic, protects credentials, and keeps the system aligned with provider policy and compliance expectations. Required inputs include verified domains, SPF/DKIM/DMARC DNS, SMTP/ESP credentials, production secrets, suppression policy, unsubscribe handling, and lawful contact sourcing.

## Why could this be worth a £200K+ acquisition ask?

The value is in saved build time, working infrastructure, technical breadth, acquisition packaging, and a clear market narrative: protecting communication operations before domain reputation damage becomes expensive. The product is priced as premium infrastructure with a £40,000 internal enterprise license, £160,000 white-label commercial license, and £3,000/month operations and maintenance.

## What is included?

The repo, Docker production stack, command center, reputation APIs, queue/worker proof, health oracle, pricing page, license-validation demo endpoint, API-key endpoint, data-room generator, launch-ready script, and acquisition docs.

## What does a buyer still need?

Buyer-owned domains, DNS access, SMTP/ESP credentials, production secrets, compliance policy, suppression policy, and customer distribution.

## What does the operator get immediately?

A deployable command center, reputation dashboard, health oracle, queue/worker architecture, public reputation API surface, pricing/license demo endpoints, acquisition docs, Docker production stack, setup scripts, and repeatable proof commands.

## Does it guarantee inbox placement?

No. It provides controls, monitoring, safe-ramp logic, and operational visibility. It does not promise guaranteed inbox placement.

## How should it be described safely?

Use: “Deployment-ready deliverability control plane with real sending gated until operator credentials, DNS, and compliance inputs are connected.”

Avoid: “Guaranteed inbox,” “bypasses provider filters,” “send unlimited email instantly,” or “production sending requires nothing else.”

## How do I run the proof?

```bash
pnpm launch:ready
```

Then open:

```text
http://localhost:3400/login
demo@sovereign.local
Demo1234!
```

## How do I generate the data room?

```bash
pnpm generate:data-room
```
