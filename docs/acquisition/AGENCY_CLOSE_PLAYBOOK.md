# Agency Close Playbook

Last updated: 2026-06-11

This is the short-path revenue playbook for Xavira Control Stack.

The goal for the next sprint is not platform scale, enterprise architecture, or feature expansion. The goal is paid agency conversations that can turn into first revenue.

## Source Of Truth

Primary offer:

```text
GBP 5,000 Campaign Rescue Sprint
```

Continuation offer:

```text
GBP 3,000/month Control Partner
```

Later-stage product license path:

```text
GBP 40,000 Internal Enterprise License
GBP 160,000 White-Label Commercial License
```

The GBP 5,000 sprint is the trust-building entry point. It is not a discount on the product license. It is a founder-led diagnostic and recovery service that uses Xavira's system to find proof, isolate bottlenecks, and produce client-facing recommendations.

## Brutal Focus

Only target these for the next 30 days:

- Lead generation agencies
- Outbound agencies
- Appointment setting agencies
- RevOps agencies
- B2B demand generation agencies
- HubSpot/Salesforce RevOps consultancies that run or audit outbound for clients

Do not target right now:

- Random SaaS companies
- India-only service companies
- Large enterprises without clear outbound agency pain
- Security consultancies
- MSPs
- Founders with no client delivery responsibility
- Anyone where the pain hypothesis is weak

## Why Agencies First

Agencies have the clearest money pain:

- Clients blame them when campaigns underperform.
- Deliverability problems create churn risk.
- Reporting gaps reduce trust.
- Follow-up gaps kill booked conversations.
- Sender/domain issues can damage multiple client accounts.
- Proof matters because agency-client trust is fragile.

The buyer does not care that Xavira is technically impressive. They care whether it helps them defend client performance, retain accounts, and stop underperformance from looking like poor execution.

## Ideal Customer Profile

Best-fit agency:

- 5 to 50 employees
- Runs outbound, lead generation, appointment setting, RevOps, or demand generation
- Has active client campaigns
- Uses email and LinkedIn as core channels
- Has founder, owner, head of delivery, or RevOps leader visible publicly
- Has case studies, service pages, client logos, or outbound-related content
- Charges clients enough that losing one client matters

Strong buying triggers:

- Mentions deliverability, SDRs, sales development, outbound, appointment setting, RevOps, pipeline, or client acquisition
- Publishes client results or case studies
- Hiring SDRs, appointment setters, campaign managers, RevOps consultants, or deliverability roles
- Offers done-for-you outbound or managed pipeline generation
- Talks about multi-channel outbound
- Talks about AI personalization, cold email, LinkedIn outreach, CRM operations, or campaign reporting

Weak or reject:

- No outbound-related service
- No clear B2B client base
- No active website or weak public proof
- Only sells ads, SEO, design, or branding with no outbound/revenue operations angle
- Gmail-only freelancer with no client delivery system
- India-only low-budget agency unless they clearly sell to US/UK/EU clients

## Prospect Evidence Engine

For every prospect, collect this before writing:

```json
{
  "company": "",
  "website": "",
  "founder_or_owner": "",
  "role": "",
  "linkedin_url": "",
  "company_type": "",
  "services": [],
  "customer_type": "",
  "recent_signal": "",
  "pain_signal": "",
  "why_now": "",
  "likely_client_risk": "",
  "recommended_angle": "",
  "confidence_score": 0,
  "qualification": "high_priority | contact | linkedin_only | email_only | reject"
}
```

Required evidence quality:

- Use specific service pages, posts, hiring signals, case studies, or visible positioning.
- Do not use vague observations like "you are growing" or "I saw your website."
- Prefer operational evidence: client delivery, outbound campaigns, RevOps systems, reporting, deliverability, SDR hiring, follow-up ownership.
- Use public and business-appropriate sources only. Do not rely on private, unauthorized, or personal data.

## Qualification Rules

High priority:

- Agency sells outbound, lead generation, RevOps, appointment setting, or demand generation.
- Founder/owner/operator is identifiable.
- Website shows client services and credible activity.
- There is a specific pain angle tied to client performance, deliverability, reporting, follow-up, or pipeline operations.
- Confidence score 85+.

Contact:

- Good agency fit, but only generic email or contact form is available.
- Still has a strong pain hypothesis.
- Confidence score 70 to 84.

LinkedIn only:

- Strong founder/operator profile found.
- Email is unavailable or likely poor quality.
- Use manual DM, not automation.

Email only:

- Good business email is available.
- LinkedIn profile is weak or unavailable.

Reject:

- Pain is generic.
- Company does not serve B2B clients.
- No decision maker.
- No credible signal that outbound or RevOps matters.
- Confidence under 70.

## Scoring

Score every agency from 0 to 100.

Use this weighting:

- Agency fit: 25 points
- Outbound/RevOps service fit: 25 points
- Evidence specificity: 20 points
- Founder/operator access: 15 points
- Why-now signal: 10 points
- Budget likelihood: 5 points

Only send to 85+ if the system has enough inventory. If inventory is low, send manually to 80+ but do not lower the standard below that.

## The Core Question

Use this question everywhere:

```text
When an outbound campaign underperforms, what do clients blame first: lead quality, deliverability, follow-ups, or reporting?
```

This question works because it is not a pitch. It forces the buyer to reveal the real pain.

## Messaging Position

Do not say:

- We are an AI outreach platform.
- We can send more emails.
- We scrape leads.
- We guarantee revenue.
- We guarantee inbox placement.
- We replace your tools.
- We are better than OpenAI/Gemini/Grok.

Say:

- We help agencies find what is breaking when outbound campaigns underperform.
- We help teams separate lead-quality problems from deliverability, follow-up, and reporting problems.
- We help agency founders create clearer proof for clients when campaign performance gets questioned.
- Xavira gives the operator a control view across campaign health, sender risk, follow-up discipline, and proof.

## Primary Email Template

Subject:

```text
client campaign proof question
```

Body:

```text
Hi {{first_name}},

I noticed {{company}} works with B2B teams around {{specific_service_or_signal}}.

That usually creates a hard client conversation when campaigns underperform. It is not always obvious whether the issue is lead quality, deliverability, weak follow-up ownership, sender health, or reporting gaps.

I am building Xavira around that problem: helping agencies get clearer control and proof around client outbound operations.

When a campaign underperforms at {{company}}, what do clients tend to question first: lead quality, deliverability, follow-ups, or reporting?

Best,
Vishnu
Founder
Xavira Tech Labs
```

Rules:

- Replace the observation with a real signal.
- Keep it under 140 words.
- Mention Xavira once.
- Ask one question.
- Do not mention price in the first email.

## LinkedIn DM Template

```text
Hi {{first_name}}, noticed {{company}} helps B2B teams with {{specific_service_or_signal}}.

Quick operator question: when a client campaign underperforms, what usually gets questioned first on your side: lead quality, deliverability, follow-ups, or reporting?
```

If they reply, do not pitch immediately. Ask one diagnostic follow-up:

```text
That makes sense. Is that mostly a visibility problem, or is it hard because the client sees the result but not the delivery evidence behind it?
```

## Follow-Up Sequence

Follow-up 1, after 2 days:

```text
{{first_name}}, quick follow-up.

The reason I asked is that agencies often get blamed for "bad leads" when the real issue is sender health, inbox placement, missed follow-ups, or unclear campaign proof.

Is that a problem your team already has under control?
```

Follow-up 2, after 5 days:

```text
{{first_name}}, should I close this out?

I am speaking with agency operators who want a clearer way to prove what happened when outbound performance drops.

If client reporting and delivery proof are not painful for {{company}}, no worries.
```

Follow-up 3, after 9 days:

```text
Last note from me, {{first_name}}.

If a campaign misses target, the useful question is usually not "send more?" It is "where exactly did performance break?"

Lead quality, deliverability, follow-up ownership, or reporting visibility.

Worth keeping on your radar if clients question campaign proof.
```

Stop immediately if:

- They reply.
- They unsubscribe.
- They say not relevant.
- Email bounces.

## Reply Handling

If they say "tell me more":

```text
The simple version:

We run a founder-led Campaign Rescue Sprint for agencies when outbound performance is unclear.

The output is not another generic report. We look for evidence around sender health, inbox risk, follow-up gaps, campaign proof, and where clients may be misreading the real issue.

The useful outcome is clarity: what is actually breaking, what to fix first, and what proof the agency can show the client.

What type of campaign issue comes up most often for your team?
```

If they ask price:

```text
The sprint is GBP 5,000.

It is fixed scope, founder-led, and focused on diagnosing one agency outbound operation or one high-value client campaign.

If the work creates ongoing value, the continuation is GBP 3,000/month as a Control Partner. That covers ongoing monitoring support, system review, campaign proof, operational recommendations, and escalation support.
```

If they say they already have tools:

```text
That makes sense. Most agencies already have tools.

The gap I am focused on is usually between the tools: what happened across sender health, follow-ups, client reporting, and campaign proof when performance drops.

Are your existing tools giving you enough evidence to defend performance with clients, or mostly activity metrics?
```

## Call Flow

Keep first call to 20 to 30 minutes.

Call objective:

- Understand their client campaign pain.
- Identify whether they lose trust because of weak proof.
- Decide whether a GBP 5,000 sprint is relevant.

Call questions:

- What type of campaigns do you run for clients?
- When campaigns underperform, what do clients usually blame first?
- How do you separate lead-quality problems from deliverability or follow-up problems?
- What proof do you currently show clients?
- Who owns sender health, inbox placement, and follow-up control?
- What happens when one client account starts creating reputation risk?
- What would make this easier to defend with clients?

Do not demo the whole platform unless they ask.

Show only:

- Sent/reply proof
- Sender health
- Queue/follow-up visibility
- Evidence/report concept
- Example diagnosis

## Offer Structure

### Campaign Rescue Sprint

Price:

```text
GBP 5,000 fixed fee
```

Purpose:

Diagnose why outbound campaigns are underperforming and produce evidence-backed recommendations the agency can use internally or with a client.

Typical scope:

- Review one agency outbound operation or one high-value client campaign
- Review sender/domain setup where provided
- Review campaign messaging and follow-up flow
- Review proof gaps and client reporting risk
- Identify likely performance bottlenecks
- Produce a short Control Report
- Provide founder-led recommendations

Not included:

- Guaranteed revenue
- Guaranteed inbox placement
- Unlimited campaign management
- Buying data/tools on behalf of the client
- Unauthorized scraping
- Legal, compliance, or financial advice

### Control Partner

Price:

```text
GBP 3,000/month
```

Purpose:

Ongoing control support after the sprint, for agencies that want recurring monitoring, review, and operating discipline around client outbound.

Included:

- Weekly campaign control review
- Sender/domain risk review
- Follow-up and suppression review
- Client-proof recommendations
- Messaging review
- Operational escalation support
- Monthly summary report

Client still handles:

- Their client relationships
- Their CRM
- Their sender/account ownership
- Their compliance obligations
- Their campaign approvals
- Their final business decisions

Xavira handles:

- Diagnostic review
- Risk visibility
- Operational recommendations
- Proof/reporting structure
- System monitoring support
- Founder-led escalation guidance

## Why Ongoing Support Is Needed

Do not frame ongoing support as maintenance for software.

Frame it as operational control.

Reason:

Outbound performance changes weekly. Client campaigns drift, domains age, inbox placement shifts, copy fatigue appears, follow-ups break, and clients question results. A one-time sprint finds the problems. Ongoing control helps prevent the same problems from coming back quietly.

Simple explanation:

```text
The sprint finds what is breaking.
The monthly partner work keeps it visible and controlled as campaigns continue.
```

## Payment And Terms Talking Points

Use plain language. Do not overcomplicate the sale.

- Payment is due before the sprint starts.
- Sprint fees are non-refundable once work begins.
- Scope is limited to the agreed campaign/account review.
- Any extra implementation, tooling, or managed campaign work is separate.
- The client remains responsible for lawful outreach practices, platform terms, and their customer data.
- Xavira provides operational analysis and recommendations, not guaranteed revenue or legal advice.

Use a separate signed agreement before taking payment.

## Daily Execution Plan

Every day:

- Research 50 agency accounts.
- Score them.
- Approve only 20 best-fit prospects.
- Send 20 high-quality emails or DMs.
- Follow up with all open conversations.
- Manually handle replies.
- Review sent proof, bounces, failures, and reply quality.
- Save objections and wording that works.

Mail safety cap:

- Total email volume is capped at 150/day across both sender inboxes.
- Each sender inbox is capped at 75/day.
- Follow-ups count inside the same 150/day total. They are not extra volume.
- Research inventory can keep growing separately; sending is the constrained resource.

Daily scoreboard:

```text
Research completed:
High-priority agencies found:
Emails sent:
LinkedIn DMs sent:
Replies:
Meaningful conversations:
Calls booked:
Sprint proposals sent:
Payments collected:
```

Success metric:

```text
Meaningful agency founder conversations
```

Not:

```text
Emails sent
Dashboard features built
Architecture diagrams
Random lead volume
```

## Stop Doing

Stop:

- Building new dashboards before calls.
- Changing pricing every day.
- Targeting every industry.
- Sending generic AI-written emails.
- Mentioning every feature.
- Selling enterprise licenses to cold prospects before trust exists.
- Treating volume as proof.
- Chasing private/personal data.
- Using unsafe or unauthorized scraping methods.

Start:

- Researching fewer but better agencies.
- Asking one painful question.
- Listening for client-proof pain.
- Selling the GBP 5,000 sprint first.
- Turning good sprint clients into GBP 3,000/month partners.

## Next Five Actions

1. Pull today's best 20 agency prospects from the system.
2. Manually inspect each website and founder profile.
3. Send only personalized messages using the core question.
4. Track replies and objections in one place.
5. Offer the GBP 5,000 Campaign Rescue Sprint only after pain is confirmed.
