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
Rescue Sprint 1,500,Lead generation agency,,,lead_needed,send 20 targeted messages,today,Close first paid campaign rescue
Rescue Sprint 2,500,RevOps agency,,,lead_needed,book 2 rescue intakes,this_week,Second paid proof deal
Control Partner A,1500,Lead generation agency,,,lead_needed,send partner follow-up after sprint,this_month,Only discuss after rescue proof
Control Partner B,1500,RevOps agency,,,lead_needed,share client-facing proof after sprint,this_month,Monthly support path after value is proven
Control Partner C,1500,Outbound agency,,,lead_needed,start monthly partner discussion,next_14_days,Do not pitch before campaign pain is clear
`

const leadListCsv = `company,website,buyer_name,buyer_role,buyer_email,linkedin,segment,deal_target,reason_to_buy,status,next_action,last_contacted_at,notes
,,,,,,lead_generation_agency,500,,not_contacted,send_rescue_sprint_message,,
,,,,,,revops_agency,500,,not_contacted,send_rescue_sprint_message,,
,,,,,,outbound_agency,500,,not_contacted,send_rescue_sprint_message,,
,,,,,,agency_partner_candidate,1500,,not_contacted,send_post_sprint_partner_message,,
,,,,,,client_services_agency,1500,,not_contacted,send_post_sprint_partner_message,,
`

const rescueSprintMessage = `# £500 Campaign Rescue Sprint Messages

## Subject Options

- campaign reply visibility
- client campaign proof
- what breaks first?

## Message

Hi {{first_name}},

I noticed {{company}} is close to outbound campaign delivery, where low replies can get blamed on lead quality, deliverability, message fit, follow-up timing, or reporting.

That becomes expensive when the team cannot show what is actually causing the campaign to underperform.

Xavira helps diagnose one live campaign and turn the evidence into a clearer first email, follow-up, and client-facing summary.

When a campaign underperforms, what do clients usually blame first?

## Follow-Up

Quick follow-up, {{first_name}}.

The reason I asked is that campaign problems are often misdiagnosed from surface metrics alone.

Is the hardest part for {{company}} usually lead quality, deliverability, follow-up ownership, or reporting proof?
`

const controlPartnerMessage = `# £1,500/month Control Partner Messages

## Subject Options

- after the rescue sprint
- campaign control partner
- client campaign proof

## Message

Hi {{first_name}},

After one campaign rescue proves a real gap, the monthly path is simple: Xavira helps the agency keep campaign diagnosis, reply learning, follow-up visibility, and client-facing proof under control.

This should only be discussed when the agency already has a live campaign pain and wants ongoing support.

The entry point is still one £500 campaign rescue sprint. Monthly support comes after proof, not before.

## Qualification Question

Which client campaign would be most useful to diagnose first?
`

const callScript = `# Demo Call Script

## Opening

Thanks for taking a look. I will keep this practical. Xavira starts by rescuing one live outbound campaign, not by selling a big dashboard. The goal is to separate lead quality, message fit, inbox placement, follow-up, and reporting problems.

## Show In This Order

1. Pricing: ${appUrl}/pricing
2. Sprint intake: ${appUrl}/book
3. Sent mail proof: ${appUrl}/sent
4. Dashboard: ${appUrl}/dashboard
5. Health oracle: ${appUrl}/api/health/stats?client_id=1

## Close

Which one campaign should we diagnose first?

## If They Ask Price

The Campaign Rescue Sprint is £500 GBP one-time. If the sprint proves there is an ongoing campaign-control problem, the optional Xavira Control Partner path is £1,500/month.

## If They Ask About Production

The first deliverable is not infrastructure transfer. It is a founder-led review of one real campaign, one rewritten first email, one rewritten follow-up, and a simple proof summary.
`

const dailyPlan = `# 7-Day Closing Plan

## Daily Numbers

- Research 30 serious prospects
- Send 20 highly personalized emails
- Send 10 LinkedIn messages
- Follow up 10 prior prospects
- Get 1-2 campaign rescue intakes
- Share proof only after clear interest

## Day 1

- Build 50-person list.
- Send first 20 rescue-sprint messages.
- Send 10 LinkedIn messages.

## Day 2

- Send second 20 messages.
- Follow up first batch.
- Run first demos.

## Days 3-4

- Push £500 sprint to agencies with one live campaign pain.
- Only discuss £1,500/month partner path after campaign proof.

## Days 5-7

- Close two £500 Campaign Rescue Sprints.
- Keep 3 monthly Control Partner conversations active after proof.

## Rule

Do not say this is discounted. Say it is a focused founder-led rescue of one live campaign.
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

- Close 2 x £500 Campaign Rescue Sprint deals.
- Build the £1,500/month Control Partner pipeline only after sprint proof.

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
- outreach-rescue-sprint.md
- outreach-control-partner.md
- call-script.md
- daily-plan.md
`)

  await write('deal-tracker.csv', dealTrackerCsv)
  await write('lead-list.csv', leadListCsv)
  await write('outreach-rescue-sprint.md', rescueSprintMessage)
  await write('outreach-control-partner.md', controlPartnerMessage)
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
