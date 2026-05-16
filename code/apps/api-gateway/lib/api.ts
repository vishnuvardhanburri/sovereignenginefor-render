import { z } from 'zod'

export interface Campaign {
  id: string
  name: string
  sequenceId: string
  sequenceName: string
  contactCount: number
  status: 'draft' | 'active' | 'paused' | 'completed'
  sent: number
  replies: number
  openRate: number
  bounceRate: number
  createdAt: Date
}

export interface Contact {
  id: string
  email: string
  name: string
  company: string
  title: string
  source: string
  customFields: Record<string, unknown>
  status: 'active' | 'replied' | 'bounced' | 'unsubscribed'
  addedAt: Date
}

export interface ResearchApprovalDecision {
  id: number
  email: string
  company: string | null
  score: number
  approved: boolean
  reasons: string[]
  blockers: string[]
  evidenceUrl: string | null
  source: string | null
}

export interface ResearchApprovalResult {
  ok: boolean
  dryRun: boolean
  approved?: number
  scanned: number
  approvalReady?: number
  candidates?: ResearchApprovalDecision[]
  blocked?: ResearchApprovalDecision[]
  skipped?: string
}

export interface SequenceStep {
  id: string
  day: number
  subject: string
  body: string
}

export interface Sequence {
  id: string
  name: string
  steps: SequenceStep[]
  createdAt: Date
  updatedAt: Date
}

export interface ReplyMessage {
  id: string
  from: string
  to: string
  subject: string
  body: string
  date: Date
  isIncoming: boolean
}

export interface Reply {
  id: string
  fromEmail: string
  fromName: string
  subject: string
  date: Date
  status: 'unread' | 'interested' | 'not_interested'
  campaignId: string
  contactId: string
  messages: ReplyMessage[]
}

export interface AnalyticsData {
  campaignName: string
  repliesCount: number
  replyRate: number
  bounceRate: number
  openRate: number
  sentCount: number
}

export interface QueueStats {
  ready: number
  scheduled: number
  processing: number
  total: number
  timestamp: string
}

export interface InfrastructureHealth {
  timestamp: string
  status: 'paused' | 'running'
  system: {
    healthy: boolean
    issues: unknown[]
    capacityUtilization: number
    targetCapacity: number
    currentCapacity: number
  }
  metrics: {
    domains: number
    healthyDomains: number
    inboxes: number
    capacityUtilization: number
    emailsSent24h: number
    avgDeliveryTime: number
    uptime: number
  }
  topDomains: Array<{
    domain: string
    health: string
    sent24h: number
    bounceRate: number
    spamRate: number
  }>
  alerts: {
    summary?: unknown
    critical: unknown[]
    recent: unknown[]
  }
}

export interface InfrastructureAnalytics {
  timestamp: string
  metrics: {
    domains: number
    healthyDomains: number
    inboxes: number
    capacity: { total: number; used: number; utilization: number }
    emails: { sent24h: number; avgDeliveryTime: number }
    health: { uptime: number; avgBounceRate: number; avgSpamRate: number }
  }
  domains: Array<{
    id: number
    domain: string
    health: string
    paused: boolean
    inboxes: number
    sent24h: number
    bounceRate: number
    spamRate: number
    avgDeliveryTime: number
  }>
  recommendations: Array<{
    id: string
    category: string
    priority: string
    title: string
    description: string
    action: string
    estimatedImpact: string
    confidence: number
  }>
}

export type ControlAction = 'pause' | 'resume' | 'optimize' | 'heal' | 'scale'
export interface ControlResult {
  success: boolean
  status?: string
  action?: ControlAction
  timestamp?: string
  error?: string
}

export interface PatternRecord {
  id: string
  type: 'subject' | 'intro' | 'body'
  content: string
  usage_count: number
  open_rate: number
  reply_rate: number
  bounce_rate: number
  score: number
  status: 'active' | 'testing' | 'disabled'
  last_used_at: string | null
}

export interface EventRow {
  id: string
  event_type: string
  created_at: string
  campaign_id: string | null
  contact_id: string | null
  identity_id: string | null
  domain_id: string | null
  queue_job_id: string | null
  provider_message_id: string | null
  metadata: Record<string, unknown> | null
}

export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export interface OperatorAction {
  id: string
  action_type: string
  summary: string
  payload: Record<string, unknown> | null
  created_at: string
}

export interface ExecutiveSummary {
  timestamp: string
  today: {
    sent: number
    replies: number
    interestedReplies: number
    bounces: number
    replyRate: number // 0..1
    bounceRate: number // 0..1
  }
  yesterday: {
    sent: number
    replies: number
    bounces: number
    replyRate: number
    bounceRate: number
  }
  businessImpact: {
    estimatedConversationsToday: number
    estimatedOpportunities: number
    replyTrendPct: number // -1..+inf
  }
  safety: {
    complianceActive: boolean
    blockedContactsToday: number
  }
}

export interface ExecutiveForecast {
  timestamp: string
  forecast: {
    expectedRepliesToday: number
    projectedBounceRisk: 'LOW' | 'MEDIUM' | 'HIGH'
    estimatedSafeSendCapacityRemaining: number
  }
  trends: {
    days: number
    reply: { direction: 'up' | 'down'; changePct: number; text: string }
    bounce: { direction: 'up' | 'down'; changePct: number; text: string }
  }
  earlyWarnings: string[]
  baselines: {
    avgReplyRate: number
    avgBounceRate: number
  }
}

const campaignSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string(),
  sequence_id: z.union([z.string(), z.number()]).transform(String),
  sequence_name: z.string(),
  contact_count: z.coerce.number().nonnegative(),
  status: z.enum(['draft', 'active', 'paused', 'completed']),
  sent_count: z.coerce.number().nonnegative(),
  reply_count: z.coerce.number().nonnegative(),
  open_count: z.coerce.number().nonnegative(),
  bounce_count: z.coerce.number().nonnegative(),
  created_at: z.string(),
})

const contactSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  email: z.string().email(),
  name: z.string().nullable().optional().default(''),
  company: z.string().nullable().optional().default(''),
  title: z.string().nullable().optional().default(''),
  source: z.string().nullable().optional().default(''),
  custom_fields: z.record(z.string(), z.unknown()).nullable().optional().default({}),
  status: z.enum(['active', 'replied', 'bounced', 'unsubscribed']),
  created_at: z.string(),
})

const sequenceSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  steps: z.array(
    z.object({
      id: z.union([z.string(), z.number()]).transform(String),
      day_delay: z.coerce.number().nonnegative(),
      subject: z.string(),
      body: z.string(),
    })
  ).default([]),
})

const replySchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  from_email: z.string().email(),
  from_name: z.string().nullable().optional().default(''),
  subject: z.string(),
  date: z.string(),
  status: z.enum(['unread', 'interested', 'not_interested']),
  campaign_id: z.union([z.string(), z.number()]).nullable().optional(),
  contact_id: z.union([z.string(), z.number()]).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const queueStatsSchema = z.object({
  ready: z.coerce.number().nonnegative(),
  scheduled: z.coerce.number().nonnegative(),
  processing: z.coerce.number().nonnegative(),
  total: z.coerce.number().nonnegative(),
  timestamp: z.string(),
})

const infrastructureHealthSchema = z.object({
  timestamp: z.string(),
  status: z.enum(['paused', 'running']),
  system: z.object({
    healthy: z.boolean(),
    issues: z.array(z.unknown()),
    capacityUtilization: z.coerce.number(),
    targetCapacity: z.coerce.number(),
    currentCapacity: z.coerce.number(),
  }),
  metrics: z.object({
    domains: z.coerce.number(),
    healthyDomains: z.coerce.number(),
    inboxes: z.coerce.number(),
    capacityUtilization: z.coerce.number(),
    emailsSent24h: z.coerce.number(),
    avgDeliveryTime: z.coerce.number(),
    uptime: z.coerce.number(),
  }),
  topDomains: z.array(z.object({
    domain: z.string(),
    health: z.string(),
    sent24h: z.coerce.number(),
    bounceRate: z.coerce.number(),
    spamRate: z.coerce.number(),
  })),
  alerts: z.object({
    summary: z.unknown().optional(),
    critical: z.array(z.unknown()),
    recent: z.array(z.unknown()),
  }),
})

const infrastructureAnalyticsSchema = z.object({
  timestamp: z.string(),
  metrics: z.object({
    domains: z.coerce.number(),
    healthyDomains: z.coerce.number(),
    inboxes: z.coerce.number(),
    capacity: z.object({
      total: z.coerce.number(),
      used: z.coerce.number(),
      utilization: z.coerce.number(),
    }),
    emails: z.object({
      sent24h: z.coerce.number(),
      avgDeliveryTime: z.coerce.number(),
    }),
    health: z.object({
      uptime: z.coerce.number(),
      avgBounceRate: z.coerce.number(),
      avgSpamRate: z.coerce.number(),
    }),
  }),
  domains: z.array(z.object({
    id: z.coerce.number(),
    domain: z.string(),
    health: z.string(),
    paused: z.boolean(),
    inboxes: z.coerce.number(),
    sent24h: z.coerce.number(),
    bounceRate: z.coerce.number(),
    spamRate: z.coerce.number(),
    avgDeliveryTime: z.coerce.number(),
  })),
  recommendations: z.array(z.object({
    id: z.string(),
    category: z.string(),
    priority: z.string(),
    title: z.string(),
    description: z.string(),
    action: z.string(),
    estimatedImpact: z.string(),
    confidence: z.coerce.number(),
  })).default([]),
})

const patternRecordSchema = z.object({
  id: z.string(),
  type: z.enum(['subject', 'intro', 'body']),
  content: z.string(),
  usage_count: z.coerce.number().nonnegative(),
  open_rate: z.coerce.number(),
  reply_rate: z.coerce.number(),
  bounce_rate: z.coerce.number(),
  score: z.coerce.number(),
  status: z.enum(['active', 'testing', 'disabled']),
  last_used_at: z.string().nullable(),
})

const eventRowSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  event_type: z.string(),
  created_at: z.string(),
  campaign_id: z.union([z.string(), z.number()]).nullable().optional().transform((v) => (v == null ? null : String(v))),
  contact_id: z.union([z.string(), z.number()]).nullable().optional().transform((v) => (v == null ? null : String(v))),
  identity_id: z.union([z.string(), z.number()]).nullable().optional().transform((v) => (v == null ? null : String(v))),
  domain_id: z.union([z.string(), z.number()]).nullable().optional().transform((v) => (v == null ? null : String(v))),
  queue_job_id: z.union([z.string(), z.number()]).nullable().optional().transform((v) => (v == null ? null : String(v))),
  provider_message_id: z.string().nullable().optional().transform((v) => v ?? null),
  metadata: z.record(z.string(), z.unknown()).nullable().optional().transform((v) => v ?? null),
})

const paginatedEventsSchema = z.union([
  // Newer normalized shape used by most of the app.
  z.object({
    data: z.array(eventRowSchema),
    pagination: z.object({
      page: z.coerce.number(),
      limit: z.coerce.number(),
      total: z.coerce.number(),
      totalPages: z.coerce.number(),
    }),
  }),
  // Backend helper shape from lib/pagination.ts.
  z.object({
    data: z.array(eventRowSchema),
    total: z.coerce.number(),
    page: z.coerce.number(),
    pageSize: z.coerce.number(),
    totalPages: z.coerce.number(),
  }).transform((v) => ({
    data: v.data,
    pagination: {
      page: v.page,
      limit: v.pageSize,
      total: v.total,
      totalPages: v.totalPages,
    },
  })),
])

const operatorActionSchema: z.ZodType<OperatorAction> = z.object({
  id: z.string(),
  action_type: z.string(),
  summary: z.string(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
})

const executiveSummarySchema: z.ZodType<ExecutiveSummary> = z.object({
  timestamp: z.string(),
  today: z.object({
    sent: z.coerce.number().nonnegative(),
    replies: z.coerce.number().nonnegative(),
    interestedReplies: z.coerce.number().nonnegative(),
    bounces: z.coerce.number().nonnegative(),
    replyRate: z.coerce.number(),
    bounceRate: z.coerce.number(),
  }),
  yesterday: z.object({
    sent: z.coerce.number().nonnegative(),
    replies: z.coerce.number().nonnegative(),
    bounces: z.coerce.number().nonnegative(),
    replyRate: z.coerce.number(),
    bounceRate: z.coerce.number(),
  }),
  businessImpact: z.object({
    estimatedConversationsToday: z.coerce.number().nonnegative(),
    estimatedOpportunities: z.coerce.number().nonnegative(),
    replyTrendPct: z.coerce.number(),
  }),
  safety: z.object({
    complianceActive: z.boolean(),
    blockedContactsToday: z.coerce.number().nonnegative(),
  }),
})

const executiveForecastSchema = z.object({
  timestamp: z.string(),
  forecast: z.object({
    expectedRepliesToday: z.coerce.number().nonnegative(),
    projectedBounceRisk: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    estimatedSafeSendCapacityRemaining: z.coerce.number().nonnegative(),
  }),
  trends: z.object({
    days: z.coerce.number(),
    reply: z.object({
      direction: z.enum(['up', 'down']),
      changePct: z.coerce.number(),
      text: z.string(),
    }),
    bounce: z.object({
      direction: z.enum(['up', 'down']),
      changePct: z.coerce.number(),
      text: z.string(),
    }),
  }),
  earlyWarnings: z.array(z.string()).default([]),
  baselines: z.object({
    avgReplyRate: z.coerce.number(),
    avgBounceRate: z.coerce.number(),
  }),
})


async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error || `Request failed for ${url}`)
  }

  return (await response.json()) as T
}

function toCampaign(row: unknown): Campaign {
  const parsed = campaignSchema.parse(row)
  return {
    id: parsed.id,
    name: parsed.name,
    sequenceId: parsed.sequence_id,
    sequenceName: parsed.sequence_name,
    contactCount: parsed.contact_count,
    status: parsed.status,
    sent: parsed.sent_count,
    replies: parsed.reply_count,
    openRate: parsed.sent_count > 0 ? Math.round((parsed.open_count / parsed.sent_count) * 100) : 0,
    bounceRate: parsed.sent_count > 0 ? Number(((parsed.bounce_count / parsed.sent_count) * 100).toFixed(2)) : 0,
    createdAt: new Date(parsed.created_at),
  }
}

function toContact(row: unknown): Contact {
  const parsed = contactSchema.parse(row)
  return {
    id: parsed.id,
    email: parsed.email,
    name: parsed.name ?? '',
    company: parsed.company ?? '',
    title: parsed.title ?? '',
    source: parsed.source ?? '',
    customFields: parsed.custom_fields ?? {},
    status: parsed.status,
    addedAt: new Date(parsed.created_at),
  }
}

function toSequence(row: unknown): Sequence {
  const parsed = sequenceSchema.parse(row)
  return {
    id: parsed.id,
    name: parsed.name,
    steps: parsed.steps.map((step) => ({
      id: step.id,
      day: step.day_delay,
      subject: step.subject,
      body: step.body,
    })),
    createdAt: new Date(parsed.created_at),
    updatedAt: new Date(parsed.updated_at),
  }
}

function toReply(row: unknown): Reply {
  const parsed = replySchema.parse(row)
  const metadata = parsed.metadata ?? {}
  const rawMessages = Array.isArray((metadata as { messages?: unknown }).messages)
    ? ((metadata as { messages?: unknown[] }).messages as unknown[])
    : []

  const messages: ReplyMessage[] =
    rawMessages.length > 0
      ? rawMessages.map((message, index) => {
          const data = message as Record<string, unknown>
          return {
            id: String(data.id ?? `${parsed.id}-${index}`),
            from: String(data.from ?? parsed.from_email),
            to: String(data.to ?? ''),
            subject: String(data.subject ?? parsed.subject),
            body: String(data.body ?? ''),
            date: new Date(String(data.date ?? parsed.date)),
            isIncoming: data.isIncoming === false ? false : true,
          }
        })
      : [
          {
            id: `${parsed.id}-0`,
            from: parsed.from_email,
            to: '',
            subject: parsed.subject,
            body: '',
            date: new Date(parsed.date),
            isIncoming: true,
          },
        ]

  return {
    id: parsed.id,
    fromEmail: parsed.from_email,
    fromName: parsed.from_name || parsed.from_email,
    subject: parsed.subject,
    date: new Date(parsed.date),
    status: parsed.status,
    campaignId: String(parsed.campaign_id ?? ''),
    contactId: String(parsed.contact_id ?? ''),
    messages,
  }
}

type ActivityRow = { timestamp: string; [key: string]: unknown }

export const api = {
  campaigns: {
    async getAll(): Promise<Campaign[]> {
      const rows = await fetchJson<unknown[]>('/api/campaigns')
      return rows.map(toCampaign)
    },
    async getById(id: string): Promise<Campaign> {
      const row = await fetchJson<unknown>(`/api/campaigns/${id}`)
      return toCampaign(row)
    },
    async create(data: { name: string; sequenceId: string; sequenceName?: string }): Promise<Campaign> {
      const row = await fetchJson<unknown>('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name: data.name,
          sequenceId: Number(data.sequenceId),
        }),
      })
      return toCampaign({
        ...(row as Record<string, unknown>),
        sequence_name: data.sequenceName ?? '',
      })
    },
    async updateStatus(id: string, status: Campaign['status']): Promise<Campaign> {
      const row = await fetchJson<unknown>(`/api/campaigns/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      return toCampaign(row)
    },
  },
  contacts: {
    async getAll(): Promise<Contact[]> {
      const response = await fetchJson<{ data?: unknown[] }>('/api/contacts?limit=100')
      return (response.data ?? []).map(toContact)
    },
    async bulkCreate(data: Array<{ email: string; name: string; company: string }>): Promise<Contact[]> {
      const rows = await fetchJson<unknown[]>('/api/contacts', {
        method: 'POST',
        body: JSON.stringify({ contacts: data }),
      })
      return rows.map(toContact)
    },
    async importCsv(input: { csv: string; verify?: boolean; enrich?: boolean; dedupeByDomain?: boolean; sourceOverride?: string }): Promise<{ imported: number; contacts: Contact[] }> {
      const result = await fetchJson<{ imported: number; contacts: unknown[] }>('/api/contacts/import', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      return {
        imported: result.imported,
        contacts: (result.contacts ?? []).map(toContact),
      }
    },
    async importPreview(file: File): Promise<{
      detectedColumns: string[]
      sampleRows: Array<Record<string, unknown>>
      stats: { totalRows: number; validEmails: number; invalidEmails: number; duplicateEmails: number }
      suggestedMapping: Record<string, string> | null
    }> {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/contacts/import/preview', { method: 'POST', body: form })
      const raw = await res.text()
      const json = JSON.parse(raw)
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Preview failed (${res.status})`)
      }
      return json
    },
    async importFile(input: { file: File; mapping: Record<string, string>; verify?: boolean; dedupeByDomain?: boolean }): Promise<{ imported: number; contacts: Contact[] }> {
      const form = new FormData()
      form.append('file', input.file)
      form.append('mapping', JSON.stringify(input.mapping))
      form.append('verify', input.verify === false ? 'false' : 'true')
      form.append('dedupeByDomain', input.dedupeByDomain ? 'true' : 'false')
      const res = await fetch('/api/contacts/import', { method: 'POST', body: form })
      const raw = await res.text()
      const json = JSON.parse(raw)
      if (!res.ok) {
        throw new Error(json?.error || `Import failed (${res.status})`)
      }
      return {
        imported: Number(json.imported ?? 0),
        contacts: (json.contacts ?? []).map(toContact),
      }
    },
    async delete(id: string): Promise<{ success: boolean }> {
      return fetchJson<{ success: boolean }>(`/api/contacts/${id}`, {
        method: 'DELETE',
      })
    },
    async approve(input: { ids?: string[]; limit?: number }): Promise<{ ok: boolean; approved: number; contacts: unknown[]; skipped?: string }> {
      return fetchJson<{ ok: boolean; approved: number; contacts: unknown[]; skipped?: string }>('/api/contacts/approval', {
        method: 'POST',
        body: JSON.stringify(input),
      })
    },
    async researchApprove(input: { dryRun?: boolean; limit?: number; threshold?: number } = {}): Promise<ResearchApprovalResult> {
      if (input.dryRun) {
        const params = new URLSearchParams()
        if (input.limit) params.set('limit', String(input.limit))
        if (input.threshold) params.set('threshold', String(input.threshold))
        const query = params.toString()
        return fetchJson<ResearchApprovalResult>(`/api/contacts/research-approval${query ? `?${query}` : ''}`)
      }

      return fetchJson<ResearchApprovalResult>('/api/contacts/research-approval', {
        method: 'POST',
        body: JSON.stringify({
          limit: input.limit,
          threshold: input.threshold,
        }),
      })
    },
  },
  sequences: {
    async getAll(): Promise<Sequence[]> {
      const rows = await fetchJson<unknown[]>('/api/sequences')
      return rows.map(toSequence)
    },
    async getById(id: string): Promise<Sequence> {
      const row = await fetchJson<unknown>(`/api/sequences/${id}`)
      return toSequence(row)
    },
    async create(data: { name: string; steps: SequenceStep[] }): Promise<Sequence> {
      const row = await fetchJson<unknown>('/api/sequences', {
        method: 'POST',
        body: JSON.stringify({
          name: data.name,
          steps: data.steps.map((step) => ({
            day: step.day,
            subject: step.subject,
            body: step.body,
          })),
        }),
      })
      return toSequence(row)
    },
    async update(id: string, data: { name: string; steps: SequenceStep[] }): Promise<Sequence> {
      const row = await fetchJson<unknown>(`/api/sequences/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: data.name,
          steps: data.steps.map((step) => ({
            day: step.day,
            subject: step.subject,
            body: step.body,
          })),
        }),
      })
      return toSequence(row)
    },
  },
  replies: {
    async getAll(): Promise<Reply[]> {
      const response = await fetchJson<{ data?: unknown[] }>('/api/replies?limit=100')
      return (response.data ?? []).map(toReply)
    },
    async getById(id: string): Promise<Reply> {
      const row = await fetchJson<unknown>(`/api/replies/${id}`)
      return toReply(row)
    },
    async updateStatus(
      id: string,
      status: 'unread' | 'interested' | 'not_interested'
    ): Promise<{ success: boolean }> {
      return fetchJson<{ success: boolean }>(`/api/replies/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
    },
  },
  analytics: {
    async getAll(): Promise<AnalyticsData[]> {
      return fetchJson<AnalyticsData[]>('/api/analytics')
    },
    async getSummary(): Promise<AnalyticsData[]> {
      return fetchJson<AnalyticsData[]>('/api/analytics')
    },
    async getChartData(): Promise<Array<{ date: string; sent: number }>> {
      return fetchJson<Array<{ date: string; sent: number }>>('/api/dashboard/chart')
    },
  },
  activity: {
    async getRecent(): Promise<Array<Omit<ActivityRow, 'timestamp'> & { timestamp: Date }>> {
      const rows = await fetchJson<ActivityRow[]>('/api/dashboard/activity')
      return rows.map((row) => ({
        ...row,
        timestamp: new Date(row.timestamp),
      }))
    },
  },
  dashboard: {
    async getStats(): Promise<{
      emailsSentToday: number
      replies: number
      openRate: number
      bounceRate: number
    }> {
      return fetchJson<{
        emailsSentToday: number
        replies: number
        openRate: number
        bounceRate: number
      }>('/api/dashboard/stats')
    },
    async getChartData(): Promise<Array<{ date: string; sent: number }>> {
      return fetchJson<Array<{ date: string; sent: number }>>('/api/dashboard/chart')
    },
    async getActivityFeed(): Promise<Array<Omit<ActivityRow, 'timestamp'> & { timestamp: Date }>> {
      const rows = await fetchJson<ActivityRow[]>('/api/dashboard/activity')
      return rows.map((row) => ({
        ...row,
        timestamp: new Date(row.timestamp),
      }))
    },
  },
  inbox: {
    async getReplies(): Promise<Reply[]> {
      const response = await fetchJson<{ data?: unknown[] }>('/api/replies?limit=100')
      return (response.data ?? []).map(toReply)
    },
  },
  domains: {
    async getAll(): Promise<unknown[]> {
      return fetchJson<unknown[]>('/api/domains')
    },
  },
  queue: {
    async getStats(): Promise<QueueStats> {
      const row = await fetchJson<unknown>('/api/queue?action=stats')
      return queueStatsSchema.parse(row)
    },
  },
  infrastructure: {
    async getHealth(): Promise<InfrastructureHealth> {
      const row = await fetchJson<unknown>('/api/infrastructure/health')
      return infrastructureHealthSchema.parse(row)
    },
    async getAnalytics(): Promise<InfrastructureAnalytics> {
      const row = await fetchJson<unknown>('/api/infrastructure/analytics')
      return infrastructureAnalyticsSchema.parse(row)
    },
    async control(action: ControlAction, payload: Record<string, unknown> = {}): Promise<ControlResult> {
      return fetchJson<ControlResult>('/api/infrastructure/control', {
        method: 'POST',
        body: JSON.stringify({ action, ...payload }),
      })
    },
  },
  patterns: {
    async getAll(): Promise<PatternRecord[]> {
      const res = await fetchJson<{ data?: unknown[] }>('/api/patterns')
      const rows = Array.isArray(res.data) ? res.data : []
      return rows.map((row) => patternRecordSchema.parse(row))
    },
  },
  events: {
    async getRecent(limit = 50): Promise<PaginatedResponse<EventRow>> {
      const res = await fetchJson<unknown>(`/api/events?limit=${limit}&page=1`)
      return paginatedEventsSchema.parse(res)
    },
  },
  operator: {
    async getActions(limit = 50): Promise<OperatorAction[]> {
      const res = await fetchJson<{ data?: unknown[] }>(`/api/operator-actions?limit=${limit}`)
      const rows = Array.isArray(res.data) ? res.data : []
      return rows.map((row) => operatorActionSchema.parse(row))
    },
  },
  executive: {
    async getSummary(): Promise<ExecutiveSummary> {
      const row = await fetchJson<unknown>('/api/executive/summary')
      return executiveSummarySchema.parse(row)
    },
    async getForecast(days?: number): Promise<ExecutiveForecast> {
      const qs = typeof days === 'number' ? `?days=${days}` : ''
      const row = await fetchJson<unknown>(`/api/executive/forecast${qs}`)
      return executiveForecastSchema.parse(row)
    },
  },
}

export const api_getStats = async (): Promise<{
  emailsSentToday: number
  replies: number
  openRate: number
  bounceRate: number
}> => {
  return fetchJson<{
    emailsSentToday: number
    replies: number
    openRate: number
    bounceRate: number
  }>('/api/dashboard/stats')
}

export const api_getChartData = async (): Promise<Array<{ date: string; sent: number }>> => {
  return fetchJson<Array<{ date: string; sent: number }>>('/api/dashboard/chart')
}
