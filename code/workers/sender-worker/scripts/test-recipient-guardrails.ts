import assert from 'node:assert/strict'
import { recipientApprovalBlockers } from '../recipient-guardrails'

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
    verification_status: 'valid',
  }),
  [],
  'validated generic inboxes can pass the worker guard'
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
