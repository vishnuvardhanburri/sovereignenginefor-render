import { NextResponse } from 'next/server'
import { buildProductionReadinessReport } from '@/lib/setup-readiness'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const domain = url.searchParams.get('domain') || 'sovereign-demo.example'
  const smtpHost = url.searchParams.get('smtp_host')
  const readiness = await buildProductionReadinessReport({ domain, smtpHost })

  return NextResponse.json({
    ok: true,
    product: 'Sovereign Engine',
    generatedAt: new Date().toISOString(),
    positioning: 'Compliance-first deliverability operating system for controlled, auditable outbound infrastructure.',
    readiness: {
      domain: readiness.domain,
      score: readiness.score,
      status: readiness.status,
      blockers: readiness.blockers,
      warnings: readiness.warnings,
      nextActions: readiness.nextActions,
    },
    safeClaims: [
      'Provider-aware pacing and lane-level controls.',
      'Safe-ramp and emergency-brake logic for reputation protection.',
      'Mock-safe stress proof before real delivery is enabled.',
      'Tamper-evident audit logging for privileged actions.',
      'Production gate blocks real sending until required buyer inputs are present.',
    ],
    notClaimed: [
      'A promise that every message lands in the inbox.',
      'Ignoring provider policies.',
      'Sending without buyer-owned domains and credentials.',
      'Sending without consent-aware contact handling, suppression, and unsubscribe policy.',
    ],
    buyerInputsRequired: [
      'Buyer-owned domains and DNS access.',
      'SMTP/ESP credentials and verified sender identities.',
      'Production secrets, HTTPS dashboard domain, Xavira-owned validation safeguards, and legal sending details.',
      'Consent-aware contact source and suppression policy.',
    ],
    proofEndpoints: [
      '/api/health/stats',
      '/api/setup/readiness',
      '/api/setup/report',
      '/api/due-diligence/report',
      '/api/handoff/data-room',
      '/api/production/gate',
      '/api/activity/replay',
    ],
  })
}
