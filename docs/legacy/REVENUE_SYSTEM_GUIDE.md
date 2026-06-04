# Sovereign Engine: Legacy Outbound Revenue System

**Version 2.0** — Production-Grade Email Automation & Pipeline Generation

---

## What This System Does

Sovereign Engine **replaces the SDR workflow** with a fully automated outbound revenue engine.

```
Leads → Personalized Email → Warmup → Domain Safety → Reply Detection → 
Pipeline Management → Optimization Loop → Revenue
```

**NOT an email tool. A revenue machine.**

---

## System Architecture

### 1. **Control Layer (Brain)**

The `BossAgent` makes all strategic decisions:
- Analyze campaign metrics in real time
- Detect domain health issues
- Pause sends if bounce rate > 5%
- Reduce volume if reply rate < 2%
- Accelerate volume when reply rate > 5%

**Files:**
- `lib/agents/boss-agent.ts` — Core decision engine
- `lib/agents/executor.ts` — Executes boss decisions

---

### 2. **Lead Engine**

Import, deduplicate, validate, enrich, and segment leads.

**Capabilities:**
- CSV/API import
- Email verification (ZeroBounce optional)
- Company enrichment (Clearbit, Apollo optional)
- Duplicate detection
- Suppression list enforcement

**Files:**
- `lib/backend.ts` — Lead CRUD operations
- `lib/compliance.ts` — Suppression & unsubscribe handling

---

### 3. **Personalization Engine**

Generate human-like, relevant email copy.

**Features:**
- Dynamic variable replacement: `{{FirstName}}`, `{{Company}}`, `{{Title}}`
- AI-powered intro line generation (OpenRouter optional)
- Spam signal detection (auto-reject high-risk copy)
- 5-line email limit (human tone required)
- Question ending enforcement

**Files:**
- `lib/personalization.ts` — Core personalization logic
- `lib/agents/intelligence/personalization-agent.ts` — AI intro generation
- `lib/agents/intelligence/subject-agent.ts` — Subject line variation
- `lib/operator.ts` — Copy validation & operator rules

---

### 4. **Campaign Engine**

Multi-step email sequences with auto follow-ups.

**Flow:**
1. **Step 1** — Initial hook email
2. **Step 2** — Follow-up with new angle (day 2–7)
3. **Step 3** — Final touch or case proof (day 7+)

**Auto-Stop Rules:**
- Stop on reply (any contact status → "replied")
- Stop if bounced
- Stop if unsubscribed

**Files:**
- `lib/backend.ts` — Campaign & sequence management
- `lib/agents/execution/follow-up-agent.ts` — Follow-up scheduling
- `cron/run.ts` — Daily campaign orchestration

---

### 5. **Sending Engine (BillionMail SMTP)**

**Multi-domain rotation. Multi-inbox usage. Safe warmup.**

**Rules:**
- 60–120 second delay between sends
- Max 1,000 emails/day/domain
- Warmup control (stage 1–7)
- Identity (from-email) daily limits enforced
- Test mode support (internal-only recipients)

**Features:**
- Exponential backoff retry (max 3 attempts)
- Plain-text emails only
- SMTP envelope validation
- Rejected recipient handling
- Message ID tracking

**Files:**
- `lib/integrations/billionmail.ts` — SMTP transport
- `lib/agents/execution/sender-agent.ts` — Send wrapper
- `worker/index.ts` — Worker process
- `lib/backend.ts` — Queue job lifecycle
- `lib/env.ts` — SMTP configuration

---

### 6. **Risk Engine**

**Real-time failure detection and auto-recovery.**

**Pause Conditions:**
- `bounce_rate > 5%` → domain status = "paused"
- `health_score < 50` → reduce volume
- `failed_jobs > 10` in 1 hour → pause campaign

**Auto-Healing Actions:**
- Reduce send volume
- Delay sends with backoff
- Switch to alternate domains
- Escalate critical failures

**Files:**
- `lib/agents/data/risk-agent.ts` — Risk detection
- `lib/agents/control/self-healing-agent.ts` — Recovery logic
- `lib/agents/control/warmup-agent.ts` — Warmup safety

---

### 7. **Inbox System**

**Unified reply management with smart classification.**

**Features:**
- Automatically detect replies from Gmail, Outlook, etc.
- Classify: `interested`, `not_interested`, `ooo`, `unsure`
- AI classification optional (OpenRouter)
- Bulk status updates
- Campaign reply aggregation

**Smart Rules:**
- Mark contact as "replied" (auto-stops sequence)
- Track positive reply rate
- Detect out-of-office
- Flag objections for follow-up

**Files:**
- `lib/backend.ts` — Reply CRUD & event tracking
- `lib/agents/inbox/reply-classifier.ts` — Classification logic
- `lib/agents/inbox/objection-handler.ts` — Objection strategy
- `lib/agents/inbox/response-writer.ts` — Auto-response suggestions
- `app/(dashboard)/inbox/` — UI for inbox management

---

### 8. **Optimization Engine**

**Daily campaign improvements based on performance.**

**Daily Loop (via cron):**
1. Collect metrics (sent, replies, bounces, opens)
2. Assess domain health
3. Calculate reply rate & bounce rate
4. Detect anomalies
5. Recommend subject line adjustments
6. Suggest volume changes
7. Execute optimizations

**Files:**
- `lib/services/metrics.ts` — Metrics collection
- `lib/agents/intelligence/insight-agent.ts` — Improvement suggestions
- `lib/agents/intelligence/research-agent.ts` — Company research
- `cron/run.ts` — Daily automation

---

### 9. **Analytics Dashboard**

**Real-time performance visibility.**

**Metrics:**
- Emails sent (by day, campaign, domain)
- Reply rate (%)
- Positive reply rate (%)
- Bounce rate (%)
- Open rate (%)
- Campaign performance table

**Features:**
- Domain health visualization
- Reply classification breakdown
- Identity allocation
- Campaign trends

**Files:**
- `app/(dashboard)/analytics/` — Dashboard UI
- `lib/api.ts` — API endpoints
- `lib/services/metrics.ts` — Metrics calculations

---

### 10. **Automation Rules**

**No manual intervention needed.**

- **Auto-stop on reply** — Contact status immediately = "replied"
- **Auto-adjust volume** — Boss agent reduces sends when reply rate drops
- **Auto-resume** — Domains resume when bounce rate stabilizes
- **Auto-follow-up** — Next step sent automatically at scheduled delay
- **Auto-suppress** — Bounces & unsubscribes added to suppression list
- **Auto-log** — Every action recorded in `operator_actions` table

**Files:**
- `lib/agents/executor.ts` — Action execution
- `lib/backend.ts` — Status transitions
- `cron/run.ts` — Scheduled automation

---

## Email Rules (Safety + Human Tone)

**Required:**
1. Plain text only (no HTML)
2. Max 5 lines
3. Human tone (no marketing fluff)
4. Must end with a question
5. No spam triggers: "guarantee", "free money", "click here", "buy now"

**Validated in:**
- `lib/personalization.ts` — `enforceFiveLineEmail()`, `ensureQuestionEnding()`
- `lib/operator.ts` — `validateSequenceStepCopy()`
- `lib/agents/intelligence/personalization-agent.ts` — `buildPersonalizedMessage()`

---

## Queue + Worker System

**All emails flow through an asynchronous queue.**

### Flow

1. **Campaign Created** → Contacts enqueued to `queue_jobs` table
2. **Worker Runs** (persistent process)
   - Pop next job
   - Load context (contact, campaign, sequence step)
   - Evaluate decision (skip/defer/send)
   - If send: validate personalization, select identity, send via SMTP
   - Mark completed/failed/skipped
3. **Retry Logic**
   - Failed → retry with exponential backoff (2^attempts minutes)
   - Max 3 attempts
   - After 3 fails → status = "failed", logged as operator action
4. **Job States**
   - `pending` → scheduled for sending
   - `processing` → claimed by worker
   - `completed` → sent successfully
   - `retry` → failed, rescheduled
   - `skipped` → contact validation failed
   - `failed` → exhausted retries

### Configuration

**Environment variables:**
```
WORKER_POLL_INTERVAL_MS=1500        # Check for jobs every 1.5s
WORKER_IDLE_SLEEP_MS=2000           # Sleep when queue empty
QUEUE_PROMOTE_BATCH_SIZE=100        # Promote 100 jobs at a time
SMTP_HOST=...                       # BillionMail SMTP server
SMTP_PORT=587                       # Default: 587 (TLS)
SMTP_USER=...                       # BillionMail username
SMTP_PASS=...                       # BillionMail password
SMTP_FROM_EMAIL=...                 # Default from address
SMTP_TEST_MODE=false                # Optional: test-only sending
SMTP_TEST_RECIPIENTS=you@example.com # Comma-separated test emails
```

**Files:**
- `worker/index.ts` — Worker main loop
- `lib/backend.ts` — Queue job management
- `lib/agents/execution/decision-agent.ts` — Send/defer/skip decision logic
- `lib/agents/execution/sender-agent.ts` — SMTP send wrapper
- `lib/integrations/billionmail.ts` — SMTP transport

---

## Failsafe & Safety

### Anomaly Detection

Automatic detection of:
- Bounce rate spikes
- Domain health degradation
- Send failures
- Queue overload
- Repeated SMTP errors

### Auto-Recovery

1. **Reduce Volume** — Scale back daily sends when health drops
2. **Pause Domain** — Stop sending from domain if bounce > 5%
3. **Delay Sends** — Retry with backoff if transient error
4. **Escalate** — Mark critical issues for review

### Fallback Templates

If AI intro generation fails:
- Fallback to static intro
- Continue with rest of email
- Log failure for operator review

### Queue Durability

- All jobs persisted in PostgreSQL
- Redis used only for scheduling/ordering
- Automatic job recovery on worker restart
- No email lost due to process failure

---

## Success Metrics

### System Goals

1. **Consistent Replies**
   - Target: 2–5% reply rate (depends on industry/list)
   - Monitor: Track daily reply rate
   - Action: Adjust subject/copy if rate drops below 2%

2. **Measurable Pipeline**
   - Track: Interested replies vs. total replies
   - Monitor: Positive reply rate (interested replies / total replies)
   - Action: Increase volume if positive reply rate > 25%

3. **Scalable Outreach**
   - Max: 1,000 emails/day/domain safely
   - Monitor: Domain health score, bounce rate
   - Action: Scale volume incrementally (warmup stages)

4. **No Domain Damage**
   - Bounce rate: Keep < 3% (pause if > 5%)
   - Warmup: Respect stage limits (day 1–7: 20/day, etc.)
   - Rate limits: Never exceed identity daily limits
   - Compliance: Auto-suppress bounces, unsubscribes, complaints

---

## Getting Started

### 1. Setup

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your Billionmail SMTP details

# Run migrations
npm run db:init

# Start the system
npm run dev          # Frontend
npm run worker       # Background worker
```

### 2. Create Domain & Identity

```bash
# Via dashboard or API:
POST /api/domains
{
  "domain": "outreach.yourcompany.com",
  "status": "active"
}

POST /api/identities
{
  "domainId": 1,
  "email": "no-reply@outreach.yourcompany.com",
  "dailyLimit": 100
}
```

### 3. Upload Leads

```bash
POST /api/contacts/bulk
{
  "contacts": [
    {
      "email": "prospect@example.com",
      "name": "John Doe",
      "company": "Example Inc",
      "title": "CTO"
    }
  ]
}
```

### 4. Create Sequence

```bash
POST /api/sequences
{
  "name": "Enterprise Outreach",
  "steps": [
    {
      "day": 0,
      "subject": "Quick idea for {{Company}}",
      "body": "Hi {{FirstName}}, saw you're at {{Company}}. Question for you?"
    },
    {
      "day": 2,
      "subject": "A pattern that might help",
      "body": "Following up on my last note. Quick thought on {{Title}} challenges?"
    }
  ]
}
```

### 5. Start Campaign

```bash
POST /api/campaigns
{
  "name": "Q1 Enterprise Outreach",
  "sequenceId": 1,
  "contactIds": [1, 2, 3],
  "dailyTarget": 50,
  "fromIdentityMode": "rotate"
}
```

The system takes it from here. ✅

---

## Monitoring

### Daily Check

```bash
# View system metrics
GET /api/analytics

# View recent events
GET /api/events

# Check domain health
GET /api/domains

# Review replies
GET /api/inbox
```

### Alert Conditions

- `bounceRate > 5%` — Domain paused
- `replyRate < 2%` — Content needs refresh
- `failedJobs > 10 in 1 hour` — Campaign paused
- `healthScore < 50` — Reduce volume

---

## File Structure

```
lib/
  agents/
    boss-agent.ts                           # Decision engine
    executor.ts                             # Execute decisions
    execution/
      decision-agent.ts                     # Send/defer/skip
      sender-agent.ts                       # SMTP wrapper
      queue-agent.ts                        # Queue management
      scheduler-agent.ts                    # Send timing
      retry-agent.ts                        # Retry logic
      follow-up-agent.ts                    # Follow-up scheduling
    intelligence/
      personalization-agent.ts              # AI intro + messaging
      subject-agent.ts                      # Subject line variation
      insight-agent.ts                      # Campaign improvements
      research-agent.ts                     # Company research
    control/
      warmup-agent.ts                       # Warmup safety
      rate-limit-agent.ts                   # Daily limits
      compliance-agent.ts                   # Suppression checks
      self-healing-agent.ts                 # Failure recovery
    data/
      risk-agent.ts                         # Risk detection
      domain-health-agent.ts                # Domain scoring
      metrics-agent.ts                      # Reply/bounce metrics
      lead-quality-agent.ts                 # Lead scoring
    inbox/
      reply-classifier.ts                   # Reply classification
      objection-handler.ts                  # Objection strategy
      response-writer.ts                    # Auto-response suggestions
  integrations/
    billionmail.ts                          # SMTP transport
    openrouter.ts                           # AI services
    zerobounce.ts                           # Email verification
  services/
    metrics.ts                              # System metrics collection
    domain-pool.ts                          # Domain selection
  backend.ts                                # Core business logic
  operator.ts                               # Copy validation
  personalization.ts                        # Text rendering
  compliance.ts                             # Suppression management
  env.ts                                    # Environment config
  db.ts                                     # Database connection
  redis.ts                                  # Queue backend

worker/
  index.ts                                  # Worker main loop

cron/
  run.ts                                    # Daily optimization cycle

app/
  (dashboard)/
    analytics/                              # Analytics UI
    inbox/                                  # Reply inbox
    campaigns/                              # Campaign management
    contacts/                               # Lead management
    sequences/                              # Sequence editor
    domains/                                # Domain configuration
    settings/                               # Account settings
```

---

## Production Checklist

- [ ] Verify SMTP credentials with BillionMail
- [ ] Create at least 1 sending domain with valid SPF/DKIM/DMARC
- [ ] Create at least 1 identity (from-email) with daily limit
- [ ] Upload initial lead list (CSV or API)
- [ ] Create sequence with 2–3 steps
- [ ] Test with small campaign (10 emails)
- [ ] Monitor bounce rate and reply rate
- [ ] Enable daily cron for optimization
- [ ] Monitor operator actions & logs
- [ ] Scale volume after 1 week of stable performance
- [ ] Set Telegram webhook for daily reports (optional)

---

## Final Rule

**Client should feel:**

> "The system is working for me, not the other way around."

✅ No manual follow-ups needed.  
✅ No manual domain management.  
✅ No manual optimization.  
✅ No domain damage.  
✅ Predictable, scalable revenue pipeline.

---

**Built with Sovereign Engine — The Revenue Machine.**
