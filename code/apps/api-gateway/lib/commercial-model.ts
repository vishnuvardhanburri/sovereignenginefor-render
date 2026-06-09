export const XAVIRA_COMMERCIAL_MODEL = {
  currency: 'GBP',
  currencySymbol: '£',
  productName: 'Xavira Control Stack',
  campaignRescueSprint: {
    name: 'Campaign Rescue Sprint',
    price: 500,
    label: '£500',
    rights:
      'One-time founder-led review of one live outbound campaign: leads, copy, follow-ups, sender/domain risk, and client-facing proof.',
  },
  controlPartnerMonthly: {
    name: 'Xavira Control Partner',
    priceMonthly: 1_500,
    label: '£1,500/month',
    rights:
      'Ongoing founder-led control partner support after proof: weekly campaign reviews, delivery visibility, reply learning, and client reporting support.',
  },
  internalEnterpriseLicense: {
    name: 'Campaign Rescue Sprint',
    price: 500,
    label: '£500',
    rights:
      'One-time founder-led campaign rescue for a team running its own outbound campaign.',
  },
  whiteLabelCommercialLicense: {
    name: 'Xavira Control Partner',
    price: 1_500,
    label: '£1,500/month',
    rights:
      'Monthly partner support for agencies that need campaign proof, delivery visibility, and client reporting control.',
    partnerEconomics:
      'Designed to start with one rescued campaign, then continue only if Xavira is helping the agency protect client trust and improve reply conversations.',
  },
  operationsMaintenance: {
    name: 'Custom Platform Support',
    priceMonthly: 1_500,
    label: 'After proof',
    rights:
      'Only discussed after the rescue sprint proves a real campaign pain and the buyer wants ongoing support.',
  },
} as const

export type XaviraOfferType = 'direct' | 'agency'

export function commercialDealValueGbp(offerType: XaviraOfferType): number {
  return offerType === 'agency'
    ? XAVIRA_COMMERCIAL_MODEL.controlPartnerMonthly.priceMonthly
    : XAVIRA_COMMERCIAL_MODEL.campaignRescueSprint.price
}

export function commercialDealLabel(offerType: XaviraOfferType): string {
  return offerType === 'agency'
    ? XAVIRA_COMMERCIAL_MODEL.controlPartnerMonthly.label
    : XAVIRA_COMMERCIAL_MODEL.campaignRescueSprint.label
}

export function formatGbp(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: XAVIRA_COMMERCIAL_MODEL.currency,
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}
