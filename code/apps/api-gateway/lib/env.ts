const required = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function validateDatabaseUrl(raw: string): string {
  const value = raw.trim()

  // Guard against common .env footguns: inline comments, quotes, whitespace.
  if (!value) {
    throw new Error('DATABASE_URL is empty')
  }
  if (/\s/.test(value)) {
    throw new Error('DATABASE_URL must not contain spaces')
  }
  if (value.includes('#')) {
    throw new Error('DATABASE_URL must be a single clean line (no # comments)')
  }
  if (value.startsWith('"') || value.endsWith('"') || value.startsWith("'") || value.endsWith("'")) {
    throw new Error('DATABASE_URL must not be wrapped in quotes')
  }

  try {
    const url = new URL(value)
    const protocol = url.protocol.toLowerCase()
    if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
      throw new Error(`unsupported protocol ${url.protocol}`)
    }
    if (!url.username) throw new Error('missing username')
    if (!url.hostname) throw new Error('missing host')
    if (!url.pathname || url.pathname === '/') throw new Error('missing database name')
    return value
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`DATABASE_URL is malformed (${msg}). Expected: postgres://user:password@host:port/database`)
  }
}

const optionalInt = (name: string, fallback: number): number => {
  const value = process.env[name]
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

const optionalBool = (name: string, fallback: boolean): boolean => {
  const value = process.env[name]
  if (!value) return fallback
  return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 'yes'
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export const appEnv = {
  databaseUrl: () => validateDatabaseUrl(required('DATABASE_URL')),
  redisUrl: () => required('REDIS_URL'),
  // Optional: only required if you use Resend (webhooks/transactional).
  resendApiKey: () => process.env.RESEND_API_KEY || '',
  // Production base URL
  // Prefer APP_DOMAIN for domain-based deployments; allow APP_BASE_URL as a legacy escape hatch.
  appDomain: () => required('APP_DOMAIN'),
  appBaseUrl: () => {
    const explicit = process.env.APP_BASE_URL
    if (explicit && explicit.trim()) return explicit.trim()

    const domain = required('APP_DOMAIN').trim()
    if (/^https?:\/\//i.test(domain)) return domain

    const forcedProto = (process.env.APP_PROTOCOL || '').trim().toLowerCase()
    if (forcedProto === 'http' || forcedProto === 'https') {
      return `${forcedProto}://${domain}`
    }

    // Default to HTTPS for real deployments; use http for local dev hosts.
    const isLocal =
      domain.startsWith('localhost') ||
      domain.startsWith('127.0.0.1') ||
      domain.startsWith('0.0.0.0')
    const protocol = isLocal ? 'http' : 'https'
    return `${protocol}://${domain}`
  },
  unsubscribeSecret: () => process.env.UNSUBSCRIBE_SECRET || process.env.CRON_SECRET || 'sovereign-engine',
  resendWebhookSecret: () => process.env.RESEND_WEBHOOK_SECRET || '',
  telegramBotToken: () => process.env.TELEGRAM_BOT_TOKEN || '',
  openRouterApiKey: () => process.env.OPENROUTER_API_KEY || '',
  openRouterModel: () => process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct:free',
  // Optional validators. Production gates require at least one live validator.
  zeroBounceApiKey: () => process.env.ZEROBOUNCE_API_KEY || '',
  hunterApiKey: () => process.env.HUNTER_API_KEY || '',
  clearbitApiKey: () => process.env.CLEARBIT_API_KEY || '',
  apolloApiKey: () => process.env.APOLLO_API_KEY || '',
  hubspotAccessToken: () => process.env.HUBSPOT_ACCESS_TOKEN || '',
  slackWebhookUrl: () => process.env.SLACK_WEBHOOK_URL || '',
  smtpHost: () => required('SMTP_HOST'),
  smtpPort: () => optionalInt('SMTP_PORT', 587),
  smtpSecure: () => process.env.SMTP_SECURE === 'true',
  smtpAccountsJson: () => process.env.SMTP_ACCOUNTS || '',
  smtpUser: () => process.env.SMTP_USER || '',
  smtpPass: () => process.env.SMTP_PASS || '',
  smtpAccounts: () => {
    const raw = process.env.SMTP_ACCOUNTS
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed
        .map((x) => ({ user: String(x?.user ?? ''), pass: String(x?.pass ?? '') }))
        .filter((x) => x.user && x.pass)
    } catch {
      return []
    }
  },
  imapHost: () => process.env.IMAP_HOST || process.env.SMTP_HOST || '',
  imapPort: () => optionalInt('IMAP_PORT', 993),
  imapSecure: () => process.env.IMAP_SECURE !== 'false',
  imapAccountsJson: () => process.env.IMAP_ACCOUNTS || '',
  imapUser: () => process.env.IMAP_USER || process.env.SMTP_USER || '',
  imapPass: () => process.env.IMAP_PASS || process.env.SMTP_PASS || '',
  imapAccounts: () => {
    const raw = process.env.IMAP_ACCOUNTS
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed
        .map((x) => ({ user: String(x?.user ?? ''), pass: String(x?.pass ?? '') }))
        .filter((x) => x.user && x.pass)
    } catch {
      return []
    }
  },
  imapMailbox: () => process.env.IMAP_MAILBOX || 'INBOX',
  smtpFromEmail: () => process.env.SMTP_FROM_EMAIL || `no-reply@${process.env.SMTP_HOST?.split(':')[0] ?? 'sovereignengine.com'}`,
  smtpTestMode: () => process.env.SMTP_TEST_MODE === 'true',
  smtpTestRecipients: () => {
    const raw = process.env.SMTP_TEST_RECIPIENTS || process.env.SMTP_TEST_RECIPIENT_EMAILS || ''
    return raw
      .split(/[\s,]+/)
      .map((candidate) => candidate.trim())
      .filter(Boolean)
  },
  defaultClientId: () => optionalInt('DEFAULT_CLIENT_ID', 1),
  minSendDelaySeconds: () => optionalInt('MIN_SEND_DELAY_SECONDS', 60),
  maxSendDelaySeconds: () => optionalInt('MAX_SEND_DELAY_SECONDS', 120),
  workerPollIntervalMs: () => optionalInt('WORKER_POLL_INTERVAL_MS', 1500),
  workerIdleSleepMs: () => optionalInt('WORKER_IDLE_SLEEP_MS', 2000),
  queuePromoteBatchSize: () => optionalInt('QUEUE_PROMOTE_BATCH_SIZE', 100),
  infrastructureTargetDailyVolume: () => optionalInt('INFRASTRUCTURE_TARGET_DAILY_VOLUME', 50000),
  // Optional: used to protect cron endpoints in production. Defaults to a stable value for dev/demo.
  cronSecret: () => process.env.CRON_SECRET || 'sovereign-engine-cron',
  authSecret: () => process.env.AUTH_SECRET || process.env.CRON_SECRET || 'sovereign-engine-auth',
  // AI Integration
  aiMaxTokensPerRequest: () => optionalInt('AI_MAX_TOKENS_PER_REQUEST', 2000),
  aiDailyCostLimit: () => optionalInt('AI_DAILY_COST_LIMIT', 50), // $50 default
  aiModelPreferences: () => {
    const prefs = process.env.AI_MODEL_PREFERENCES || 'spam_detection:meta-llama/llama-3.1-8b-instruct,reply_analysis:anthropic/claude-3-haiku,personalization:anthropic/claude-3-sonnet'
    const result: Record<string, string[]> = {}
    for (const pref of prefs.split(',')) {
      const [task, models] = pref.split(':')
      if (task && models) {
        result[task.trim()] = models.split('|').map(m => m.trim())
      }
    }
    return result
  },
  // Scraping
  scrapingEnabled: () => process.env.SCRAPING_ENABLED !== 'false',
  scrapingRateLimitMs: () => optionalInt('SCRAPING_RATE_LIMIT_MS', 2000),
  scrapingTimeoutMs: () => optionalInt('SCRAPING_TIMEOUT_MS', 30000),
  scrapingMaxConcurrency: () => optionalInt('SCRAPING_MAX_CONCURRENCY', 3),

  // Advanced pre-enqueue decision flags (default OFF for parity).
  simulationEnabled: () => optionalBool('SIMULATION_ENABLED', false),
  intelligenceEnabled: () => optionalBool('INTELLIGENCE_ENABLED', false),
  advancedDecisionEnabled: () => optionalBool('ADVANCED_DECISION_ENABLED', false),
  outcomeEnabled: () => optionalBool('OUTCOME_ENABLED', false),
  outcomeExperimentEnabled: () => optionalBool('OUTCOME_EXPERIMENT', false),
  safeModeEnabled: () => optionalBool('SAFE_MODE', false),
  costPerSend: () => {
    const raw = process.env.COST_PER_SEND
    if (!raw) return 0
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : 0
  },
  advancedDecisionSamplePct: () => clamp(optionalInt('ADVANCED_DECISION_SAMPLE_PCT', 5), 0, 100),
  preEnqueueAdapterTimeoutMs: () => clamp(optionalInt('PRE_ENQUEUE_ADAPTER_TIMEOUT_MS', 1500), 250, 5000),
  preEnqueueTotalBudgetMs: () => clamp(optionalInt('PRE_ENQUEUE_TOTAL_BUDGET_MS', 2500), 500, 10000),
}

export function validateApiEnv(): void {
  appEnv.databaseUrl()
  appEnv.redisUrl()
  appEnv.appBaseUrl()
  appEnv.appDomain()
}

export function validateWorkerEnv(): void {
  validateApiEnv()
  appEnv.smtpHost()
  appEnv.smtpPort()
  appEnv.smtpFromEmail()

  const smtpAccounts = appEnv.smtpAccounts()
  if (smtpAccounts.length === 0) {
    if (!appEnv.smtpUser()) throw new Error('Missing required environment variable: SMTP_USER (or set SMTP_ACCOUNTS)')
    if (!appEnv.smtpPass()) throw new Error('Missing required environment variable: SMTP_PASS (or set SMTP_ACCOUNTS)')
  }

  if (appEnv.smtpTestMode() && appEnv.smtpTestRecipients().length === 0) {
    throw new Error(
      'SMTP_TEST_MODE is enabled but SMTP_TEST_RECIPIENTS is missing or empty'
    )
  }
}
