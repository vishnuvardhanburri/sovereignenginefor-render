#!/bin/sh
set -eu

enabled_flag() {
  value="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]' | tr -d '"'\'' ')"
  case "$value" in
    1|true|yes|y|on) return 0 ;;
    *) return 1 ;;
  esac
}

mask_presence() {
  if [ -n "${1:-}" ]; then
    printf 'set'
  else
    printf 'missing'
  fi
}

int_between() {
  value="${1:-}"
  fallback="${2:-1}"
  min="${3:-1}"
  max="${4:-8}"
  case "$value" in
    ''|*[!0-9]*) value="$fallback" ;;
  esac
  if [ "$value" -lt "$min" ]; then
    value="$min"
  fi
  if [ "$value" -gt "$max" ]; then
    value="$max"
  fi
  printf '%s' "$value"
}

start_background() {
  name="$1"
  shift
  (
    set +e
    "$@"
    code="$?"
    if [ "$code" -ne 0 ]; then
      echo "[render-start] ${name} exited with status ${code}" >&2
    else
      echo "[render-start] ${name} exited cleanly" >&2
    fi
  ) &
}

echo "[render-start] booting Sovereign Engine"
echo "[render-start] flags WEB_EMBED_SENDER_WORKER=${WEB_EMBED_SENDER_WORKER:-unset} WEB_EMBED_REPUTATION_WORKER=${WEB_EMBED_REPUTATION_WORKER:-unset} WEB_EMBED_OUTBOUND_CYCLE_WORKER=${WEB_EMBED_OUTBOUND_CYCLE_WORKER:-auto} WEB_EMBED_AUTONOMOUS_OPS_WORKER=${WEB_EMBED_AUTONOMOUS_OPS_WORKER:-auto} MOCK_SMTP=${MOCK_SMTP:-unset} EMAIL_PROVIDER=${EMAIL_PROVIDER:-smtp}"
echo "[render-start] secrets DATABASE_URL=$(mask_presence "${DATABASE_URL:-}") REDIS_URL=$(mask_presence "${REDIS_URL:-}") SMTP_HOST=$(mask_presence "${SMTP_HOST:-}") SMTP_ACCOUNTS=$(mask_presence "${SMTP_ACCOUNTS:-}")"
memory_profile="$(printf '%s' "${WEB_MEMORY_PROFILE:-small}" | tr '[:upper:]' '[:lower:]' | tr -d '"'\'' ')"
if [ -z "$memory_profile" ]; then
  memory_profile="small"
fi
export WEB_MEMORY_PROFILE="$memory_profile"
free_tier_safe_default=false
case "$memory_profile" in
  free|small) free_tier_safe_default=true ;;
esac
free_tier_safe="$free_tier_safe_default"
if enabled_flag "${WEB_FREE_TIER_SAFE_MODE:-}"; then
  free_tier_safe=true
elif [ -n "${WEB_FREE_TIER_SAFE_MODE:-}" ]; then
  free_tier_safe=false
fi
if [ "$free_tier_safe" = "true" ]; then
  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=192}"
  export PG_POOL_MAX="${PG_POOL_MAX:-1}"
  export DAILY_OUTBOUND_SMALL_MAX_MAPS_LIMIT="$(int_between "${DAILY_OUTBOUND_SMALL_MAX_MAPS_LIMIT:-}" 0 0 1)"
  export DAILY_OUTBOUND_SMALL_MAX_PUBLIC_SEARCH_LIMIT="$(int_between "${DAILY_OUTBOUND_SMALL_MAX_PUBLIC_SEARCH_LIMIT:-}" 1 0 1)"
  export DAILY_OUTBOUND_SMALL_MAX_LEAD_SCOUT_LIMIT="$(int_between "${DAILY_OUTBOUND_SMALL_MAX_LEAD_SCOUT_LIMIT:-}" 1 0 1)"
  export FREE_MAIL_PUMP_INTERVAL_MS="$(int_between "${FREE_MAIL_PUMP_INTERVAL_MS:-}" 1800000 1800000 3600000)"
  export FREE_MAIL_PUMP_DISCOVERY_INTERVAL_MS="$(int_between "${FREE_MAIL_PUMP_DISCOVERY_INTERVAL_MS:-}" 43200000 43200000 86400000)"
  export FREE_MAIL_PUMP_INITIAL_DELAY_MS="$(int_between "${FREE_MAIL_PUMP_INITIAL_DELAY_MS:-}" 120000 60000 600000)"
  export FREE_MAIL_PUMP_SEND_LIMIT="$(int_between "${FREE_MAIL_PUMP_SEND_LIMIT:-}" 1 0 1)"
  export FREE_MAIL_PUMP_APPROVE_LIMIT="$(int_between "${FREE_MAIL_PUMP_APPROVE_LIMIT:-}" 2 1 2)"
  export FREE_MAIL_PUMP_LEAD_SCOUT_LIMIT="$(int_between "${FREE_MAIL_PUMP_LEAD_SCOUT_LIMIT:-}" 1 0 1)"
  export FREE_MAIL_PUMP_PUBLIC_SEARCH_LIMIT="$(int_between "${FREE_MAIL_PUMP_PUBLIC_SEARCH_LIMIT:-}" 1 0 1)"
  export FREE_MAIL_PUMP_EVIDENCE_DEADLINE_MS="$(int_between "${FREE_MAIL_PUMP_EVIDENCE_DEADLINE_MS:-}" 2500 800 3000)"
  export FREE_MAIL_PUMP_EVIDENCE_MAX_PAGES="$(int_between "${FREE_MAIL_PUMP_EVIDENCE_MAX_PAGES:-}" 1 1 1)"
  export FREE_MAIL_PUMP_EVIDENCE_REQUEST_TIMEOUT_MS="$(int_between "${FREE_MAIL_PUMP_EVIDENCE_REQUEST_TIMEOUT_MS:-}" 800 400 1000)"
  export FREE_MAIL_PUMP_DISCOVERY_ON_START="${FREE_MAIL_PUMP_DISCOVERY_ON_START:-false}"
fi
effective_imap_host="${IMAP_HOST:-${SMTP_HOST:-}}"
effective_imap_accounts="${IMAP_ACCOUNTS:-${SMTP_ACCOUNTS:-}}"
echo "[render-start] memory_profile=${memory_profile} free_tier_safe=${free_tier_safe} NODE_OPTIONS=${NODE_OPTIONS:-unset} PG_POOL_MAX=${PG_POOL_MAX:-unset}"
echo "[render-start] inbound env WEB_EMBED_INBOUND_WORKER=${WEB_EMBED_INBOUND_WORKER:-false} IMAP_HOST=$(mask_presence "${IMAP_HOST:-}") IMAP_ACCOUNTS=$(mask_presence "${IMAP_ACCOUNTS:-}") SMTP_FALLBACK_ACCOUNTS=$(mask_presence "${SMTP_ACCOUNTS:-}") EFFECTIVE_IMAP_HOST=$(mask_presence "$effective_imap_host") EFFECTIVE_IMAP_ACCOUNTS=$(mask_presence "$effective_imap_accounts") IMAP_PORT=${IMAP_PORT:-993} IMAP_SECURE=${IMAP_SECURE:-true}"

node scripts/sync-env.mjs
pnpm db:init

if [ -n "${BOOTSTRAP_ADMIN_EMAIL:-}" ] && [ -n "${BOOTSTRAP_ADMIN_PASSWORD:-}" ]; then
  pnpm user:create "$BOOTSTRAP_ADMIN_EMAIL" "$BOOTSTRAP_ADMIN_PASSWORD"
fi

pnpm --dir apps/api-gateway exec tsx scripts/bootstrap-sending-domain.ts

if enabled_flag "${WEB_EMBED_REPUTATION_WORKER:-}"; then
  echo "[render-start] starting embedded reputation-worker"
  start_background "reputation-worker" pnpm -C workers/reputation-worker start
else
  echo "[render-start] embedded reputation-worker disabled"
fi

if enabled_flag "${WEB_EMBED_SENDER_WORKER:-}"; then
  # Render free/small services must keep the web process alive first. One embedded
  # sender with modest concurrency can still clear 200/day without starving Next.js.
  sender_replica_max="$(int_between "${SENDER_WORKER_REPLICA_MAX:-1}" 1 1 8)"
  sender_concurrency_default=1
  sender_concurrency_max_default=1
  worker_pg_pool_default=1
  if [ "$memory_profile" != "small" ] && [ "$memory_profile" != "free" ]; then
    sender_concurrency_default=4
    sender_concurrency_max_default=4
    worker_pg_pool_default=2
  fi
  sender_concurrency_max="$(int_between "${SENDER_WORKER_CONCURRENCY_MAX:-$sender_concurrency_max_default}" "$sender_concurrency_max_default" 1 20)"
  sender_replicas="$(int_between "${WEB_EMBED_SENDER_WORKER_REPLICAS:-${SENDER_REPLICAS:-}}" 1 1 "$sender_replica_max")"
  sender_concurrency="$(int_between "${SENDER_WORKER_CONCURRENCY:-}" "$sender_concurrency_default" 1 "$sender_concurrency_max")"
  worker_pg_pool_max="$(int_between "${SENDER_WORKER_PG_POOL_MAX:-${PG_POOL_MAX:-}}" "$worker_pg_pool_default" 1 10)"
  echo "[render-start] starting embedded sender-worker replicas=${sender_replicas} concurrency=${sender_concurrency} worker_pg_pool_max=${worker_pg_pool_max}"
  i=1
  while [ "$i" -le "$sender_replicas" ]; do
    sender_worker_id="${RENDER_SERVICE_ID:-render}:${HOSTNAME:-host}:sender-${i}:$$"
    start_background "sender-worker-${i}" env \
      WORKER_ID="$sender_worker_id" \
      SENDER_WORKER_CONCURRENCY="$sender_concurrency" \
      PG_POOL_MAX="$worker_pg_pool_max" \
      NODE_OPTIONS="${SENDER_WORKER_NODE_OPTIONS:---max-old-space-size=64}" \
      pnpm -C workers/sender-worker start
    i=$((i + 1))
  done
else
  echo "[render-start] embedded sender-worker disabled"
fi

outbound_cycle_default=true
if [ "$free_tier_safe" = "true" ]; then
  outbound_cycle_default=false
fi
if [ "$free_tier_safe" = "true" ] && enabled_flag "${WEB_EMBED_OUTBOUND_CYCLE_WORKER:-}" && ! enabled_flag "${WEB_EMBED_OUTBOUND_CYCLE_WORKER_FORCE:-false}"; then
  echo "[render-start] embedded outbound-cycle-worker skipped by free-tier safe mode (set WEB_EMBED_OUTBOUND_CYCLE_WORKER_FORCE=true to override)"
elif enabled_flag "${WEB_EMBED_OUTBOUND_CYCLE_WORKER:-$outbound_cycle_default}"; then
  echo "[render-start] starting embedded outbound-cycle-worker"
  start_background "outbound-cycle-worker" env \
    OUTBOUND_CYCLE_TIMEOUT_MS="${OUTBOUND_CYCLE_TIMEOUT_MS:-45000}" \
    OUTBOUND_CYCLE_WORKER_CONCURRENCY="${OUTBOUND_CYCLE_WORKER_CONCURRENCY:-1}" \
    NODE_OPTIONS="${OUTBOUND_CYCLE_NODE_OPTIONS:---max-old-space-size=64}" \
    pnpm --dir apps/api-gateway exec tsx scripts/outbound-cycle-worker.ts
else
  echo "[render-start] embedded outbound-cycle-worker disabled"
fi

free_mail_pump_default=false
if [ "$free_tier_safe" = "true" ]; then
  free_mail_pump_default=true
fi
if enabled_flag "${WEB_EMBED_FREE_MAIL_PUMP:-$free_mail_pump_default}"; then
  echo "[render-start] starting embedded free-mail-pump"
  start_background "free-mail-pump" env \
    FREE_MAIL_PUMP_ENABLED=true \
    FREE_MAIL_PUMP_INTERVAL_MS="${FREE_MAIL_PUMP_INTERVAL_MS:-900000}" \
    FREE_MAIL_PUMP_DISCOVERY_INTERVAL_MS="${FREE_MAIL_PUMP_DISCOVERY_INTERVAL_MS:-21600000}" \
    FREE_MAIL_PUMP_INITIAL_DELAY_MS="${FREE_MAIL_PUMP_INITIAL_DELAY_MS:-45000}" \
    FREE_MAIL_PUMP_SEND_LIMIT="${FREE_MAIL_PUMP_SEND_LIMIT:-1}" \
    FREE_MAIL_PUMP_APPROVE_LIMIT="${FREE_MAIL_PUMP_APPROVE_LIMIT:-3}" \
    FREE_MAIL_PUMP_LEAD_SCOUT_LIMIT="${FREE_MAIL_PUMP_LEAD_SCOUT_LIMIT:-1}" \
    FREE_MAIL_PUMP_PUBLIC_SEARCH_LIMIT="${FREE_MAIL_PUMP_PUBLIC_SEARCH_LIMIT:-1}" \
    FREE_MAIL_PUMP_EVIDENCE_DEADLINE_MS="${FREE_MAIL_PUMP_EVIDENCE_DEADLINE_MS:-3500}" \
    FREE_MAIL_PUMP_EVIDENCE_MAX_PAGES="${FREE_MAIL_PUMP_EVIDENCE_MAX_PAGES:-1}" \
    FREE_MAIL_PUMP_EVIDENCE_REQUEST_TIMEOUT_MS="${FREE_MAIL_PUMP_EVIDENCE_REQUEST_TIMEOUT_MS:-900}" \
    FREE_MAIL_PUMP_DISCOVERY_ON_START="${FREE_MAIL_PUMP_DISCOVERY_ON_START:-false}" \
    NODE_OPTIONS="${FREE_MAIL_PUMP_NODE_OPTIONS:---max-old-space-size=32}" \
    node scripts/free-mail-pump-lite.mjs
else
  echo "[render-start] embedded free-mail-pump disabled"
fi

auto_ops_default=false
if [ "$memory_profile" != "small" ] && [ "$memory_profile" != "free" ]; then
  auto_ops_default=true
fi
if enabled_flag "${WEB_EMBED_AUTONOMOUS_OPS_WORKER:-$auto_ops_default}"; then
  echo "[render-start] starting embedded autonomous-ops-worker"
  start_background "autonomous-ops-worker" env \
    AUTONOMOUS_OPS_CONCURRENCY="${AUTONOMOUS_OPS_CONCURRENCY:-1}" \
    NODE_OPTIONS="${AUTONOMOUS_OPS_NODE_OPTIONS:---max-old-space-size=96}" \
    pnpm --dir apps/api-gateway exec tsx scripts/autonomous-ops-worker.ts
else
  echo "[render-start] embedded autonomous-ops-worker disabled (set WEB_EMBED_AUTONOMOUS_OPS_WORKER=true to enable)"
fi

inbound_allowed=true
if [ "$memory_profile" = "small" ] && ! enabled_flag "${WEB_EMBED_INBOUND_WORKER_FORCE:-false}"; then
  inbound_allowed=false
fi

if [ -n "$effective_imap_host" ] && [ -n "$effective_imap_accounts" ] && enabled_flag "${WEB_EMBED_INBOUND_WORKER:-false}" && [ "$inbound_allowed" = "true" ]; then
  echo "[render-start] starting embedded inbound-worker"
  start_background "inbound-worker" env \
    IMAP_HOST="$effective_imap_host" \
    IMAP_ACCOUNTS="$effective_imap_accounts" \
    NODE_OPTIONS="${INBOUND_WORKER_NODE_OPTIONS:---max-old-space-size=96}" \
    pnpm -C workers/inbound-worker start
elif [ "$inbound_allowed" = "false" ]; then
  echo "[render-start] embedded inbound-worker skipped on small memory to protect sender-worker (set WEB_EMBED_INBOUND_WORKER_FORCE=true to override)"
else
  echo "[render-start] embedded inbound-worker disabled or missing IMAP config (WEB_EMBED_INBOUND_WORKER=${WEB_EMBED_INBOUND_WORKER:-false} EFFECTIVE_IMAP_HOST=$(mask_presence "$effective_imap_host") EFFECTIVE_IMAP_ACCOUNTS=$(mask_presence "$effective_imap_accounts"))"
fi

echo "[render-start] starting api-gateway on 0.0.0.0:${PORT:-3000}"
exec pnpm -C apps/api-gateway start -H 0.0.0.0 -p "${PORT:-3000}"
