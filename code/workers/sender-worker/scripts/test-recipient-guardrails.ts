import assert from 'node:assert/strict'
import { recipientApprovalBlockers } from '../recipient-guardrails'

process.env.SEND_ALLOW_UNKNOWN_VALIDATION = 'false'
process.env.DAILY_OUTBOUND_ALLOW_OWNED_VALIDATION = 'true'
process.env.DAILY_OUTBOUND_OWNED_VALIDATION_MIN_SCORE = '0.78'

function blockersFor(overrides: Record<string, unknown>, jobRecipientEmail?: string) {
  return recipientApprovalBlockers({
    email: 'partnerships@fullcast.io',
    status: 'active',
    verification_status: 'pending',
    custom_fields: {
      auto_approval_eligible: true,
      email_evidence: 'operator_sheet_evidence',
      public_evidence_url: 'https://fullcast.io/about',
      reason_to_contact: 'Relevant outbound infrastructure account.',
    },
    ...overrides,
  }, jobRecipientEmail)
}

assert.deepEqual(
  blockersFor({}),
  ['risky_role_requires_exact_public_email_evidence'],
  'guessed partnerships inboxes must not reach the sender worker'
)

assert.deepEqual(
  blockersFor({
    custom_fields: {
      auto_approval_eligible: true,
      email_evidence: 'public_page_email_match',
      public_evidence_url: 'https://fullcast.io/partners',
      reason_to_contact: 'Relevant outbound infrastructure account.',
    },
  }),
  [],
  'exact public page evidence can pass the worker guard'
)

assert.deepEqual(
  blockersFor({
    email: 'hello@apptivo.com',
    custom_fields: {
      auto_approval_eligible: true,
      email_evidence: 'operator_sheet_evidence',
      public_evidence_url: 'https://apptivo.com/about',
      reason_to_contact: 'Relevant outbound infrastructure account.',
    },
  }),
  ['generic_inbox_requires_email_validation_or_exact_evidence'],
  'generic inboxes need validation or exact public evidence before send'
)

assert.deepEqual(
  blockersFor({
    email: 'hello@apptivo.com',
    custom_fields: {
      auto_approval_eligible: true,
      public_search: true,
      email_evidence: 'business_domain_role_pattern',
      fit_score: 84,
      public_evidence_url: 'https://apptivo.com/',
      reason_to_contact: 'Relevant outbound infrastructure account.',
    },
  }),
  [],
  'high-fit public-search business role inboxes can pass without exact email text'
)

assert.deepEqual(
  blockersFor({
    email: 'hello@apptivo.com',
    verification_status: 'valid',
  }),
  [],
  'validated generic inboxes can pass the worker guard'
)

assert.deepEqual(
  blockersFor({
    email: 'hello@apptivo.com',
    custom_fields: {
      auto_approval_eligible: true,
      email_evidence: 'public_domain_email',
      public_evidence_url: 'https://apptivo.com/contact',
      reason_to_contact: 'Relevant outbound infrastructure account.',
    },
  }),
  [],
  'MX-backed public domain inbox evidence can pass the worker guard'
)

assert.deepEqual(
  blockersFor({
    email: 'marketing@apptivo.com',
    custom_fields: {
      auto_approval_eligible: true,
      email_evidence: 'business_domain_role_pattern',
      email_validation_provider: 'owned',
      email_validation_verdict: 'unknown',
      email_validation_score: 0.82,
      email_validation_mx: true,
      email_validation_mailbox_role: 'commercial_role',
      email_validation_mx_provider: 'google_workspace',
      public_evidence_url: 'https://apptivo.com/about',
      reason_to_contact: 'Relevant outbound infrastructure account.',
    },
  }),
  [],
  'owned MX + commercial role validation can pass without paid verifier rows'
)

assert.deepEqual(
  blockersFor({
    email: 'partnerships@fullcast.io',
    custom_fields: {
      auto_approval_eligible: true,
      email_evidence: 'business_domain_role_pattern',
      email_validation_provider: 'owned',
      email_validation_verdict: 'unknown',
      email_validation_score: 0.8,
      email_validation_mx: true,
      email_validation_mailbox_role: 'safe_role',
      email_validation_mx_provider: 'microsoft_365',
      public_evidence_url: 'https://fullcast.io/partners',
      reason_to_contact: 'Relevant outbound infrastructure account.',
    },
  }),
  [],
  'owned validation can clear safe partnership role inboxes without exact public text'
)

assert.deepEqual(
  blockersFor({
    email: 'hello@apptivo.com',
    custom_fields: {
      auto_approval_eligible: true,
      email_evidence: 'business_domain_role_pattern',
      email_validation_provider: 'owned',
      email_validation_verdict: 'unknown',
      email_validation_score: 0.72,
      email_validation_mx: true,
      email_validation_mailbox_role: 'weak_generic',
      email_validation_mx_provider: 'google_workspace',
      public_evidence_url: 'https://apptivo.com/about',
      reason_to_contact: 'Relevant outbound infrastructure account.',
    },
  }),
  ['generic_inbox_requires_email_validation_or_exact_evidence'],
  'weak generic owned validation still needs exact evidence or stronger business fallback'
)

assert.deepEqual(
  blockersFor({
    email: 'partnerships@fullcast.io',
    custom_fields: {
      auto_approval_eligible: true,
      email_evidence: 'public_page_email_match',
      public_evidence_url: 'https://fullcast.io/partners',
      reason_to_contact: 'Relevant outbound infrastructure account.',
    },
  }, 'different@fullcast.io'),
  ['recipient_contact_mismatch'],
  'job recipient must match the approved contact record'
)

console.log('recipient guardrail tests passed')
