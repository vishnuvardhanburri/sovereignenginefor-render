export type ReplyClassification =
  | 'interested'
  | 'meeting_intent'
  | 'partnership_intent'
  | 'licensing_interest'
  | 'objection'
  | 'not_interested'
  | 'bounce'
  | 'auto_reply'
  | 'neutral'
  | 'unknown'

export interface DeterministicReplyAnalysis {
  classification: ReplyClassification
  sentiment: 'positive' | 'neutral' | 'negative'
  opportunityScore: number
  recommendedAction: string
  evidence: string[]
}

const POSITIVE = ['interested', 'send', 'share', 'demo', 'call', 'meeting', 'available', 'book', 'pricing', 'proposal']
const NEGATIVE = ['unsubscribe', 'remove me', 'not interested', 'no thanks', 'stop emailing', 'never contact']
const BOUNCE = ['undelivered', 'delivery status notification', 'mail delivery failed', 'recipient address rejected', 'does not exist']
const AUTO_REPLY = ['out of office', 'automatic reply', 'auto-reply', 'vacation', 'away from office']
const PARTNERSHIP = ['partner', 'partnership', 'reseller', 'white label', 'white-label', 'agency']
const LICENSING = [
  'license',
  'licensing',
  'commercial rights',
  'deployment rights',
  '£500',
  '£1,500',
  '£40',
  '£160',
  '500',
  '1500',
  '40k',
  '160k',
  'campaign rescue',
  'control partner',
  'pricing',
]

function includesAny(text: string, terms: string[]): string[] {
  return terms.filter((term) => text.includes(term))
}

export function classifyReplyDeterministically(input: {
  subject?: string | null
  body?: string | null
}): DeterministicReplyAnalysis {
  const text = `${input.subject ?? ''}\n${input.body ?? ''}`.toLowerCase()
  const bounce = includesAny(text, BOUNCE)
  if (bounce.length) {
    return {
      classification: 'bounce',
      sentiment: 'negative',
      opportunityScore: 0,
      recommendedAction: 'suppress_contact_and_update_delivery_evidence',
      evidence: bounce,
    }
  }

  const negative = includesAny(text, NEGATIVE)
  if (negative.length) {
    return {
      classification: 'not_interested',
      sentiment: 'negative',
      opportunityScore: 0,
      recommendedAction: 'stop_sequence_and_respect_suppression',
      evidence: negative,
    }
  }

  const autoReply = includesAny(text, AUTO_REPLY)
  if (autoReply.length) {
    return {
      classification: 'auto_reply',
      sentiment: 'neutral',
      opportunityScore: 10,
      recommendedAction: 'pause_until_return_date_if_detected',
      evidence: autoReply,
    }
  }

  const licensing = includesAny(text, LICENSING)
  if (licensing.length) {
    return {
      classification: 'licensing_interest',
      sentiment: 'positive',
      opportunityScore: 92,
      recommendedAction: 'route_to_founder_book_call_and_collect_license_scope_details',
      evidence: licensing,
    }
  }

  const partnership = includesAny(text, PARTNERSHIP)
  if (partnership.length) {
    return {
      classification: 'partnership_intent',
      sentiment: 'positive',
      opportunityScore: 84,
      recommendedAction: 'route_to_founder_book_call_and_collect_white_label_details',
      evidence: partnership,
    }
  }

  const positive = includesAny(text, POSITIVE)
  if (positive.length) {
    return {
      classification: positive.includes('meeting') || positive.includes('call') || positive.includes('book') ? 'meeting_intent' : 'interested',
      sentiment: 'positive',
      opportunityScore: 72,
      recommendedAction: 'reply_with_booking_link_and_collect_pre_call_details',
      evidence: positive,
    }
  }

  if (text.trim().length > 0) {
    return {
      classification: 'neutral',
      sentiment: 'neutral',
      opportunityScore: 28,
      recommendedAction: 'review_manually',
      evidence: [],
    }
  }

  return {
    classification: 'unknown',
    sentiment: 'neutral',
    opportunityScore: 0,
    recommendedAction: 'review_manually',
    evidence: [],
  }
}
