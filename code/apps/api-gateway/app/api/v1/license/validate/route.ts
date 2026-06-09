import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { XAVIRA_COMMERCIAL_MODEL } from '@/lib/commercial-model'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const plans = {
  campaign_rescue: {
    name: XAVIRA_COMMERCIAL_MODEL.campaignRescueSprint.name,
    price: XAVIRA_COMMERCIAL_MODEL.campaignRescueSprint.label,
    currency: XAVIRA_COMMERCIAL_MODEL.currency,
    rights: ['one_campaign_review', 'copy_rewrite', 'follow_up_rewrite', 'client_facing_summary'],
    restrictions: ['one_live_campaign', 'no_bulk_sending_promise', 'no_platform_transfer'],
    limits: { campaigns: 1, apiRequestsPerDay: 100000, dailyControlPlaneVolume: 200000, simulatedEventsPerRun: 10000 },
  },
  control_partner: {
    name: XAVIRA_COMMERCIAL_MODEL.controlPartnerMonthly.name,
    price: XAVIRA_COMMERCIAL_MODEL.controlPartnerMonthly.label,
    currency: XAVIRA_COMMERCIAL_MODEL.currency,
    rights: ['weekly_campaign_review', 'reply_learning', 'client_reporting_support', 'campaign_control_support'],
    restrictions: ['requires_rescue_sprint_or_clear_campaign_evidence'],
    limits: { domains: 250, apiRequestsPerDay: 500000, dailyControlPlaneVolume: 1000000, simulatedEventsPerRun: 10000 },
  },
  custom_platform_support: {
    name: XAVIRA_COMMERCIAL_MODEL.operationsMaintenance.name,
    price: XAVIRA_COMMERCIAL_MODEL.operationsMaintenance.label,
    currency: XAVIRA_COMMERCIAL_MODEL.currency,
    rights: ['technical_support', 'platform_updates', 'infrastructure_guidance', 'monitoring_support'],
    restrictions: ['requires_active_rescue_or_partner_engagement'],
    limits: { domains: 250, apiRequestsPerDay: 500000, dailyControlPlaneVolume: 1000000, simulatedEventsPerRun: 10000 },
  },
}

function hash(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function configuredLicenses() {
  const raw = process.env.SOVEREIGN_LICENSE_KEYS || ''
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function resolvePlan(key: string) {
  if (/partner|white|commercial|reseller|agency/i.test(key)) return plans.control_partner
  if (/maintenance|support|operations|platform/i.test(key)) return plans.custom_platform_support
  return plans.campaign_rescue
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const licenseKey = String(body.license_key || body.licenseKey || '')
  const instanceId = String(body.instance_id || body.instanceId || 'unregistered-instance')
  const configured = configuredLicenses()
  const demoAllowed = process.env.NODE_ENV !== 'production' || process.env.MOCK_SMTP === 'true'
  const active =
    configured.length > 0
      ? configured.includes(licenseKey)
      : demoAllowed &&
        /^se_(internal_enterprise|white_label_commercial|operations_maintenance)_demo_[a-z0-9-]*$/i.test(
          licenseKey
        )

  const plan = resolvePlan(licenseKey)
  const generatedAt = new Date().toISOString()

  return NextResponse.json(
    {
      ok: true,
      active,
      product: XAVIRA_COMMERCIAL_MODEL.productName,
      positioning: 'Campaign rescue and outbound control support for teams that need better reply diagnosis and client-facing proof',
      plan,
      license: {
        fingerprint: licenseKey ? hash(licenseKey).slice(0, 16) : null,
        instance_id: instanceId,
        validated_at: generatedAt,
        expires_at: active ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null,
      },
      acquisitionNote:
        'Demo keys are for validation only. The current entry offer is the £5,000 Campaign Rescue Sprint.',
    },
    { status: active ? 200 : 401 }
  )
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: '/api/v1/license/validate',
    method: 'POST',
    demoLicenseKeys: [
      'se_internal_enterprise_demo_acquire',
      'se_white_label_commercial_demo_acquire',
      'se_operations_maintenance_demo_acquire',
    ],
    pricing: {
      currency: XAVIRA_COMMERCIAL_MODEL.currency,
      campaignRescueSprint: plans.campaign_rescue.price,
      controlPartnerMonthly: plans.control_partner.price,
      customPlatformSupport: plans.custom_platform_support.price,
    },
  })
}
