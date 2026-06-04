# Render Free Survival Mode

The free Render web service has a 512MB memory ceiling. The safest shape is:

- web process serves dashboard, `/book`, APIs, and one low-concurrency sender lane
- discovery runs in tiny batches
- no always-on outbound cycle worker inside the web process
- no embedded inbound/reputation/autonomous worker unless explicitly forced

## Required Render Env

```env
WEB_MEMORY_PROFILE=free
WEB_FREE_TIER_SAFE_MODE=true
NODE_OPTIONS=--max-old-space-size=256
PG_POOL_MAX=2

WEB_EMBED_SENDER_WORKER=true
SENDER_WORKER_CONCURRENCY=1
LEGACY_LOOP_BATCH_SIZE=1

WEB_EMBED_OUTBOUND_CYCLE_WORKER=false
WEB_EMBED_AUTONOMOUS_OPS_WORKER=false
WEB_EMBED_INBOUND_WORKER=false
WEB_EMBED_REPUTATION_WORKER=false

LEAD_SCOUT_DAILY_LIMIT=15
PUBLIC_SEARCH_DAILY_LIMIT=10
GOOGLE_MAPS_DAILY_LIMIT=5
DAILY_OUTBOUND_SMALL_MAX_LEAD_SCOUT_LIMIT=15
DAILY_OUTBOUND_SMALL_MAX_PUBLIC_SEARCH_LIMIT=10
DAILY_OUTBOUND_SMALL_MAX_MAPS_LIMIT=5
```

## Operating Model

Use the live app for qualification and closing. Let the sender lane process queued mail slowly.
For lead discovery, run compact cycles more often instead of one heavy run.

Do not run 800 sends as one web request on the free instance. Keep the commercial target at
800/day, but let free-tier execution advance in small chunks so the service stays alive.
