import { loadEncryptedSecret } from '@/lib/security/secret-vault'
import type { IngestionSourceType } from '@/lib/ingestion/connector-registry'

export interface SourceConnection {
  id: string
  clientId: number
  sourceType: IngestionSourceType
  name: string
  authType: 'none' | 'api_key' | 'oauth' | 'basic' | 'webhook_secret'
  config: Record<string, unknown>
  cursorState: Record<string, unknown>
  rateLimitPerMinute: number
}

export interface ConnectorPullInput {
  connection: SourceConnection
  limit: number
}

export interface ConnectorPullResult {
  records: Array<Record<string, unknown>>
  nextCursor?: Record<string, unknown>
  exhausted?: boolean
}

export interface IngestionConnector {
  sourceType: IngestionSourceType
  pull(input: ConnectorPullInput): Promise<ConnectorPullResult>
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function asNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(asString(value), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function recordsAtPath(payload: unknown, path: string | undefined): Array<Record<string, unknown>> {
  if (!path) {
    if (Array.isArray(payload)) return payload.filter(isRecord).map((item) => item as Record<string, unknown>)
    const payloadRecord = asRecord(payload)
    if (payloadRecord) {
      for (const key of ['records', 'contacts', 'people', 'data', 'results']) {
        const value = payloadRecord[key]
        if (Array.isArray(value)) return value.filter(isRecord).map((item) => item as Record<string, unknown>)
      }
    }
    return []
  }

  let current: unknown = payload
  for (const segment of path.split('.').filter(Boolean)) {
    const currentRecord = asRecord(current)
    if (!currentRecord) return []
    current = currentRecord[segment]
  }
  return Array.isArray(current) ? current.filter(isRecord).map((item) => item as Record<string, unknown>) : []
}

export function isRecord(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? (value as Record<string, unknown>) : null
}

export async function resolveConnectorSecret(
  connection: SourceConnection,
  envCandidates: string[]
): Promise<string | null> {
  const explicitEnv = asString(connection.config.secretEnv)
  const envNames = [explicitEnv, ...envCandidates].filter(Boolean)
  for (const envName of envNames) {
    const value = process.env[envName]
    if (value) return value
  }

  return loadEncryptedSecret({
    clientId: connection.clientId,
    secretType: 'integration_token',
    resourceType: 'source_connection',
    resourceId: connection.id,
  })
}

export async function fetchJson(input: {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 25_000)
  try {
    const response = await fetch(input.url, {
      method: input.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(input.body ? { 'content-type': 'application/json' } : {}),
        ...(input.headers ?? {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
      cache: 'no-store',
      signal: controller.signal,
    })
    const text = await response.text()
    const payload = text ? JSON.parse(text) : {}
    if (!response.ok) {
      throw new Error(`connector_http_${response.status}:${text.slice(0, 240)}`)
    }
    return payload
  } finally {
    clearTimeout(timeout)
  }
}
