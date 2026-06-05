import { type NextRequest } from 'next/server'
import { isUnroutableHostname } from './request-origin'

type EnvLike = Record<string, string | undefined>

export type OutboundCycleDirectResult = {
  status: number
  ok: boolean
  body: string
  elapsedMs: number
  usedPublicFallback: boolean
}

function envBool(value: string | undefined | null, fallback: boolean): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return fallback
}

function envInt(value: string | undefined | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(Math.trunc(parsed), max))
}

function boolParam(request: NextRequest, names: string[]): boolean | null {
  for (const name of names) {
    const value = request.nextUrl.searchParams.get(name)
    if (value === null || value.trim() === '') continue
    return envBool(value, false)
  }
  return null
}

function memoryProfile(env: EnvLike): string {
  return String(env.WEB_MEMORY_PROFILE ?? '').trim().toLowerCase()
}

function freeTierSafeMode(env: EnvLike): boolean {
  const profile = memoryProfile(env)
  const fallback = profile === 'free' || profile === 'small'
  return envBool(env.WEB_FREE_TIER_SAFE_MODE, fallback)
}

export function outboundCycleWorkerLikelyAvailable(env: EnvLike = process.env): boolean {
  const safeMode = freeTierSafeMode(env)
  const defaultEnabled = !safeMode
  const enabled = envBool(env.WEB_EMBED_OUTBOUND_CYCLE_WORKER, defaultEnabled)
  const forced = envBool(env.WEB_EMBED_OUTBOUND_CYCLE_WORKER_FORCE, false)

  if (safeMode && enabled && !forced) return false
  return enabled
}

export function shouldRunOutboundCycleDirect(
  request: NextRequest,
  env: EnvLike = process.env
): boolean {
  const requestOverride = boolParam(request, [
    'direct',
    'directRun',
    'runInline',
    'inline',
    'sync',
  ])
  if (requestOverride !== null) return requestOverride

  const envOverride =
    env.DAILY_OUTBOUND_KICK_DIRECT_RUN ||
    env.DAILY_OUTBOUND_KICK_DIRECT_FALLBACK ||
    env.OUTBOUND_CYCLE_DIRECT_FALLBACK
  if (envOverride !== undefined && envOverride !== '') return envBool(envOverride, false)

  return !outboundCycleWorkerLikelyAvailable(env)
}

function localRunUrl(publicRunUrl: string, env: EnvLike): string {
  const url = new URL(publicRunUrl)
  const forcePublicFetch = envBool(env.OUTBOUND_CYCLE_PUBLIC_FETCH, false)
  if (forcePublicFetch && !isUnroutableHostname(url.hostname)) return url.toString()

  const internalBase = env.OUTBOUND_CYCLE_INTERNAL_BASE || `http://127.0.0.1:${env.PORT || '10000'}`
  return new URL(`${url.pathname}${url.search}`, internalBase).toString()
}

export async function runOutboundCycleDirect(input: {
  publicRunUrl: string
  secret: string
  env?: EnvLike
}): Promise<OutboundCycleDirectResult> {
  const env = input.env ?? process.env
  const timeoutMs = envInt(env.DAILY_OUTBOUND_KICK_DIRECT_TIMEOUT_MS, 120_000, 15_000, 300_000)
  const startedAt = Date.now()
  const runUrl = localRunUrl(input.publicRunUrl, env)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const headers = {
    'user-agent': 'Sovereign-Engine-Daily-Outbound-Kick/1.0',
    ...(input.secret ? { 'x-cron-secret': input.secret } : {}),
  }

  try {
    try {
      const response = await fetch(runUrl, {
        method: 'GET',
        headers,
        cache: 'no-store',
        signal: controller.signal,
      })
      return {
        status: response.status,
        ok: response.ok,
        body: await response.text(),
        elapsedMs: Date.now() - startedAt,
        usedPublicFallback: false,
      }
    } catch (localError) {
      if (runUrl === input.publicRunUrl) throw localError

      console.warn('[outbound-cycle-direct] local cycle fetch failed; retrying public origin', {
        error: localError instanceof Error ? localError.message : String(localError),
      })

      const response = await fetch(input.publicRunUrl, {
        method: 'GET',
        headers,
        cache: 'no-store',
        signal: controller.signal,
      })
      return {
        status: response.status,
        ok: response.ok,
        body: await response.text(),
        elapsedMs: Date.now() - startedAt,
        usedPublicFallback: true,
      }
    }
  } finally {
    clearTimeout(timeout)
  }
}

export function compactCycleBody(body: string, limit = 420): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, limit)
}
