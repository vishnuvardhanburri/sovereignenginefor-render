FROM node:22-bookworm-slim AS builder

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1 \
  PUPPETEER_SKIP_DOWNLOAD=true \
  LOG_FORMAT=json \
  PNPM_HOME=/pnpm \
  PATH=/pnpm:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@9.0.0 --activate

COPY . .

RUN pnpm install --frozen-lockfile

# Build with safe placeholder values. Runtime configuration is supplied by Compose/Kubernetes/EC2.
RUN NODE_ENV=production \
  DATABASE_URL='postgresql://postgres:password@127.0.0.1:5432/sovereign_engine?sslmode=disable' \
  REDIS_URL='redis://127.0.0.1:6379' \
  APP_DOMAIN='localhost:3000' \
  APP_PROTOCOL='http' \
  SMTP_HOST='mock.local' \
  SMTP_PORT='587' \
  SMTP_USER='mock@localhost' \
  SMTP_PASS='mock' \
  SMTP_SECURE='false' \
  ZEROBOUNCE_API_KEY='mock' \
  SECURITY_KILL_SWITCH_TOKEN='build-only' \
  REPUTATION_PUBLIC_API_KEY='' \
  PUBLIC_REPUTATION_FREE_DAILY_LIMIT='10' \
  PUBLIC_REPUTATION_PRO_DAILY_LIMIT='1000' \
  PUBLIC_REPUTATION_ENTERPRISE_DAILY_LIMIT='100000' \
  PUBLIC_REPUTATION_BLACKLIST_CACHE_SEC='21600' \
  ADAPTIVE_REDIS_PEERS='' \
  PG_POOL_MAX='5' \
  PG_POOL_IDLE_TIMEOUT_MS='30000' \
  PG_POOL_CONNECTION_TIMEOUT_MS='5000' \
  INVESTOR_LEAD_VALUE_USD='0.75' \
  COST_PER_SEND='0.002' \
  ROI_INBOX_LEAD_VALUE_USD='0.75' \
  ROI_COST_PER_SEND_USD='0.002' \
  ROI_INFRA_DAILY_USD='0' \
  ROI_PROXY_DAILY_USD='0' \
  ROI_DOMAIN_DAILY_USD='0' \
  WORKER_ROTATION_SEND_LIMIT='5000' \
  WORKER_ROTATION_MAX_AGE_MS='86400000' \
  LEGACY_LOOP_BATCH_SIZE='10' \
  FASTLANE_COMPLETION_BATCH_SIZE='500' \
  FASTLANE_COMPLETION_FLUSH_MS='500' \
  LICENSING_CONTROL_URL='' \
  LICENSING_KEY='' \
  CONTENT_MUTATION_ENABLED='false' \
  CONTENT_MUTATION_ENDPOINT='http://ollama:11434/api/generate' \
  CONTENT_MUTATION_MODEL='llama3:8b' \
  CONTENT_MUTATION_POOL_SIZE='500' \
  CONTENT_MUTATION_FILL_PER_LOCK='500' \
  CONTENT_MUTATION_TIMEOUT_MS='12000' \
  CONTENT_MUTATION_POOL_TTL_SEC='86400' \
  MOCK_SMTP='true' \
  pnpm -C apps/api-gateway build

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  PUPPETEER_SKIP_DOWNLOAD=true \
  LOG_FORMAT=json \
  PNPM_HOME=/pnpm \
  PATH=/pnpm:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@9.0.0 --activate

COPY --from=builder /app /app

EXPOSE 3000

CMD ["sh", "-lc", "node scripts/sync-env.mjs && pnpm db:init && if [ -n \"$BOOTSTRAP_ADMIN_EMAIL\" ] && [ -n \"$BOOTSTRAP_ADMIN_PASSWORD\" ]; then pnpm user:create \"$BOOTSTRAP_ADMIN_EMAIL\" \"$BOOTSTRAP_ADMIN_PASSWORD\"; fi && pnpm -C apps/api-gateway start -p ${PORT:-3000}"]
