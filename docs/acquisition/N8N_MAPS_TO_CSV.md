# n8n Maps to Sovereign CSV

This is the fast lead-intake sidecar for Sovereign Engine.

It does not replace Sovereign's approval, ZeroBounce/Hunter checks, queue controls, suppression, or ESP rotation. It only creates more review-ready lead supply from public Google Maps/business listings so the main system has better contacts to validate and send.

## What It Does

- Runs Apify Google Maps discovery on a schedule.
- Pulls public business listing contact data.
- Rejects personal inboxes, blocked inboxes, placeholder domains, and mismatched domains.
- Produces a Sovereign-compatible CSV payload.
- Lets you append clean rows to Google Sheets, then Sovereign imports and approves the best leads.

## Import the Workflow

Import this file into n8n:

```text
docs/acquisition/n8n-maps-to-sovereign-csv.workflow.json
```

Required n8n environment variables:

```bash
APIFY_API_TOKEN=your_apify_token
APIFY_GOOGLE_MAPS_ACTOR_ID=your_google_maps_actor_id
APIFY_GOOGLE_MAPS_SEARCHES=lead generation agency,outbound agency,RevOps agency,B2B marketing agency,AI automation agency
APIFY_GOOGLE_MAPS_LOCATION=United States
GOOGLE_MAPS_DAILY_LIMIT=100
```

Recommended schedule:

```text
Tuesday-Friday, 08:30 local time
```

## CSV Columns Produced

The workflow creates rows with these columns:

```text
email,first_name,company,consent_source,reason_to_contact,website,source_url,segment,status,fit_score,evidence
```

For your current Google Sheet intake, the minimum columns Sovereign needs are:

```text
email,first_name,company,consent_source,reason_to_contact
```

Keep the extra evidence columns if possible. They help audit quality and approval decisions.

## Best Operating Mode

Use one of these two paths. Do not run both against the same search set unless dedupe-by-domain is enabled.

### Path A: n8n to Google Sheet to Sovereign

Use this when you want to see the CSV before the system imports it.

1. Run the n8n workflow.
2. Copy the `csv` output into your Google Sheet.
3. Let Sovereign import the sheet during daily cron.
4. Sovereign validates, approves the best leads, queues sends, and posts Telegram updates.

### Path B: Sovereign Direct Maps Import

Use this when you want the fastest fully automated path.

Preview first:

```text
https://sovereignenginefor-render.onrender.com/api/contacts/import/maps?secret=YOUR_CRON_SECRET&limit=50&actorId=YOUR_APIFY_GOOGLE_MAPS_ACTOR_ID&searches=lead%20generation%20agency,outbound%20agency,RevOps%20agency&location=United%20States
```

Real daily pipeline:

```text
https://sovereignenginefor-render.onrender.com/api/cron/daily-outbound?client_id=1&secret=YOUR_CRON_SECRET&mapsImport=1&mapsLimit=100&hunterSearch=1&approveLimit=50&sendLimit=25&providerValidationLimit=100
```

Dry-run version:

```text
https://sovereignenginefor-render.onrender.com/api/cron/daily-outbound?client_id=1&dryRun=1&secret=YOUR_CRON_SECRET&mapsImport=1&mapsLimit=100&hunterSearch=1&approveLimit=50&sendLimit=25&providerValidationLimit=100
```

Important: do not add `verbose=1` to cron-job.org jobs. The response can become too large and cron-job.org may mark the run failed even when the system worked.

## Render Settings for Faster Throughput

These are the practical settings for a faster but still controlled pipeline:

```bash
EMAIL_PROVIDER=auto
FORCE_EMAIL_PROVIDER=false
DAILY_OUTBOUND_MODE=growth
DAILY_OUTBOUND_RUN_MAPS=true
DAILY_OUTBOUND_TARGET_DAILY_VOLUME=150
DAILY_OUTBOUND_APPROVE_LIMIT=50
DAILY_OUTBOUND_GROWTH_MAX_SEND_LIMIT=150
DAILY_OUTBOUND_PROVIDER_MAX_SEND_LIMIT=150
DAILY_OUTBOUND_TOTAL_DAILY_SEND_CAP=150
SENDER_DOMAIN_HARD_DAILY_LIMIT=75
SENDER_IDENTITY_HARD_DAILY_LIMIT=75
DAILY_OUTBOUND_PROVIDER_VALIDATION_LIMIT=100
GOOGLE_MAPS_DAILY_LIMIT=100
LEAD_SCOUT_ENABLED=true
HUNTER_DOMAIN_SEARCH_DAILY_LIMIT=25
HUNTER_EMAILS_PER_DOMAIN=5
HUNTER_MIN_CONFIDENCE=80
ZEROBOUNCE_DAILY_LIMIT=300
```

For two sending identities, use this shape:

```bash
BOOTSTRAP_SENDING_EMAILS=["hello@vishnulabs.com","contact@vishnuvardhanburri.in"]
RESEND_API_KEY=your_vishnulabs_resend_key
RESEND_API_KEY_VISHNUVARDHANBURRI_IN=your_vishnuvardhanburri_resend_key
BREVO_API_KEY=your_brevo_key
BREVO_DAILY_LIMIT=150
RESEND_DAILY_LIMIT=150
```

If you only keep one sender identity in Render, the system can only safely rotate from one sender identity. Add the second identity to `BOOTSTRAP_SENDING_EMAILS` before expecting two-domain capacity.

## What "Fast" Means Here

Fast does not mean sending every discovered email immediately.

Fast means:

- Source more leads every day.
- Validate aggressively before sending.
- Auto-approve only evidence-backed business contacts.
- Queue the best contacts first.
- Rotate providers and identities.
- Send Telegram proof on each run.
- Avoid wasting sender reputation on bad rows.

This is the version buyers can trust because the system shows discipline, evidence, and delivery control instead of reckless blasting.
