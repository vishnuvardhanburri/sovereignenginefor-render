export type HunterVerdict = 'valid' | 'risky' | 'invalid' | 'unknown'

export interface HunterVerificationResult {
  provider: 'hunter'
  verdict: HunterVerdict
  score: number
  catchAll: boolean
  raw: Record<string, unknown> | null
  error?: string
}

export interface VerifyEmailWithHunterOptions {
  apiKey?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

function clampScore(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0.5
  const normalized = parsed > 1 ? parsed / 100 : parsed
  return Math.max(0, Math.min(1, Number(normalized.toFixed(2))))
}

function asBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1'
}

export function mapHunterVerification(data: Record<string, unknown>): Omit<HunterVerificationResult, 'provider' | 'raw' | 'error'> {
  const result = String(data.result ?? '').trim().toLowerCase()
  const score = clampScore(data.score)
  const catchAll = asBool(data.accept_all ?? data.acceptAll)

  if (result === 'deliverable') {
    return { verdict: 'valid', score, catchAll }
  }

  if (result === 'undeliverable') {
    return { verdict: 'invalid', score, catchAll }
  }

  if (result === 'risky') {
    return { verdict: 'risky', score, catchAll }
  }

  return { verdict: 'unknown', score, catchAll }
}

export async function verifyEmailWithHunter(
  email: string,
  options?: VerifyEmailWithHunterOptions
): Promise<HunterVerificationResult> {
  const apiKey = String(options?.apiKey ?? process.env.HUNTER_API_KEY ?? '').trim()
  if (!apiKey) {
    return {
      provider: 'hunter',
      verdict: 'unknown',
      score: 0.5,
      catchAll: false,
      raw: null,
      error: 'hunter_not_configured',
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 8_000)

  try {
    const url = new URL('https://api.hunter.io/v2/email-verifier')
    url.searchParams.set('email', email)
    url.searchParams.set('api_key', apiKey)

    const response = await (options?.fetchImpl ?? fetch)(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })

    if (!response.ok) {
      return {
        provider: 'hunter',
        verdict: 'unknown',
        score: 0.5,
        catchAll: false,
        raw: null,
        error: `hunter_http_${response.status}`,
      }
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
    const data = payload?.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : {}
    const mapped = mapHunterVerification(data)

    return {
      provider: 'hunter',
      ...mapped,
      raw: data,
    }
  } catch (error) {
    return {
      provider: 'hunter',
      verdict: 'unknown',
      score: 0.5,
      catchAll: false,
      raw: null,
      error: error instanceof Error && error.name === 'AbortError'
        ? 'hunter_timeout'
        : 'hunter_request_failed',
    }
  } finally {
    clearTimeout(timeout)
  }
}
