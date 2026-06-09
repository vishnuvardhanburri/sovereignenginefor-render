# Agency Rescue Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Xavira's outbound engine focus on lead generation, RevOps, and outbound agencies using the £5,000 Campaign Rescue Sprint -> £3,000/month Control Partner motion.

**Architecture:** Add one GTM source-of-truth module and wire it into copy, scoring, queue selection, discovery, notifications, and sales-ready assets. Keep the system conversation-first: no pricing in cold emails, no booking pressure, and no enterprise/white-label pitch before proof.

**Tech Stack:** Next.js 16 App Router, TypeScript, PostgreSQL, Redis/BullMQ, OpenRouter-backed copy generation with deterministic fallback.

---

### Task 1: Add GTM Motion Source Of Truth

**Files:**
- Create: `code/apps/api-gateway/lib/xavira-gtm-motion.ts`
- Modify: `code/apps/api-gateway/lib/outbound-copy.ts`
- Modify: `code/apps/api-gateway/lib/sales-brain.ts`

- [x] Define ICP terms, agency share target, discovery question, forbidden first-touch pitch rules, and dominance-based follow-up steps.
- [x] Import the module from outbound copy and sales brain.
- [x] Verify outbound copy tests pass.

### Task 2: Make Queue And Scoring Agency-First

**Files:**
- Modify: `code/apps/api-gateway/lib/outbound-copy.ts`
- Modify: `code/apps/api-gateway/lib/intelligence/lead-scoring.ts`
- Modify: `code/apps/api-gateway/app/api/cron/daily-outbound/route.ts`

- [x] Change `idealAgencySharePct` from 50 to 80.
- [x] Make balance logic prefer agency leads before direct fallback.
- [x] Change shortfall metrics to the 80/20 target.
- [x] Downgrade non-agencies in lead scoring unless they have strong agency-like outbound pain.

### Task 3: Clean Follow-Up And Copy

**Files:**
- Modify: `code/apps/api-gateway/lib/outbound-copy.ts`
- Modify: `code/apps/api-gateway/lib/sequence-engine.ts`
- Modify: `code/apps/api-gateway/lib/telegram-notifications.ts`

- [x] Replace needy follow-up language with same-day clarity, Day 3 binary decision, Day 5 priority check, Day 8 close loop.
- [x] Keep cold first-touch focused on one diagnostic question.
- [x] Update Telegram mix language to agency-first instead of 50/50.

### Task 4: Discovery And Sales Assets

**Files:**
- Modify: `code/apps/api-gateway/lib/public-search-lead-source.ts`
- Modify: `code/scripts/sales-ready.mjs`
- Modify: `code/apps/api-gateway/scripts/test-outbound-copy.ts`
- Modify: `code/apps/api-gateway/scripts/test-telegram-notifications.ts`

- [x] Strengthen agency search queries.
- [x] Update sales-ready tracker to £5,000 and £3,000/month.
- [x] Add tests for agency-first queue selection and dominance follow-up language.
- [x] Run `pnpm -C code typecheck`, outbound copy tests, daily outbound tests, Telegram tests, and `git diff --check`.
