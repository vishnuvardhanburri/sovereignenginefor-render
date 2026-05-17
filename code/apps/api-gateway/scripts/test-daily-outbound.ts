import assert from 'node:assert/strict'
import {
  buildDailyOutboundPlan,
  resolveDailyBoolean,
  resolveDailySheetUrl,
} from '../lib/daily-outbound'

const healthyWindow = {
  limit: 20,
  activeDomains: 2,
  remainingCapacity: 100,
  averageHealthScore: 96,
  policy: 'domain_capacity_health_window' as const,
}

const lowHealthWindow = {
  ...healthyWindow,
  limit: 5,
  remainingCapacity: 50,
  averageHealthScore: 50,
}

assert.equal(resolveDailyBoolean(undefined, true), true)
assert.equal(resolveDailyBoolean('false', true), false)
assert.equal(resolveDailyBoolean('0', true), false)
assert.equal(resolveDailyBoolean('yes', false), true)

assert.equal(
  resolveDailySheetUrl({
    querySheetUrl: '',
    env: { DAILY_OUTBOUND_SHEET_URL: 'https://docs.google.com/sheet-a' },
  }),
  'https://docs.google.com/sheet-a'
)

assert.equal(
  resolveDailySheetUrl({
    querySheetUrl: 'https://docs.google.com/query-sheet',
    env: { DAILY_OUTBOUND_SHEET_URL: 'https://docs.google.com/sheet-a' },
  }),
  'https://docs.google.com/query-sheet'
)

const noSheetPlan = buildDailyOutboundPlan({
  approvalWindow: healthyWindow,
  env: {},
  query: {},
})

assert.equal(noSheetPlan.enabled, true)
assert.equal(noSheetPlan.runSheetImport, false)
assert.equal(noSheetPlan.runResearchApproval, true)
assert.equal(noSheetPlan.runQueue, true)
assert.equal(noSheetPlan.sendLimit, 1)
assert.equal(noSheetPlan.approveLimit, 20)

const highRequestedPlan = buildDailyOutboundPlan({
  approvalWindow: healthyWindow,
  env: {
    DAILY_OUTBOUND_SEND_LIMIT: '50',
    DAILY_OUTBOUND_APPROVE_LIMIT: '500',
    DAILY_OUTBOUND_SHEET_LIMIT: '9999',
  },
  query: {
    sheetUrl: 'https://docs.google.com/sheets/high',
  },
})

assert.equal(highRequestedPlan.runSheetImport, true)
assert.equal(highRequestedPlan.sendLimit, 5)
assert.equal(highRequestedPlan.approveLimit, 20)
assert.equal(highRequestedPlan.sheetLimit, 500)

const lowHealthPlan = buildDailyOutboundPlan({
  approvalWindow: lowHealthWindow,
  env: {
    DAILY_OUTBOUND_SEND_LIMIT: '5',
  },
  query: {},
})

assert.equal(lowHealthPlan.sendLimit, 1)
assert.ok(lowHealthPlan.guardrails.includes('Low reputation health caps daily queueing at 1 send'))

const dryRunPlan = buildDailyOutboundPlan({
  approvalWindow: healthyWindow,
  env: {
    DAILY_OUTBOUND_SHEET_URL: 'https://docs.google.com/sheets/dry',
  },
  query: {
    dryRun: '1',
  },
})

assert.equal(dryRunPlan.dryRun, true)
assert.equal(dryRunPlan.runSheetImport, true)
assert.equal(dryRunPlan.runResearchApproval, true)
assert.equal(dryRunPlan.runQueue, false)

const disabledPlan = buildDailyOutboundPlan({
  approvalWindow: healthyWindow,
  env: {
    DAILY_OUTBOUND_ENABLED: 'off',
  },
  query: {},
})

assert.equal(disabledPlan.enabled, false)
assert.equal(disabledPlan.runSheetImport, false)
assert.equal(disabledPlan.runResearchApproval, false)
assert.equal(disabledPlan.runQueue, false)

console.log('daily outbound tests passed')
