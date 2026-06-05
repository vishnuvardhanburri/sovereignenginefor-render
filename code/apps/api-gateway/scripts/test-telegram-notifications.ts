import assert from 'node:assert/strict'
import {
  formatTelegramNotification,
  maskEmail,
  shouldNotifyTelegram,
} from '../lib/telegram-notifications'

assert.equal(maskEmail('sales@verified-agency.com'), 's***s@verified-agency.com')
assert.equal(maskEmail('ab@company.com'), 'a*@company.com')
assert.equal(maskEmail('bad-value'), 'bad-value')

assert.equal(shouldNotifyTelegram('email_sent', { TELEGRAM_NOTIFY_SENT: 'true' }), true)
assert.equal(shouldNotifyTelegram('email_sent', { TELEGRAM_NOTIFY_SENT_EVENTS: 'true' }), true)
assert.equal(shouldNotifyTelegram('email_failed', { TELEGRAM_NOTIFY_FAILED: '0' }), false)
assert.equal(shouldNotifyTelegram('sheet_import', { TELEGRAM_NOTIFY_IMPORTS: 'yes' }), true)
assert.equal(shouldNotifyTelegram('sheet_import', { TELEGRAM_NOTIFY_IMPORT_EVENTS: 'yes' }), true)
assert.equal(
  shouldNotifyTelegram('sheet_import', {
    TELEGRAM_OPERATOR_REPORT_ONLY: 'false',
    TELEGRAM_NOTIFY_IMPORT_EVENTS: 'yes',
  }),
  true
)
assert.equal(shouldNotifyTelegram('lead_scout', { TELEGRAM_NOTIFY_STAGE_EVENTS: 'yes' }), false)
assert.equal(
  shouldNotifyTelegram('lead_scout', {
    TELEGRAM_DEBUG_STAGE_NOTIFICATIONS: 'yes',
    TELEGRAM_NOTIFY_STAGE_EVENTS: 'yes',
  }),
  true
)
assert.equal(shouldNotifyTelegram('contacts_approved', { TELEGRAM_NOTIFY_APPROVALS: 'yes' }), true)
assert.equal(shouldNotifyTelegram('queue_batch', { TELEGRAM_NOTIFY_QUEUE: 'yes' }), true)
assert.equal(shouldNotifyTelegram('daily_outbound', { TELEGRAM_NOTIFY_QUEUE: 'yes' }), true)

const sent = formatTelegramNotification({
  type: 'email_sent',
  to: 'sales@verified-agency.com',
  from: 'hello@vishnulabs.com',
  subject: 'quick question',
  providerMessageId: 'msg_123',
})

assert.match(sent, /Email Sent/)
assert.match(sent, /s\*\*\*s@verified-agency\.com/)
assert.doesNotMatch(sent, /sales@verified-agency\.com/)

const importMessage = formatTelegramNotification({
  type: 'sheet_import',
  imported: 12,
  prepared: 18,
  rejected: 4,
  evidenceBacked: 9,
  sheetUrl: 'https://docs.google.com/spreadsheets/d/demo/edit',
})

assert.match(importMessage, /Google Sheet Import/i)
assert.match(importMessage.replace(/\n/g, ' '), /Imported Leads:.*12/)
assert.match(importMessage.replace(/\n/g, ' '), /Evidence-Backed:.*9/)

const mapsMessage = formatTelegramNotification({
  type: 'maps_import',
  imported: 7,
  prepared: 12,
  rejected: 5,
  evidenceBacked: 7,
  datasetId: 'dataset_123',
  source: 'apify_google_maps',
})

assert.match(mapsMessage, /Google Maps Lead Intake/i)
assert.match(mapsMessage.replace(/\n/g, ' '), /Imported:.*7/)
assert.match(mapsMessage, /Dataset: dataset_123/)

const mapsRejectedMessage = formatTelegramNotification({
  type: 'maps_import',
  imported: 0,
  prepared: 0,
  rejected: 16,
  evidenceBacked: 0,
  source: 'apify_google_maps',
  rejectionReasons: {
    missing_email: 10,
    irrelevant_maps_category: 4,
    duplicate_domain: 2,
  },
})

assert.match(mapsRejectedMessage, /Top rejected: missing_email: 10/)

const dailyMessage = formatTelegramNotification({
  type: 'daily_outbound',
  imported: 100,
  approved: 12,
  queued: 5,
  estimatedPipelineValueUsd: 680000,
  agencyQueued: 4,
  directQueued: 1,
  sendLimit: 5,
  approveLimit: 25,
  failures: 0,
})

assert.match(dailyMessage, /Pipeline value: £680,000/)
assert.match(dailyMessage, /Mix: 4 agency \(£160,000\) \/ 1 direct \(£40,000\)/)

const digestMessage = formatTelegramNotification({
  type: 'daily_outbound',
  sentToday: 130,
  sent24h: 130,
  failed24h: 0,
  bounced24h: 0,
  replies24h: 1,
  replyRate24h: 0.8,
  approvedReadyNow: 42,
  approvedAgencyReadyNow: 21,
  approvedDirectReadyNow: 21,
  queuePending: 5,
  queueProcessing: 1,
  queueRetry: 0,
  queueFailed: 0,
  queueCompleted24h: 125,
  agencySent24h: 65,
  directSent24h: 65,
  remainingToOperatingFloor: 0,
  queuedNow: 0,
  queued: 0,
})

assert.match(digestMessage, /Co-Founder Operator Report/)
assert.match(digestMessage, /Client conversations: 1 replies \/ 130 sent = 0\.8%/)
assert.match(digestMessage, /Queue: 5 pending \/ 1 active \/ 0 retry \/ 0 failed \/ 125 completed 24h/)
assert.match(digestMessage, /Offer mix 24h: 65 white-label £160,000 \/ 65 internal £40,000/)
assert.match(digestMessage, /Ready inventory: 21 agency \/ 21 direct/)

console.log('telegram notification tests passed')
