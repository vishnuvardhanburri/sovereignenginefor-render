import { NextRequest, NextResponse } from 'next/server'
import { appEnv } from '@/lib/env'
import { resolveSystemApprovalWindow } from '@/lib/contact-approval-window'
import { buildDailyOutboundPlan } from '@/lib/daily-outbound'
import { notifyTelegramEvent } from '@/lib/telegram-notifications'

type StageResult = {
  stage: 'sheet_import' | 'research_approval' | 'queue_outbound'
  ok: boolean
  status: number
  skipped?: string
  data?: unknown
  error?: string
}

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

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.slice(0, 1000) }
  }
}

async function callStage(
  stage: StageResult['stage'],
  url: URL,
  init?: RequestInit
): Promise<StageResult> {
  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    })
    const data = await readJson(response)
    return {
      stage,
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    }
  } catch (error) {
    return {
      stage,
      ok: false,
      status: 0,
      error: safeError(error),
    }
  }
}

function getNumericField(data: unknown, key: string): number {
  if (!data || typeof data !== 'object') return 0
  const value = (data as Record<string, unknown>)[key]
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  try {
    const params = request.nextUrl.searchParams
    const clientId = Number(params.get('client_id') || process.env.DEFAULT_CLIENT_ID || 1)
    const approvalWindow = await resolveSystemApprovalWindow(clientId)
    const plan = buildDailyOutboundPlan({
      approvalWindow,
      env: process.env,
      query: {
        clientId: String(clientId),
        dryRun: params.get('dryRun') || params.get('preview'),
        sheetUrl: params.get('sheetUrl'),
        sheetLimit: params.get('sheetLimit'),
        approveLimit: params.get('approveLimit'),
        sendLimit: params.get('sendLimit'),
      },
    })
    const stages: StageResult[] = []
    const origin = request.nextUrl.origin
    const cronSecret = appEnv.cronSecret()

    if (!plan.enabled) {
      return NextResponse.json({
        ok: true,
        enabled: false,
        daily: true,
        plan,
        stages,
      })
    }

    if (plan.runSheetImport) {
      const sheetUrl = new URL('/api/contacts/import/google-sheet', origin)
      sheetUrl.searchParams.set('client_id', String(plan.clientId))
      sheetUrl.searchParams.set('limit', String(plan.sheetLimit))
      sheetUrl.searchParams.set('dedupeByDomain', 'true')

      const method = plan.dryRun ? 'GET' : 'POST'
      const url =
        method === 'GET'
          ? (() => {
              sheetUrl.searchParams.set('sheetUrl', plan.sheetUrl)
              return sheetUrl
            })()
          : sheetUrl

      stages.push(
        await callStage('sheet_import', url, {
          method,
          headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
          body:
            method === 'POST'
              ? JSON.stringify({
                  clientId: plan.clientId,
                  sheetUrl: plan.sheetUrl,
                  limit: plan.sheetLimit,
                  dedupeByDomain: true,
                })
              : undefined,
        })
      )
    } else {
      stages.push({
        stage: 'sheet_import',
        ok: true,
        status: 204,
        skipped: 'no_sheet_configured_existing_contacts_only',
      })
    }

    if (plan.runResearchApproval) {
      const approvalUrl = new URL('/api/contacts/research-approval', origin)
      approvalUrl.searchParams.set('client_id', String(plan.clientId))
      approvalUrl.searchParams.set('limit', String(plan.approveLimit))

      stages.push(
        await callStage('research_approval', approvalUrl, {
          method: plan.dryRun ? 'GET' : 'POST',
          headers: plan.dryRun ? undefined : { 'content-type': 'application/json' },
          body: plan.dryRun
            ? undefined
            : JSON.stringify({
                clientId: plan.clientId,
                limit: plan.approveLimit,
              }),
        })
      )
    }

    if (plan.runQueue) {
      const queueUrl = new URL('/api/cron/outbound', origin)
      queueUrl.searchParams.set('client_id', String(plan.clientId))
      queueUrl.searchParams.set('limit', String(plan.sendLimit))

      stages.push(
        await callStage('queue_outbound', queueUrl, {
          method: 'GET',
          headers: { 'x-cron-secret': cronSecret },
        })
      )
    } else {
      stages.push({
        stage: 'queue_outbound',
        ok: true,
        status: 204,
        skipped: plan.dryRun ? 'dry_run_no_email_queued' : 'send_limit_or_capacity_blocked',
      })
    }

    const queuedStage = stages.find((stage) => stage.stage === 'queue_outbound')
    const approvalStage = stages.find((stage) => stage.stage === 'research_approval')
    const sheetStage = stages.find((stage) => stage.stage === 'sheet_import')
    const queued = getNumericField(queuedStage?.data, 'queued')
    const approved = getNumericField(approvalStage?.data, 'approved')
    const imported = getNumericField(sheetStage?.data, 'imported')
    const hardFailures = stages.filter(
      (stage) => !stage.ok && stage.stage !== 'sheet_import'
    )

    void notifyTelegramEvent({
      type: 'daily_outbound',
      dryRun: plan.dryRun,
      imported,
      approved,
      queued,
      sendLimit: plan.sendLimit,
      approveLimit: plan.approveLimit,
      failures: stages.filter((stage) => !stage.ok).length,
    })

    return NextResponse.json({
      ok: hardFailures.length === 0,
      enabled: true,
      daily: true,
      clientId: plan.clientId,
      dryRun: plan.dryRun,
      generatedAt: new Date().toISOString(),
      summary: {
        imported,
        approved,
        queued,
        hardFailures: hardFailures.length,
      },
      plan,
      approvalWindow,
      stages,
    })
  } catch (error) {
    console.error('[api/cron/daily-outbound] failed', error)
    return NextResponse.json(
      { ok: false, error: 'failed', detail: safeError(error) },
      { status: 500 }
    )
  }
}
