import assert from 'node:assert/strict'
import {
  approvedContactQueueBlockers,
  enrichProspectWithProviderValidation,
  enrichProspectWithPublicEmailEvidence,
  pageContainsExactEmail,
  scoreProspectForResearchApproval,
} from '../lib/prospect-research'

async function main() {
assert.equal(
  pageContainsExactEmail(
    '<a href="mailto:partnerships@realagency.com">Partner with us</a>',
    'partnerships@realagency.com'
  ),
  true
)
assert.equal(
  pageContainsExactEmail('Email partnerships [at] realagency [dot] com', 'partnerships@realagency.com'),
  true
)
assert.equal(
  pageContainsExactEmail('Contact sales@realagency.com for growth', 'partnerships@realagency.com'),
  false
)

const safe = scoreProspectForResearchApproval({
  id: 1,
  email: 'opportunity@ignitevisibility.com',
  email_domain: 'ignitevisibility.com',
  company: 'Ignite Visibility',
  company_domain: 'ignitevisibility.com',
  source: 'google_sheet_import',
  status: 'active',
  verification_status: 'valid',
  custom_fields: {
    sheet_import: true,
    auto_approval_eligible: true,
    public_evidence_url: 'https://ignitevisibility.com/contact/',
    reason_to_contact: 'Agency with public growth and demand generation signals.',
  },
})

assert.equal(safe.approved, true)
assert.equal(safe.blockers.length, 0)
assert.ok(safe.score >= 72)
assert.ok(safe.reasons.includes('safe_business_inbox'))
assert.equal(safe.bounceRisk, 'low')
assert.equal(safe.recommendation, 'approve')
assert.equal(safe.verificationLabel, 'verified')
assert.equal(safe.mailboxQuality, 'commercial')
assert.equal(safe.sourceStrength, 'provider_validated')
assert.match(safe.decisionSummary, /Sendable/)

const unverifiedOpportunityInbox = scoreProspectForResearchApproval({
  id: 12,
  email: 'opportunity@realagency.com',
  email_domain: 'realagency.com',
  company: 'Real Agency',
  company_domain: 'realagency.com',
  source: 'google_sheet_import',
  status: 'active',
  verification_status: 'pending',
  custom_fields: {
    sheet_import: true,
    auto_approval_eligible: true,
    public_evidence_url: 'https://realagency.com/contact',
    reason_to_contact: 'Agency with public growth and demand generation signals.',
  },
})

assert.equal(unverifiedOpportunityInbox.approved, false)
assert.ok(
  unverifiedOpportunityInbox.blockers.includes(
    'generic_inbox_requires_email_validation'
  )
)

const personal = scoreProspectForResearchApproval({
  id: 2,
  email: 'founder@gmail.com',
  email_domain: 'gmail.com',
  company: 'Founder',
  company_domain: 'example.com',
  source: 'google_sheet_import',
  status: 'active',
  verification_status: 'pending',
  custom_fields: {
    sheet_import: true,
    auto_approval_eligible: true,
    public_evidence_url: 'https://example.com/contact',
  },
})

assert.equal(personal.approved, false)
assert.ok(personal.blockers.includes('personal_email_domain'))

const unsupportedInbox = scoreProspectForResearchApproval({
  id: 3,
  email: 'support@realagency.com',
  email_domain: 'realagency.com',
  company: 'Real Agency',
  company_domain: 'realagency.com',
  source: 'google_sheet_import',
  status: 'active',
  verification_status: 'pending',
  custom_fields: {
    sheet_import: true,
    auto_approval_eligible: true,
    public_evidence_url: 'https://realagency.com/contact',
  },
})

assert.equal(unsupportedInbox.approved, false)
assert.ok(unsupportedInbox.blockers.includes('blocked_mailbox_prefix'))
assert.equal(unsupportedInbox.mailboxQuality, 'risky')
assert.match(unsupportedInbox.decisionSummary, /Hold/)

const pressInbox = scoreProspectForResearchApproval({
  id: 31,
  email: 'press@mistral.ai',
  email_domain: 'mistral.ai',
  company: 'Mistral',
  company_domain: 'mistral.ai',
  source: 'google_sheet_import',
  status: 'active',
  verification_status: 'valid',
  custom_fields: {
    sheet_import: true,
    auto_approval_eligible: true,
    public_evidence_url: 'https://mistral.ai/news',
    reason_to_contact: 'Company appears relevant to outbound infrastructure or AI security.',
  },
})

assert.equal(pressInbox.approved, false)
assert.ok(pressInbox.blockers.includes('blocked_mailbox_prefix'))

assert.ok(
  approvedContactQueueBlockers({
    id: 32,
    email: 'fraud@netlify.com',
    email_domain: 'netlify.com',
    company: 'Netlify',
    company_domain: 'netlify.com',
    source: 'google_sheet_import',
    status: 'active',
    verification_status: 'valid',
    custom_fields: {
      send_status: 'approved',
      public_evidence_url: 'https://netlify.com/contact',
    },
  }).includes('blocked_mailbox_prefix')
)

assert.ok(
  approvedContactQueueBlockers({
    id: 33,
    email: 'u003esupport@render.com',
    email_domain: 'render.com',
    company: 'Render',
    company_domain: 'render.com',
    source: 'google_sheet_import',
    status: 'active',
    verification_status: 'valid',
    custom_fields: {
      send_status: 'approved',
      public_evidence_url: 'https://render.com/contact',
    },
  }).includes('invalid_email')
)

const mismatch = scoreProspectForResearchApproval({
  id: 4,
  email: 'sales@realagency.com',
  email_domain: 'realagency.com',
  company: 'Different Agency',
  company_domain: 'differentagency.com',
  source: 'google_sheet_import',
  status: 'active',
  verification_status: 'pending',
  custom_fields: {
    sheet_import: true,
    auto_approval_eligible: true,
    public_evidence_url: 'https://differentagency.com/contact',
  },
})

assert.equal(mismatch.approved, false)
assert.ok(mismatch.blockers.includes('email_company_domain_mismatch'))

const personLike = scoreProspectForResearchApproval({
  id: 5,
  email: 'alex.lee@realagency.com',
  email_domain: 'realagency.com',
  company: 'Real Agency',
  company_domain: 'realagency.com',
  source: 'google_sheet_import',
  status: 'active',
  verification_status: 'pending',
  custom_fields: {
    sheet_import: true,
    auto_approval_eligible: true,
    public_evidence_url: 'https://realagency.com/team',
  },
})

assert.equal(personLike.approved, false)
assert.ok(personLike.blockers.includes('person_like_email_requires_manual_review'))

const unverifiedGenericInbox = scoreProspectForResearchApproval({
  id: 6,
  email: 'hello@realagency.com',
  email_domain: 'realagency.com',
  company: 'Real Agency',
  company_domain: 'realagency.com',
  source: 'google_sheet_import',
  status: 'active',
  verification_status: 'pending',
  custom_fields: {
    sheet_import: true,
    auto_approval_eligible: true,
    public_evidence_url: 'https://realagency.com/contact',
    reason_to_contact: 'Agency with public growth and demand generation signals.',
  },
})

assert.equal(unverifiedGenericInbox.approved, false)
assert.equal(unverifiedGenericInbox.mailboxQuality, 'generic')
assert.equal(unverifiedGenericInbox.sourceStrength, 'domain_matched')
assert.ok(
  unverifiedGenericInbox.blockers.includes('generic_inbox_requires_email_validation')
)

const publicSearchBusinessRoleInbox = scoreProspectForResearchApproval({
  id: 60,
  email: 'hello@realagency.com',
  email_domain: 'realagency.com',
  company: 'Real Agency',
  company_domain: 'realagency.com',
  source: 'public_search',
  status: 'active',
  verification_status: 'pending',
  custom_fields: {
    public_search: true,
    auto_approval_eligible: true,
    email_evidence: 'business_domain_role_pattern',
    fit_score: 82,
    public_evidence_url: 'https://realagency.com/',
    reason_to_contact: 'Agency with public outbound infrastructure and demand generation signals.',
  },
})

assert.equal(publicSearchBusinessRoleInbox.approved, false)
assert.equal(publicSearchBusinessRoleInbox.sourceStrength, 'pattern_only')
assert.ok(
  publicSearchBusinessRoleInbox.blockers.includes(
    'weak_generic_inbox_requires_verification_or_public_proof'
  )
)
assert.ok(
  approvedContactQueueBlockers({
    id: 60,
    email: 'hello@realagency.com',
    email_domain: 'realagency.com',
    company: 'Real Agency',
    company_domain: 'realagency.com',
    source: 'public_search',
    status: 'active',
    verification_status: 'pending',
    custom_fields: {
      send_status: 'approved',
      public_search: true,
      email_evidence: 'business_domain_role_pattern',
      fit_score: 82,
      public_evidence_url: 'https://realagency.com/',
    },
  }).includes('weak_generic_inbox_requires_verification_or_public_proof')
)

const openLeadGraphBusinessRoleInbox = scoreProspectForResearchApproval({
  id: 62,
  email: 'hello@strongagency.com',
  email_domain: 'strongagency.com',
  company: 'Strong Agency',
  company_domain: 'strongagency.com',
  source: 'owned_open_lead_graph',
  status: 'active',
  verification_status: 'pending',
  custom_fields: {
    lead_scout: true,
    data_source: 'owned_open_lead_graph',
    email_evidence: 'synthetic_role_pattern',
    fit_score: 90,
    public_evidence_url: 'https://strongagency.com/',
    reason_to_contact: 'Agency with public outbound, RevOps, and infrastructure service signals.',
  },
})

assert.equal(openLeadGraphBusinessRoleInbox.approved, false)
assert.ok(
  openLeadGraphBusinessRoleInbox.blockers.includes(
    'weak_generic_inbox_requires_verification_or_public_proof'
  )
)
assert.ok(
  approvedContactQueueBlockers({
    id: 62,
    email: 'hello@strongagency.com',
    email_domain: 'strongagency.com',
    company: 'Strong Agency',
    company_domain: 'strongagency.com',
    source: 'owned_open_lead_graph',
    status: 'active',
    verification_status: 'pending',
    custom_fields: {
      send_status: 'approved',
      lead_scout: true,
      data_source: 'owned_open_lead_graph',
      email_evidence: 'synthetic_role_pattern',
      fit_score: 90,
      public_evidence_url: 'https://strongagency.com/',
    },
  }).includes('weak_generic_inbox_requires_verification_or_public_proof')
)

const unverifiedSalesInbox = scoreProspectForResearchApproval({
  id: 61,
  email: 'sales@realagency.com',
  email_domain: 'realagency.com',
  company: 'Real Agency',
  company_domain: 'realagency.com',
  source: 'google_sheet_import',
  status: 'active',
  verification_status: 'pending',
  custom_fields: {
    sheet_import: true,
    auto_approval_eligible: true,
    public_evidence_url: 'https://realagency.com/contact',
    reason_to_contact: 'Agency with public growth and demand generation signals.',
  },
})

assert.equal(unverifiedSalesInbox.approved, false)
assert.ok(
  unverifiedSalesInbox.blockers.includes('generic_inbox_requires_email_validation')
)
assert.ok(
  approvedContactQueueBlockers({
    id: 61,
    email: 'sales@realagency.com',
    email_domain: 'realagency.com',
    company: 'Real Agency',
    company_domain: 'realagency.com',
    source: 'google_sheet_import',
    status: 'active',
    verification_status: 'pending',
    custom_fields: {
      send_status: 'approved',
      public_evidence_url: 'https://realagency.com/contact',
    },
  }).includes('generic_inbox_requires_email_validation')
)

const verifiedGenericInbox = scoreProspectForResearchApproval({
  id: 7,
  email: 'hello@realagency.com',
  email_domain: 'realagency.com',
  company: 'Real Agency',
  company_domain: 'realagency.com',
  source: 'google_sheet_import',
  status: 'active',
  verification_status: 'valid',
  custom_fields: {
    sheet_import: true,
    auto_approval_eligible: true,
    public_evidence_url: 'https://realagency.com/contact',
    reason_to_contact: 'Agency with public growth and demand generation signals.',
  },
})

assert.equal(verifiedGenericInbox.approved, true)
assert.equal(verifiedGenericInbox.sourceStrength, 'provider_validated')

const exactEvidenceGenericInbox = scoreProspectForResearchApproval({
  id: 71,
  email: 'hello@realagency.com',
  email_domain: 'realagency.com',
  company: 'Real Agency',
  company_domain: 'realagency.com',
  source: 'google_sheet_import',
  status: 'active',
  verification_status: 'pending',
  custom_fields: {
    sheet_import: true,
    auto_approval_eligible: true,
    email_evidence: 'public_mailto_match',
    public_evidence_url: 'https://realagency.com/contact',
    reason_to_contact: 'Agency with public growth and demand generation signals.',
  },
})

assert.equal(exactEvidenceGenericInbox.approved, true)
assert.equal(exactEvidenceGenericInbox.sourceStrength, 'exact_public')
assert.deepEqual(
  approvedContactQueueBlockers({
    id: 71,
    email: 'hello@realagency.com',
    email_domain: 'realagency.com',
    company: 'Real Agency',
    company_domain: 'realagency.com',
    source: 'google_sheet_import',
    status: 'active',
    verification_status: 'pending',
    custom_fields: exactEvidenceGenericInbox.evidenceUrl
      ? {
          email_evidence: 'public_mailto_match',
          public_evidence_url: exactEvidenceGenericInbox.evidenceUrl,
          fit_score: 95,
        }
      : { email_evidence: 'public_mailto_match', fit_score: 95 },
  }),
  []
)

const guessedPartnershipsInbox = scoreProspectForResearchApproval({
  id: 8,
  email: 'partnerships@realagency.com',
  email_domain: 'realagency.com',
  company: 'Real Agency',
  company_domain: 'realagency.com',
  source: 'google_sheet_import',
  status: 'active',
  verification_status: 'pending',
  custom_fields: {
    sheet_import: true,
    auto_approval_eligible: true,
    public_evidence_url: 'https://realagency.com/about',
    reason_to_contact: 'Agency with public growth and demand generation signals.',
  },
})

assert.equal(guessedPartnershipsInbox.approved, false)
assert.ok(
  guessedPartnershipsInbox.blockers.includes(
    'risky_role_requires_exact_public_email_evidence'
  )
)

const publiclyVerifiedPartnershipsInbox = scoreProspectForResearchApproval({
  id: 9,
  email: 'partnerships@realagency.com',
  email_domain: 'realagency.com',
  company: 'Real Agency',
  company_domain: 'realagency.com',
  source: 'google_sheet_import',
  status: 'active',
  verification_status: 'pending',
  custom_fields: {
    sheet_import: true,
    auto_approval_eligible: true,
    email_evidence: 'public_page_email_match',
    public_evidence_url: 'https://realagency.com/partners',
    reason_to_contact: 'Agency with public growth and demand generation signals.',
  },
})

assert.equal(publiclyVerifiedPartnershipsInbox.approved, true)

const exactEvidenceResult = await enrichProspectWithPublicEmailEvidence(
  {
    id: 10,
    email: 'partnerships@realagency.com',
    email_domain: 'realagency.com',
    company: 'Real Agency',
    company_domain: 'realagency.com',
    source: 'google_sheet_import',
    status: 'active',
    verification_status: 'pending',
    custom_fields: {
      sheet_import: true,
      auto_approval_eligible: true,
      public_evidence_url: 'https://realagency.com/partners',
      reason_to_contact: 'Agency with public growth and demand generation signals.',
    },
  },
  {
    fetchPage: async () => ({
      ok: true,
      text: async () => '<a href="mailto:partnerships@realagency.com">Partnerships</a>',
    }),
    now: () => new Date('2026-05-18T00:00:00.000Z'),
  }
)

assert.equal(exactEvidenceResult.checked, true)
assert.equal(exactEvidenceResult.matched, true)
assert.equal(
  exactEvidenceResult.contact.custom_fields?.email_evidence,
  'public_page_email_match'
)

const exactEvidenceScore = scoreProspectForResearchApproval(
  exactEvidenceResult.contact
)
assert.equal(exactEvidenceScore.approved, true)
assert.deepEqual(approvedContactQueueBlockers(exactEvidenceResult.contact), [])

const providerValidatedGeneric = await enrichProspectWithProviderValidation(
  {
    id: 101,
    email: 'hello@realagency.com',
    email_domain: 'realagency.com',
    company: 'Real Agency',
    company_domain: 'realagency.com',
    source: 'google_sheet_import',
    status: 'active',
    verification_status: 'pending',
    custom_fields: {
      sheet_import: true,
      auto_approval_eligible: true,
      public_evidence_url: 'https://realagency.com/contact',
      reason_to_contact: 'Agency with public growth and demand generation signals.',
    },
  },
  {
    verifyEmail: async () => ({
      provider: 'hunter',
      verdict: 'valid',
      score: 0.91,
      catchAll: false,
      raw: null,
    }),
    now: () => new Date('2026-05-18T00:00:00.000Z'),
  }
)

assert.equal(providerValidatedGeneric.checked, true)
assert.equal(providerValidatedGeneric.contact.verification_status, 'valid')
assert.equal(providerValidatedGeneric.contact.custom_fields?.email_evidence, 'provider_validated')
const providerValidatedGenericScore = scoreProspectForResearchApproval(providerValidatedGeneric.contact)
assert.equal(providerValidatedGenericScore.approved, true)
assert.equal(providerValidatedGenericScore.sourceStrength, 'provider_validated')
assert.deepEqual(approvedContactQueueBlockers(providerValidatedGeneric.contact), [])

const providerValidatedSales = await enrichProspectWithProviderValidation(
  {
    id: 103,
    email: 'sales@realagency.com',
    email_domain: 'realagency.com',
    company: 'Real Agency',
    company_domain: 'realagency.com',
    source: 'google_sheet_import',
    status: 'active',
    verification_status: 'pending',
    custom_fields: {
      sheet_import: true,
      auto_approval_eligible: true,
      public_evidence_url: 'https://realagency.com/contact',
      reason_to_contact: 'Agency with public growth and demand generation signals.',
    },
  },
  {
    verifyEmail: async () => ({
      provider: 'hunter',
      verdict: 'valid',
      score: 0.88,
      catchAll: false,
      raw: null,
    }),
  }
)

assert.equal(providerValidatedSales.checked, true)
assert.equal(providerValidatedSales.contact.verification_status, 'valid')
assert.equal(
  scoreProspectForResearchApproval(providerValidatedSales.contact).approved,
  true
)
assert.equal(
  scoreProspectForResearchApproval(providerValidatedSales.contact).sourceStrength,
  'provider_validated'
)

process.env.SEND_ALLOW_UNKNOWN_VALIDATION = 'false'
process.env.DAILY_OUTBOUND_ALLOW_OWNED_VALIDATION = 'true'
process.env.DAILY_OUTBOUND_OWNED_VALIDATION_MIN_SCORE = '0.78'

const ownedValidatedSales = await enrichProspectWithProviderValidation(
  {
    id: 111,
    email: 'sales@ownedagency.com',
    email_domain: 'ownedagency.com',
    company: 'Owned Agency',
    company_domain: 'ownedagency.com',
    source: 'google_sheet_import',
    status: 'active',
    verification_status: 'pending',
    custom_fields: {
      sheet_import: true,
      auto_approval_eligible: true,
      public_evidence_url: 'https://ownedagency.com/contact',
      reason_to_contact: 'Agency with public growth and demand generation signals.',
      fit_score: 92,
    },
  },
  {
    verifyEmail: async () => ({
      provider: 'owned',
      verdict: 'unknown',
      score: 0.82,
      catchAll: false,
      raw: {
        mx: true,
        mx_provider: 'google_workspace',
        mailbox_role: 'commercial_role',
        owned_confidence: 0.82,
      },
    }),
  }
)

assert.equal(ownedValidatedSales.checked, true)
assert.equal(ownedValidatedSales.contact.custom_fields?.email_validation_provider, 'owned')
assert.equal(ownedValidatedSales.contact.custom_fields?.email_validation_mx, true)
assert.equal(
  scoreProspectForResearchApproval(ownedValidatedSales.contact).approved,
  true,
  'owned MX + commercial role validation should approve research without paid validators'
)
assert.equal(
  scoreProspectForResearchApproval(ownedValidatedSales.contact).verificationLabel,
  'likely'
)
assert.deepEqual(approvedContactQueueBlockers(ownedValidatedSales.contact), [])

const ownedWeakGeneric = await enrichProspectWithProviderValidation(
  {
    id: 112,
    email: 'hello@ownedagency.com',
    email_domain: 'ownedagency.com',
    company: 'Owned Agency',
    company_domain: 'ownedagency.com',
    source: 'google_sheet_import',
    status: 'active',
    verification_status: 'pending',
    custom_fields: {
      sheet_import: true,
      auto_approval_eligible: true,
      public_evidence_url: 'https://ownedagency.com/contact',
      reason_to_contact: 'Agency with public growth and demand generation signals.',
      fit_score: 92,
    },
  },
  {
    verifyEmail: async () => ({
      provider: 'owned',
      verdict: 'unknown',
      score: 0.72,
      catchAll: false,
      raw: {
        mx: true,
        mx_provider: 'google_workspace',
        mailbox_role: 'weak_generic',
        owned_confidence: 0.72,
      },
    }),
  }
)

assert.equal(
  scoreProspectForResearchApproval(ownedWeakGeneric.contact).approved,
  false,
  'weak generic owned validation still needs harder public evidence'
)
assert.ok(
  approvedContactQueueBlockers(ownedWeakGeneric.contact).includes(
    'weak_generic_inbox_requires_verification_or_public_proof'
  )
)

const validMapsLead = scoreProspectForResearchApproval({
  id: 104,
  email: 'sales@mappedagency.com',
  email_domain: 'mappedagency.com',
  company: 'Mapped Agency',
  company_domain: 'mappedagency.com',
  source: 'google_maps_apify',
  status: 'active',
  verification_status: 'valid',
  custom_fields: {
    maps_import: true,
    auto_approval_eligible: true,
    public_evidence_url: 'https://mappedagency.com/contact',
    reason_to_contact: 'Google Maps lead with public agency and outbound service signals.',
  },
})

assert.equal(validMapsLead.approved, true)
assert.ok(validMapsLead.reasons.includes('trusted_source'))

const providerInvalidGeneric = await enrichProspectWithProviderValidation(
  {
    id: 102,
    email: 'hello@badagency.com',
    email_domain: 'badagency.com',
    company: 'Bad Agency',
    company_domain: 'badagency.com',
    source: 'google_sheet_import',
    status: 'active',
    verification_status: 'pending',
    custom_fields: {
      sheet_import: true,
      auto_approval_eligible: true,
      public_evidence_url: 'https://badagency.com/contact',
      reason_to_contact: 'Agency with public growth and demand generation signals.',
    },
  },
  {
    verifyEmail: async () => ({
      provider: 'hunter',
      verdict: 'invalid',
      score: 0.04,
      catchAll: false,
      raw: null,
    }),
  }
)

assert.equal(providerInvalidGeneric.contact.verification_status, 'invalid')
assert.ok(
  approvedContactQueueBlockers(providerInvalidGeneric.contact).includes('verification_invalid')
)

const missingExactEvidenceResult = await enrichProspectWithPublicEmailEvidence(
  {
    id: 11,
    email: 'partnerships@realagency.com',
    email_domain: 'realagency.com',
    company: 'Real Agency',
    company_domain: 'realagency.com',
    source: 'google_sheet_import',
    status: 'active',
    verification_status: 'pending',
    custom_fields: {
      sheet_import: true,
      auto_approval_eligible: true,
      public_evidence_url: 'https://realagency.com/partners',
      reason_to_contact: 'Agency with public growth and demand generation signals.',
    },
  },
  {
    fetchPage: async () => ({
      ok: true,
      text: async () => 'Partner with Real Agency.',
    }),
  }
)

assert.equal(missingExactEvidenceResult.checked, true)
assert.equal(missingExactEvidenceResult.matched, false)
assert.equal(
  missingExactEvidenceResult.contact.custom_fields?.email_evidence,
  undefined
)
assert.ok(
  approvedContactQueueBlockers(missingExactEvidenceResult.contact).includes(
    'risky_role_requires_exact_public_email_evidence'
  )
)

assert.deepEqual(
  approvedContactQueueBlockers({
    id: 12,
    email: 'hello@realagency.com',
    email_domain: 'realagency.com',
    company: 'Real Agency',
    company_domain: 'realagency.com',
    source: 'google_sheet_import',
    status: 'active',
    verification_status: 'pending',
    custom_fields: {
      send_status: 'approved',
      email_evidence: 'public_domain_email',
      public_evidence_url: 'https://realagency.com/contact',
      fit_score: 95,
    },
  }),
  [],
  'public domain email evidence can pass after website + MX verification'
)

assert.deepEqual(
  approvedContactQueueBlockers({
    id: 13,
    email: 'hello@mapsagency.com',
    email_domain: 'mapsagency.com',
    company: 'Maps Agency',
    company_domain: 'mapsagency.com',
    source: 'google_maps_apify',
    status: 'active',
    verification_status: 'pending',
    custom_fields: {
      send_status: 'approved',
      email_evidence: 'maps_public_business_domain_match',
      public_evidence_url: 'https://mapsagency.com/contact',
      maps_import: true,
      fit_score: 95,
    },
  }),
  []
)

const artifactMailbox = scoreProspectForResearchApproval({
  id: 14,
  email: 'ho@cylex-locale.fr',
  email_domain: 'cylex-locale.fr',
  company: 'Cylex Locale',
  company_domain: 'cylex-locale.fr',
  source: 'public_search',
  status: 'active',
  verification_status: 'pending',
  custom_fields: {
    public_search: true,
    auto_approval_eligible: true,
    email_evidence: 'business_domain_role_pattern',
    fit_score: 95,
    public_evidence_url: 'https://cylex-locale.fr/',
  },
})

assert.equal(artifactMailbox.approved, false)
assert.equal(artifactMailbox.verdict, 'blocked')
assert.ok(artifactMailbox.blockers.includes('artifact_or_too_short_mailbox'))

const weakEnterpriseInbox = scoreProspectForResearchApproval({
  id: 15,
  email: 'hello@openai.com',
  email_domain: 'openai.com',
  company: 'OpenAI',
  company_domain: 'openai.com',
  source: 'public_search',
  status: 'active',
  verification_status: 'pending',
  custom_fields: {
    public_search: true,
    auto_approval_eligible: true,
    email_evidence: 'business_domain_role_pattern',
    fit_score: 95,
    public_evidence_url: 'https://openai.com/',
  },
})

assert.equal(weakEnterpriseInbox.approved, false)
assert.equal(weakEnterpriseInbox.verdict, 'blocked')
assert.ok(
  weakEnterpriseInbox.blockers.includes(
    'weak_generic_enterprise_inbox_requires_strong_evidence'
  )
)

const adultContentLead = scoreProspectForResearchApproval({
  id: 16,
  email: 'hello@pornobrasil.com',
  email_domain: 'pornobrasil.com',
  company: 'Porno Brasil',
  company_domain: 'pornobrasil.com',
  source: 'public_search',
  status: 'active',
  verification_status: 'valid',
  custom_fields: {
    public_search: true,
    auto_approval_eligible: true,
    email_evidence: 'public_domain_email',
    fit_score: 100,
    public_evidence_url: 'https://pornobrasil.com/',
    reason_to_contact: 'Public search result matched a consumer adult-content site.',
  },
})

assert.equal(adultContentLead.approved, false)
assert.equal(adultContentLead.verdict, 'blocked')
assert.ok(adultContentLead.blockers.includes('unsafe_or_adult_prospect'))
assert.ok(
  approvedContactQueueBlockers({
    id: 16,
    email: 'hello@pornobrasil.com',
    email_domain: 'pornobrasil.com',
    company: 'Porno Brasil',
    company_domain: 'pornobrasil.com',
    source: 'public_search',
    status: 'active',
    verification_status: 'valid',
    custom_fields: adultContentLead.evidenceUrl
      ? {
          send_status: 'approved',
          email_evidence: 'public_domain_email',
          public_evidence_url: adultContentLead.evidenceUrl,
        }
      : { send_status: 'approved' },
  }).includes('unsafe_or_adult_prospect')
)

const packageDocLead = scoreProspectForResearchApproval({
  id: 17,
  email: 'hello@pkg.go.dev',
  email_domain: 'pkg.go.dev',
  company: 'grule-rule-engine module',
  company_domain: 'pkg.go.dev',
  source: 'public_search',
  status: 'active',
  verification_status: 'valid',
  custom_fields: {
    public_search: true,
    auto_approval_eligible: true,
    email_evidence: 'public_domain_email',
    fit_score: 98,
    public_evidence_url: 'https://pkg.go.dev/github.com/hyperjumptech/grule-rule-engine',
    public_title: 'grule-rule-engine module - pkg.go.dev',
  },
})

assert.equal(packageDocLead.approved, false)
assert.ok(packageDocLead.blockers.includes('content_or_documentation_host'))
assert.ok(packageDocLead.blockers.includes('content_page_not_company'))

const articleTitleLead = scoreProspectForResearchApproval({
  id: 18,
  email: 'hello@tech.netcorecloud.com',
  email_domain: 'tech.netcorecloud.com',
  company: 'Mastering Decision-Making with Grule',
  company_domain: 'tech.netcorecloud.com',
  source: 'public_search',
  status: 'active',
  verification_status: 'valid',
  custom_fields: {
    public_search: true,
    auto_approval_eligible: true,
    email_evidence: 'public_domain_email',
    fit_score: 99,
    public_evidence_url: 'https://tech.netcorecloud.com/mastering-decision-making-with-grule/',
    public_title: 'Mastering Decision-Making with Grule',
  },
})

assert.equal(articleTitleLead.approved, false)
assert.ok(articleTitleLead.blockers.includes('content_page_not_company'))

const publicDirectoryWithStrongEvidence = approvedContactQueueBlockers({
  id: 19,
  email: 'hello@rew.ca',
  email_domain: 'rew.ca',
  company: 'REW Real Estate',
  company_domain: 'rew.ca',
  source: 'public_search',
  status: 'active',
  verification_status: 'valid',
  custom_fields: {
    send_status: 'approved',
    email_evidence: 'public_domain_email',
    public_evidence_url: 'https://rew.ca/',
    reason_to_contact: 'Real estate portal discovered from public search.',
  },
})

assert.ok(publicDirectoryWithStrongEvidence.includes('low_intent_public_directory_domain'))
assert.ok(publicDirectoryWithStrongEvidence.includes('content_page_not_company'))

const leaderboardArticleLead = scoreProspectForResearchApproval({
  id: 20,
  email: 'anita@vellum.ai',
  email_domain: 'vellum.ai',
  company: 'LLM Leaderboard 2026 - Compare Top AI Models',
  company_domain: 'vellum.ai',
  source: 'public_search',
  status: 'active',
  verification_status: 'valid',
  custom_fields: {
    public_search: true,
    auto_approval_eligible: true,
    email_evidence: 'public_domain_email',
    fit_score: 96,
    public_evidence_url: 'https://www.vellum.ai/llm-leaderboard',
    public_title: 'LLM Leaderboard 2026 - Compare Top AI Models',
  },
})

assert.equal(leaderboardArticleLead.approved, false)
assert.ok(leaderboardArticleLead.blockers.includes('content_page_not_company'))

const testMailboxLead = scoreProspectForResearchApproval({
  id: 21,
  email: 'testsecurity@lsac.org',
  email_domain: 'lsac.org',
  company: 'LLM Degree',
  company_domain: 'lsac.org',
  source: 'public_search',
  status: 'active',
  verification_status: 'valid',
  custom_fields: {
    public_search: true,
    auto_approval_eligible: true,
    email_evidence: 'public_domain_email',
    fit_score: 99,
    public_evidence_url: 'https://www.lsac.org/llm-degree',
    public_title: 'LLM Degree',
  },
})

assert.equal(testMailboxLead.approved, false)
assert.ok(testMailboxLead.blockers.includes('blocked_mailbox_prefix'))
assert.ok(testMailboxLead.blockers.includes('artifact_or_too_short_mailbox'))
assert.ok(testMailboxLead.blockers.includes('content_or_documentation_host'))
assert.ok(testMailboxLead.blockers.includes('content_page_not_company'))

const nintendoGameLead = scoreProspectForResearchApproval({
  id: 22,
  email: 'hello@nintendo.com',
  email_domain: 'nintendo.com',
  company: 'Outbound for Nintendo Switch',
  company_domain: 'nintendo.com',
  source: 'public_search',
  status: 'active',
  verification_status: 'valid',
  custom_fields: {
    public_search: true,
    auto_approval_eligible: true,
    email_evidence: 'public_domain_email',
    fit_score: 99,
    public_evidence_url: 'https://nintendo.com/',
    reason_to_contact: 'Buy Outbound and shop other great Nintendo products online at the official Nintendo Store.',
  },
})

assert.equal(nintendoGameLead.approved, false)
assert.ok(nintendoGameLead.blockers.includes('content_or_documentation_host'))
assert.ok(nintendoGameLead.blockers.includes('content_page_not_company'))

const fandomGameLead = scoreProspectForResearchApproval({
  id: 23,
  email: 'hello@outbound.fandom.com',
  email_domain: 'outbound.fandom.com',
  company: 'Outbound Wiki',
  company_domain: 'outbound.fandom.com',
  source: 'public_search',
  status: 'active',
  verification_status: 'valid',
  custom_fields: {
    public_search: true,
    auto_approval_eligible: true,
    email_evidence: 'public_domain_email',
    fit_score: 99,
    public_evidence_url: 'https://outbound.fandom.com/',
    reason_to_contact: 'Template:Infobox Outbound is a cozy open-world survival and crafting game.',
  },
})

assert.equal(fandomGameLead.approved, false)
assert.ok(fandomGameLead.blockers.includes('content_or_documentation_host'))
assert.ok(fandomGameLead.blockers.includes('content_page_not_company'))

const questAppointmentLead = scoreProspectForResearchApproval({
  id: 24,
  email: 'hello@appointment.questdiagnostics.com',
  email_domain: 'appointment.questdiagnostics.com',
  company: 'Schedule Appointment',
  company_domain: 'appointment.questdiagnostics.com',
  source: 'public_search',
  status: 'active',
  verification_status: 'valid',
  custom_fields: {
    public_search: true,
    auto_approval_eligible: true,
    email_evidence: 'public_domain_email',
    fit_score: 99,
    public_evidence_url: 'https://appointment.questdiagnostics.com/',
    reason_to_contact: 'Schedule your Quest Diagnostics appointment online for lab services.',
  },
})

assert.equal(questAppointmentLead.approved, false)
assert.ok(questAppointmentLead.blockers.includes('content_or_documentation_host'))
assert.ok(questAppointmentLead.blockers.includes('content_page_not_company'))

console.log('prospect research tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
