import { NextRequest } from 'next/server'
import { appEnv } from '@/lib/env'
import {
  compactCycleBody,
  runOutboundCycleDirect,
  shouldRunOutboundCycleDirect,
} from '@/lib/outbound-cycle-direct'
import { enqueueOutboundCycleJob } from '@/lib/outbound-cycle-queue'
import { requestPublicOrigin } from '@/lib/request-origin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorize(request: NextRequest): boolean {
  const expected = appEnv.cronSecret()
  const provided =
    request.headers.get('x-cron-secret') ||
    request.nextUrl.searchParams.get('secret') ||
    ''
  return Boolean(expected && provided && provided === expected)
}

function safeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function clientIdFrom(request: NextRequest): number {
  const parsed = Number(request.nextUrl.searchParams.get('client_id') || process.env.DEFAULT_CLIENT_ID || 1)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 1
}

function intParam(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(Math.trunc(parsed), max))
}

function envBool(value: string | undefined | null, fallback: boolean): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return fallback
}

function freeTierSafeMode(): boolean {
  const profile = String(process.env.WEB_MEMORY_PROFILE ?? '').trim().toLowerCase()
  if (profile === 'free' || profile === 'small') return true
  return envBool(process.env.WEB_FREE_TIER_SAFE_MODE, false)
}

function setDefaultParam(runUrl: URL, params: URLSearchParams, key: string, value: string) {
  if (!params.has(key)) runUrl.searchParams.set(key, value)
}

function requestBoolParam(params: URLSearchParams, keys: string[], fallback: boolean): boolean {
  for (const key of keys) {
    if (!params.has(key)) continue
    return envBool(params.get(key), fallback)
  }
  return fallback
}

function buildRunUrl(request: NextRequest, clientId: number): string {
  const runUrl = new URL('/api/cron/daily-outbound', requestPublicOrigin(request))
  const params = request.nextUrl.searchParams
  const maxMapsLimit = intParam(
    process.env.DAILY_OUTBOUND_KICK_MAX_MAPS_LIMIT ?? null,
    1_000,
    0,
    1_000
  )
  const maxPlacesPerSearch = intParam(process.env.DAILY_OUTBOUND_KICK_MAX_MAPS_PLACES_PER_SEARCH ?? null, 50, 1, 50)

  for (const key of [
    'mode',
    'recoveryMode',
    'targetDailyVolume',
    'sendLimit',
    'approveLimit',
    'providerValidationLimit',
    'evidenceFetchLimit',
    'queueOnly',
    'queue_only',
    'dailyFloor',
    'dailyCeiling',
    'minDailyVolume',
    'maxDailyVolume',
    'researchUnlimited',
    'research_unlimited',
    'researchLimit',
    'researchApproveLimit',
    'readyInventoryTarget',
    'ready_inventory_target',
    'publicSearch',
    'publicSearchLimit',
    'publicSearchIndustry',
    'publicSearchPersona',
    'publicSearchRegion',
    'publicSearchQueries',
    'serpApi',
    'serpApiLimit',
    'serpApiQueries',
    'leadScout',
    'leadScoutLimit',
    'leadScoutIndustry',
    'leadScoutPersona',
    'leadScoutRegion',
    'industry',
    'persona',
    'region',
    'leadScoutEvidenceDeadlineMs',
    'leadScoutEvidenceMaxPages',
    'leadScoutEvidenceRequestTimeoutMs',
    'evidenceDeadlineMs',
    'evidenceMaxPages',
    'evidenceRequestTimeoutMs',
    'hunterSearch',
    'mapsLimit',
    'mapsPlacesPerSearch',
    'mapsSearches',
    'mapsLocation',
    'mapsRegion',
    'mapsIndustry',
  ]) {
    const value = params.get(key)
    if (!value) continue
    if (key === 'mapsLimit') {
      runUrl.searchParams.set(key, String(intParam(value, maxMapsLimit, 0, maxMapsLimit)))
    } else if (key === 'mapsPlacesPerSearch') {
      runUrl.searchParams.set(key, String(intParam(value, maxPlacesPerSearch, 1, maxPlacesPerSearch)))
    } else {
      runUrl.searchParams.set(key, value)
    }
  }

  runUrl.searchParams.set('client_id', String(clientId))
  runUrl.searchParams.set('compact', '1')
  runUrl.searchParams.set('cronCompact', '1')

  if (freeTierSafeMode() && shouldRunOutboundCycleDirect(request)) {
    const queueOnlyRequested = requestBoolParam(params, ['queueOnly', 'queue_only'], false)

    setDefaultParam(runUrl, params, 'providerValidationLimit', '0')
    setDefaultParam(runUrl, params, 'evidenceFetchLimit', queueOnlyRequested ? '0' : '6')
    setDefaultParam(runUrl, params, 'hunterSearch', '0')
    setDefaultParam(runUrl, params, 'mapsLimit', '0')
    setDefaultParam(runUrl, params, 'researchUnlimited', '1')
    setDefaultParam(runUrl, params, 'readyInventoryTarget', '800')
    setDefaultParam(runUrl, params, 'researchApproveLimit', queueOnlyRequested ? '25' : '200')
    setDefaultParam(runUrl, params, 'evidenceDeadlineMs', queueOnlyRequested ? '3500' : '6000')
    setDefaultParam(runUrl, params, 'evidenceMaxPages', queueOnlyRequested ? '1' : '2')
    setDefaultParam(runUrl, params, 'evidenceRequestTimeoutMs', queueOnlyRequested ? '900' : '1200')

    if (queueOnlyRequested) {
      setDefaultParam(runUrl, params, 'publicSearch', '0')
      setDefaultParam(runUrl, params, 'leadScout', '0')
    } else {
      setDefaultParam(runUrl, params, 'publicSearch', '1')
      setDefaultParam(runUrl, params, 'publicSearchLimit', '40')
      setDefaultParam(runUrl, params, 'leadScout', '1')
      setDefaultParam(runUrl, params, 'leadScoutLimit', '80')
    }
  }

  return runUrl.toString()
}

export async function POST(request: NextRequest) {
  return GET(request)
}

export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return new Response('ok=0 error=unauthorized', {
      status: 401,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }

  try {
    const clientId = clientIdFrom(request)
    const runUrl = buildRunUrl(request, clientId)
    if (shouldRunOutboundCycleDirect(request)) {
      const result = await runOutboundCycleDirect({
        publicRunUrl: runUrl,
        secret: appEnv.cronSecret(),
      })

      return new Response(
        [
          `ok=${result.ok ? 1 : 0}`,
          'cycleQueued=0',
          'directRun=1',
          `client=${clientId}`,
          'worker=direct-fallback',
          `cycleStatus=${result.status}`,
          `elapsedMs=${result.elapsedMs}`,
          `publicFallback=${result.usedPublicFallback ? 1 : 0}`,
          `body=${compactCycleBody(result.body)}`,
          `ts=${new Date().toISOString()}`,
        ].join(' '),
        {
          status: result.ok ? 200 : 502,
          headers: {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store',
          },
        }
      )
    }

    const queued = await enqueueOutboundCycleJob({
      clientId,
      runUrl,
    })

    return new Response(
      [
        'ok=1',
        'cycleQueued=1',
        `client=${clientId}`,
        `queue=${queued.queue}`,
        `job=${queued.jobId ?? queued.dedupeKey}`,
        `replacedCompleted=${queued.replacedCompleted ? 1 : 0}`,
        `replacedFailed=${queued.replacedFailed ? 1 : 0}`,
        'worker=embedded',
        `ts=${new Date().toISOString()}`,
      ].join(' '),
      {
        status: 202,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        },
      }
    )
  } catch (error) {
    console.error('[api/cron/daily-outbound-kick] enqueue failed', error)
    return new Response(`ok=0 cycleQueued=0 error=${safeError(error).slice(0, 240)}`, {
      status: 500,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }
}
