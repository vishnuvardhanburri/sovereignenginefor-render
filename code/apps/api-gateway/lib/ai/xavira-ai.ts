import { appEnv } from '@/lib/env'
import { extractJsonObject, tryOpenRouterJson } from '@/lib/ai/openrouter'

export type XaviraAiSource = 'xavira_ai' | 'fallback'
export type XaviraAiProvider = 'self_hosted' | 'openrouter' | 'fallback'

export interface XaviraAiJsonResult<T> {
  source: XaviraAiSource
  provider: XaviraAiProvider
  data: T
  error?: string
  model?: string
}

export interface TryXaviraAiJsonInput<T> {
  task: string
  system: string
  user: string
  fallback: T
  model?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function envEnabled(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function selfHostedChatCompletionsUrl(): string | null {
  const raw = String(process.env.XAVIRA_AI_CHAT_COMPLETIONS_URL || process.env.XAVIRA_AI_BASE_URL || '').trim()
  if (!raw) return null
  if (/\/chat\/completions\/?$/i.test(raw)) return raw
  return `${raw.replace(/\/+$/g, '')}/v1/chat/completions`
}

export function xaviraAiConfigured(): boolean {
  return Boolean(
    selfHostedChatCompletionsUrl() ||
      appEnv.openRouterApiKey()
  )
}

export function xaviraAiProviderLabel(): XaviraAiProvider {
  if (selfHostedChatCompletionsUrl()) return 'self_hosted'
  if (appEnv.openRouterApiKey()) return 'openrouter'
  return 'fallback'
}

async function trySelfHostedJson<T>(
  input: TryXaviraAiJsonInput<T>,
  endpoint: string
): Promise<XaviraAiJsonResult<T>> {
  const model = String(input.model || process.env.XAVIRA_AI_MODEL || appEnv.openRouterModel()).trim()
  const apiKey = String(process.env.XAVIRA_AI_API_KEY || '').trim()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 8_000)

  try {
    const response = await (input.fetchImpl ?? fetch)(endpoint, {
      method: 'POST',
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
        temperature: 0.2,
        max_tokens: 700,
        response_format: { type: 'json_object' },
        metadata: { task: input.task, engine: 'xavira_ai_rag' },
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      return {
        source: 'fallback',
        provider: 'self_hosted',
        data: input.fallback,
        error: `xavira_ai_http_${response.status}`,
        model,
      }
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
    const choices = Array.isArray(payload?.choices) ? payload.choices : []
    const first = choices[0] as Record<string, unknown> | undefined
    const message = isRecord(first?.message) ? first.message : null
    const parsed = extractJsonObject(String(message?.content ?? ''))

    if (!isRecord(parsed)) {
      return {
        source: 'fallback',
        provider: 'self_hosted',
        data: input.fallback,
        error: 'xavira_ai_invalid_json',
        model,
      }
    }

    return {
      source: 'xavira_ai',
      provider: 'self_hosted',
      data: parsed as T,
      model,
    }
  } catch (error) {
    return {
      source: 'fallback',
      provider: 'self_hosted',
      data: input.fallback,
      error: error instanceof Error && error.name === 'AbortError'
        ? 'xavira_ai_timeout'
        : 'xavira_ai_request_failed',
      model,
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function tryXaviraAiJson<T>(
  input: TryXaviraAiJsonInput<T>
): Promise<XaviraAiJsonResult<T>> {
  const selfHostedEndpoint = selfHostedChatCompletionsUrl()
  if (selfHostedEndpoint) {
    return trySelfHostedJson(input, selfHostedEndpoint)
  }

  if (!envEnabled(process.env.XAVIRA_AI_USE_OPENROUTER, true)) {
    return {
      source: 'fallback',
      provider: 'fallback',
      data: input.fallback,
      error: 'xavira_ai_provider_not_configured',
    }
  }

  const result = await tryOpenRouterJson({
    task: input.task,
    system: input.system,
    user: input.user,
    fallback: input.fallback,
    model: input.model,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
  })

  if (result.source !== 'openrouter') {
    return {
      source: 'fallback',
      provider: 'openrouter',
      data: result.data,
      error: result.error,
      model: result.model,
    }
  }

  return {
    source: 'xavira_ai',
    provider: 'openrouter',
    data: result.data,
    model: result.model,
  }
}
