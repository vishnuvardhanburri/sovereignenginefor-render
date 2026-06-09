export const XAVIRA_COMMERCIAL_MODEL = {
  currency: 'GBP',
  currencySymbol: '£',
  productName: 'Xavira Control Stack',
  campaignRescueSprint: {
    name: 'Campaign Rescue Sprint',
    price: 5_000,
    label: '£5,000',
    rights:
      'One-time founder-led review of one live outbound campaign: leads, copy, follow-ups, sender/domain risk, and client-facing proof.',
  },
  controlPartnerMonthly: {
    name: 'Xavira Control Partner',
    priceMonthly: 3_000,
    label: '£3,000/month',
    rights:
      'Ongoing founder-led control partner support after proof: weekly campaign reviews, delivery visibility, reply learning, and client reporting support.',
  },
  internalEnterpriseLicense: {
    name: 'Internal Enterprise License',
    price: 40_000,
    label: '£40,000/year',
    rights:
      'Annual internal license for teams that want Xavira as their own communication-control operating layer after proof.',
  },
  whiteLabelCommercialLicense: {
    name: 'White-Label Commercial License',
    price: 160_000,
    label: '£160,000/year',
    rights:
      'Annual commercial license for agencies that want to package Xavira as a client-facing proof and control layer.',
    partnerEconomics:
      'Discuss only after proof, when the agency can resell campaign-control outcomes and protect client trust at scale.',
  },
  operationsMaintenance: {
    name: 'Agency White-Label Partner',
    setupPrice: 15_000,
    priceMonthly: 5_000,
    label: 'After proof',
    rights:
      '£15,000 setup plus £5,000/month for agencies that want guided white-label rollout before a full annual commercial license.',
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
