import assert from 'node:assert/strict'
import { scoreProspectForResearchApproval } from '../lib/prospect-research'

const safe = scoreProspectForResearchApproval({
  id: 1,
  email: 'opportunity@ignitevisibility.com',
  email_domain: 'ignitevisibility.com',
  company: 'Ignite Visibility',
  company_domain: 'ignitevisibility.com',
  source: 'google_sheet_import',
  status: 'active',
  verification_status: 'pending',
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

console.log('prospect research tests passed')
