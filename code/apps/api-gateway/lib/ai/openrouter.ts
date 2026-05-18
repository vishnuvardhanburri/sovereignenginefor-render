export type OpenRouterSource = 'openrouter' | 'fallback'

export interface OpenRouterJsonResult<T> {
  source: OpenRouterSource
  data: T
  error?: string
  model?: string
}

export interface TryOpenRouterJsonInput<T> {
  task: string
  system: string
  user: string
  fallback: T
  apiKey?: string
  model?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function openRouterReferer(): string {
  const explicit = process.env.APP_BASE_URL || process.env.APP_DOMAIN
  if (!explicit) return 'https://sovereignenginefor-render.onrender.com'
  return /^https?:\/\//i.test(explicit) ? explicit : `https://${explicit}`
}

export function extractJsonObject(text: string): unknown | null {
  const trimmed = String(text || '').trim()
  if (!trimmed) return null

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const direct = fenced?.[1]?.trim() || trimmed

  try {
    return JSON.parse(direct)
  } catch {
    // Continue to embedded-object extraction below.
  }

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      return null
    }
  }

  return null
}

export async function tryOpenRouterJson<T>(
  input: TryOpenRouterJsonInput<T>
): Promise<OpenRouterJsonResult<T>> {
  const apiKey = String(input.apiKey ?? process.env.OPENROUTER_API_KEY ?? '').trim()
  const model = String(
    input.model ??
      process.env.OPENROUTER_MODEL ??
      'meta-llama/llama-3.1-8b-instruct:free'
  ).trim()

  if (!apiKey) {
    return {
      source: 'fallback',
      data: input.fallback,
      error: 'openrouter_not_configured',
      model,
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 8_000)

  try {
    const response = await (input.fetchImpl ?? fetch)('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': openRouterReferer(),
        'X-Title': 'Sovereign Engine',
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
        metadata: { task: input.task },
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      return {
        source: 'fallback',
        data: input.fallback,
        error: `openrouter_http_${response.status}`,
        model,
      }
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
    const choices = Array.isArray(payload?.choices) ? payload?.choices : []
    const first = choices[0] as Record<string, unknown> | undefined
    const message = isRecord(first?.message) ? first.message : null
    const content = String(message?.content ?? '')
    const parsed = extractJsonObject(content)

    if (!isRecord(parsed)) {
      return {
        source: 'fallback',
        data: input.fallback,
        error: 'openrouter_invalid_json',
        model,
      }
    }

    return {
      source: 'openrouter',
      data: parsed as T,
      model,
    }
  } catch (error) {
    return {
      source: 'fallback',
      data: input.fallback,
      error: error instanceof Error && error.name === 'AbortError'
        ? 'openrouter_timeout'
        : 'openrouter_request_failed',
      model,
    }
  } finally {
    clearTimeout(timeout)
  }
}
