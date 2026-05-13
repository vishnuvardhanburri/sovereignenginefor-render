# Sovereign Engine 24/7 Cloud Runbook

This runbook moves the local sales proof into a 24/7 cloud setup on Render.

## What Runs 24/7

- `sovereign-engine-api`: Next.js control plane and health APIs.
- `sovereign-engine-reputation-worker`: reputation brain and monitoring worker.
- `sovereign-engine-sender-worker`: queue consumer for approved outbound jobs.
- `sovereign-engine-redis`: Redis-compatible Render Key Value for BullMQ.
- `sovereign-engine-postgres`: durable state, events, audit, contacts, and reputation tables.
- `sovereign-engine-outbound-cron`: 15-minute cron that enqueues reviewed leads only when explicitly enabled.

## Safety Defaults

- Real outbound cron is disabled by default: `OUTBOUND_CRON_ENABLED=false`.
- Unknown validation is blocked by default: `SEND_ALLOW_UNKNOWN_VALIDATION=false`.
- Sender starts conservatively: `GLOBAL_SENDS_PER_MINUTE=3`, `SENDER_WORKER_CONCURRENCY=1`, `LEGACY_LOOP_BATCH_SIZE=1`.
- Placeholder/template emails are skipped by `scripts/prepare-outbound-leads.mjs`.

## Render Deploy Steps

1. Push the repository with `render.yaml` at the repo root.
2. In Render, create a new Blueprint from the GitHub repository.
3. Fill required secret values when Render prompts:
   - `SMTP_HOST`
   - `SMTP_PORT`
   - `SMTP_USER`
   - `SMTP_PASS`
   - `SMTP_SECURE`
   - `SMTP_FROM_EMAIL`
   - `ZEROBOUNCE_API_KEY` or another validation provider before increasing volume.
4. Confirm the API service is healthy at:
   - `https://sovereign-engine-api.onrender.com/api/health`
   - `https://sovereign-engine-api.onrender.com/api/health/stats`
5. Keep `OUTBOUND_CRON_ENABLED=false` until DNS, SMTP, suppression, and approved lead CSV are ready.

## Enabling Everyday Outreach

Use a reviewed lead file with this schema:

```csv
buyer_email,buyer_name,company,consent_source,reason_to_contact,status
founder@company.com,Founder Name,Company,legitimate_business_interest,Specific reason this company is relevant,approved
```

Then enable the cron only after a test send lands correctly:

```text
OUTBOUND_CRON_ENABLED=true
OUTBOUND_CRON_LIMIT=5
OUTBOUND_CRON_MAX_LIMIT=25
```

Start with 5 emails per 15 minutes. Do not jump to high daily volume until replies, bounces, complaints, and DNS health stay clean.

## Local Cloud-Cron Test

From the repo root:

```bash
cd "/Users/vishnuvardhanburri/Code/sovereign-engine"
OUTBOUND_CRON_ENABLED=false pnpm -C code cloud:cron
```

For local testing against the root-level acquisition files:

```bash
cd "/Users/vishnuvardhanburri/Code/sovereign-engine"
OUTBOUND_CRON_ENABLED=true \
OUTBOUND_LEADS_SOURCE=../docs/acquisition/LEADS_TEMPLATE.csv \
OUTBOUND_PREPARED_CSV=../docs/acquisition/CLIENTS_TODAY.csv \
OUTBOUND_CRON_LIMIT=1 \
pnpm -C code cloud:cron
```

## Free Render Bridge Mode

If there is no budget for paid background workers yet, the web service can run a tiny sender worker in the same free container.

This is a bridge, not the ideal production topology. Use it only for low-volume reviewed business outreach.

Add these environment variables to the Render web service:

```text
WEB_EMBED_SENDER_WORKER=true
WEB_EMBED_REPUTATION_WORKER=false
OUTBOUND_CRON_ENABLED=true
OUTBOUND_CRON_LIMIT=1
OUTBOUND_CRON_MAX_LIMIT=3
CRON_SECRET=<generate a long random value>
SENDER_PHYSICAL_ADDRESS=Xavira Tech Labs, India
OUTBOUND_CRON_RECIPIENTS=founder@company.com,ops@company.com
```

Then configure a free URL cron monitor to call:

```text
https://sovereignenginefor-render.onrender.com/api/cron/outbound?secret=<CRON_SECRET>&limit=1
```

Recommended free-mode cadence:

- Every 30-60 minutes.
- Limit 1 per run.
- Keep under 20-30/day until reply, bounce, and inbox placement are stable.
- Never put placeholder/test emails in `OUTBOUND_CRON_RECIPIENTS`.

## Volume Reality

For new domains/mailboxes, start tiny. A credible ramp is more valuable than burning domains:

- Day 1-3: 20-50/day total across warmed mailboxes.
- Day 4-7: 50-100/day if no bounce/complaint issues.
- Week 2: 100-250/day with validated lists and good replies.
- Week 3+: scale toward 500/day only with ESP capacity, validation, suppression, and monitoring.

For 500/day, use Brevo/Resend/managed SMTP capacity, not a single personal Hostinger mailbox.
