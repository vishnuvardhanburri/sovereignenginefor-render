import { NextRequest, NextResponse } from 'next/server'
import { buildProductionReadinessReport } from '@/lib/setup-readiness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function hasEnv(name: string) {
  return Boolean(process.env[name]?.trim())
}

function envValue(name: string) {
  return process.env[name]?.trim() || ''
}

function looksPlaceholder(value: string) {
  return !value || /mock|example|replace|your_|change-me/i.test(value)
}

export async function GET(request: NextRequest) {
  try {
    const domain = request.nextUrl.searchParams.get('domain') || 'sovereign-demo.example'
    const report = await buildProductionReadinessReport({ domain })
    const reasons: string[] = []
    const requiredForProduction = [
      'DATABASE_URL',
      'REDIS_URL',
      'AUTH_SECRET',
      'CRON_SECRET',
      'SECURITY_KILL_SWITCH_TOKEN',
      'SMTP_HOST',
    ]

    for (const name of requiredForProduction) {
      if (!hasEnv(name)) reasons.push(`Missing ${name}`)
    }

    if (!hasEnv('ZEROBOUNCE_API_KEY') && !hasEnv('HUNTER_API_KEY')) {
      reasons.push('Missing validation provider (ZEROBOUNCE_API_KEY or HUNTER_API_KEY)')
    }
    if (envValue('MOCK_SMTP') !== 'false') reasons.push('MOCK_SMTP is enabled; production sending remains locked')
    if (looksPlaceholder(`${envValue('SMTP_HOST')} ${envValue('SMTP_USER')} ${envValue('ZEROBOUNCE_API_KEY')} ${envValue('HUNTER_API_KEY')}`)) {
      reasons.push('SMTP or validator credentials still look like placeholders')
    }
    if (!hasEnv('SENDER_PHYSICAL_ADDRESS')) reasons.push('SENDER_PHYSICAL_ADDRESS is missing for compliance footer policy')
    if (report.status === 'BLOCKED') reasons.push('Readiness report has DNS/environment blockers')

    const dnsReasons = report.nextActions.filter((action) => /dns|spf|dkim|dmarc|domain/i.test(action))
    let status: 'PRODUCTION_READY' | 'DEMO_READY' | 'NEEDS_DNS' | 'NEEDS_SMTP' | 'NEEDS_VALIDATOR' | 'BLOCKED'
    if (!reasons.length) {
      status = 'PRODUCTION_READY'
    } else if (reasons.some((reason) => /SMTP|MOCK_SMTP/i.test(reason))) {
      status = 'NEEDS_SMTP'
    } else if (dnsReasons.length) {
      status = 'NEEDS_DNS'
    } else if (reasons.some((reason) => /ZEROBOUNCE|HUNTER|validator/i.test(reason))) {
      status = 'NEEDS_VALIDATOR'
    } else if (report.score >= 70) {
      status = 'DEMO_READY'
    } else {
      status = 'BLOCKED'
    }

    return NextResponse.json({
      ok: true,
      status,
      realSendingAllowed: status === 'PRODUCTION_READY',
      demoSafe: true,
      domain,
      readiness: {
        status: report.status,
        score: report.score,
        blockers: report.blockers,
        warnings: report.warnings,
      },
      reasons,
      message:
        status === 'PRODUCTION_READY'
          ? 'Production gate is open.'
          : 'Production sending is locked until buyer-owned credentials, DNS, validation, and compliance inputs are connected.',
    })
  } catch (error) {
    console.error('[api/production/gate] failed', error)
    return NextResponse.json({ ok: false, error: 'Failed to evaluate production gate' }, { status: 500 })
  }
}
