#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const repoRoot = path.resolve(root, '..')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const outDir = path.join(root, 'output', 'sales-ready', stamp)
const latestDir = path.join(root, 'output', 'sales-ready', 'latest')
const appUrl = process.env.SALES_APP_URL ?? 'http://localhost:3400'

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function write(file, content) {
  await fs.writeFile(path.join(outDir, file), content.trimStart(), 'utf8')
}

async function healthStatus() {
  try {
    const response = await fetch(`${appUrl}/api/health/stats?client_id=1`, { signal: AbortSignal.timeout(2500) })
    if (!response.ok) return { ok: false, note: `Health endpoint returned ${response.status}` }
    const body = await response.json()
    return {
      ok: true,
      note: `Live health OK. DB ${body.infrastructure_latency?.db_reputation_state_ms ?? '?'}ms, Redis ${body.infrastructure_latency?.redis_get_ms ?? '?'}ms.`,
    }
  } catch {
    return {
      ok: false,
      note: `Local app not reachable at ${appUrl}. Run: pnpm -C code launch:ready --quick`,
    }
  }
}

const dealTrackerCsv = `deal_name,target_amount,buyer_segment,buyer_name,company,status,next_action,deadline,notes
Fast License 1,25000,Outbound agency,,,lead_needed,send 20 targeted messages,today,Close first fast cash buyer
Fast License 2,25000,AI automation or lead-gen agency,,,lead_needed,book 2 demo calls,this_week,Second $25K proof deal
Strategic License A,75000,Growth infrastructure company,,,lead_needed,send strategic buyer message,this_week,Do not discount below $75K
Acquisition Buyer A,125000,Micro-SaaS/acquirer,,,lead_needed,share demo after reply,this_week,Protect $125K+ anchor
Acquisition Buyer B,200000,Strategic infra buyer,,,lead_needed,start acquisition discussion,next_14_days,Part of $600K target
`

const leadListCsv = `company,website,buyer_name,buyer_role,buyer_email,linkedin,segment,deal_target,reason_to_buy,status,next_action,last_contacted_at,notes
,,,,,,outbound_agency,25000,,not_contacted,send_fast_license_message,,
,,,,,,ai_automation_agency,25000,,not_contacted,send_fast_license_message,,
,,,,,,growth_infra_company,75000,,not_contacted,send_strategic_license_message,,
,,,,,,micro_saas_buyer,125000,,not_contacted,send_acquisition_message,,
,,,,,,strategic_infra_buyer,200000,,not_contacted,send_acquisition_message,,
`

const fast25kMessage = `# $25K Fast-Close Messages

## Subject Options

- private outbound infrastructure asset
- infrastructure your outbound team could own
- quick question on outbound infra

## Message

Hi {{first_name}},

I am Vishnu, founder of Xavira Tech Labs.

I built Sovereign Engine + Sovereign Shield: a private outbound revenue infrastructure stack with a reputation command center, health oracle, queue control, audit evidence, Docker deployment, and buyer-ready proof artifacts.

It is not positioned as another email tool. It is an internal infrastructure system for teams that care about deliverability, monitoring, safe scaling, and operator control.

We are opening two fast $25K private license/deployment slots while continuing larger acquisition conversations.

Would it make sense to show you the 5-minute local proof walkthrough?

## Follow-Up

Quick follow-up, {{first_name}}.

The fastest way to judge this is not a sales deck. I can show local Docker launch, reputation command center, health oracle, mock-safe stress proof, and the data-room ZIP.

If your team works with outbound, lead-gen, or growth infrastructure, this may be worth a quick look.
`

const strategic600kMessage = `# $600K Strategic Pipeline Messages

## Subject Options

- acquisition-ready outbound infrastructure
- strategic asset: deliverability operating system
- private growth infrastructure platform

## Message

Hi {{first_name}},

I am Vishnu, founder of Xavira Tech Labs.

We built Sovereign Engine + Sovereign Shield as an acquisition-ready infrastructure asset: deliverability operating system, reputation command center, health oracle, audit/security evidence, Docker deployment, and cross-platform control-plane architecture.

We are currently exploring:

- $25K private license/deployment slots for fast operators
- $75K+ strategic private licenses
- $125K+ full acquisition conversations

If your team is buying or building outbound, growth, security, or automation infrastructure, this may be faster than starting from zero.

Open to a short technical walkthrough?

## Qualification Question

Which path is more relevant for you: private license/deployment, strategic license, or full acquisition?
`

const callScript = `# Demo Call Script

## Opening

Thanks for taking a look. I will keep this practical. Sovereign Engine is not another sending tool. It is an operational control layer for outbound revenue infrastructure: reputation visibility, queue governance, worker health, audit evidence, and buyer-ready deployment proof.

## Show In This Order

1. Dashboard: ${appUrl}/dashboard
2. Reputation investor view: ${appUrl}/reputation?investor=1
3. Health oracle: ${appUrl}/api/health/stats?client_id=1
4. Terminal proof: pnpm -C code launch:ready --quick
5. Data-room ZIP: pnpm -C code generate:data-room

## Close

Which path fits you better: the $25K private license/deployment sprint, or a broader strategic license/acquisition conversation?

## If They Ask Price

Fast license/deployment is $25K. Strategic license starts at $75K. Full acquisition discussion starts at $125K.

## If They Ask About Production

The demo is mock-safe and fully local. The architecture is production-oriented with Docker, Redis, Postgres, workers, audit evidence, and health checks. Real production use requires the buyer's domains, providers, secrets, and compliance review.
`

const dailyPlan = `# 7-Day Closing Plan

## Daily Numbers

- Research 30 serious prospects
- Send 20 highly personalized emails
- Send 10 LinkedIn messages
- Follow up 10 prior prospects
- Book 1-2 calls
- Share data room only after clear interest

## Day 1

- Build 50-person list.
- Send first 20 $25K fast-license messages.
- Send 10 LinkedIn messages.

## Day 2

- Send second 20 messages.
- Follow up first batch.
- Run first demos.

## Days 3-4

- Push $25K close to fast operators.
- Push $75K-$125K path to bigger buyers.

## Days 5-7

- Close two $25K buyers.
- Keep 3 strategic acquisition conversations active.

## Rule

Do not say this is discounted. Say it is a limited fast license/deployment slot.
`

async function main() {
  await ensureDir(outDir)
  const health = await healthStatus()

  await write('README.md', `# Sovereign Engine Sales Ready Pack

Generated: ${new Date().toISOString()}

Live app: ${appUrl}

Health:

${health.ok ? 'PASS' : 'NEEDS START'} - ${health.note}

## Immediate Goal

- Close 2 x $25K fast license/deployment deals.
- Keep $600K strategic pipeline alive through $75K licenses and $125K+ acquisition talks.

## Run Demo

\`\`\`bash
cd "${repoRoot}"
pnpm -C code launch:ready --quick
\`\`\`

Open:

- ${appUrl}/login
- ${appUrl}/dashboard
- ${appUrl}/reputation?investor=1
- ${appUrl}/api/health/stats?client_id=1

Login:

\`\`\`text
demo@sovereign.local
Demo1234!
\`\`\`

## Files In This Pack

- deal-tracker.csv
- lead-list.csv
- outreach-25k.md
- outreach-600k.md
- call-script.md
- daily-plan.md
`)

  await write('deal-tracker.csv', dealTrackerCsv)
  await write('lead-list.csv', leadListCsv)
  await write('outreach-25k.md', fast25kMessage)
  await write('outreach-600k.md', strategic600kMessage)
  await write('call-script.md', callScript)
  await write('daily-plan.md', dailyPlan)

  await fs.rm(latestDir, { recursive: true, force: true })
  await fs.mkdir(path.dirname(latestDir), { recursive: true })
  await fs.cp(outDir, latestDir, { recursive: true })

  console.log('Sovereign Engine Sales Ready Pack')
  console.log(`Status: ${health.ok ? 'LIVE' : 'APP NOT RUNNING'}`)
  console.log(`Note: ${health.note}`)
  console.log(`Output: ${outDir}`)
  console.log(`Latest: ${latestDir}`)
  console.log('')
  console.log('Next commands:')
  console.log('  pnpm -C code launch:ready --quick')
  console.log('  open code/output/sales-ready/latest')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
