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

const noHealthySenderWindow = {
  ...healthyWindow,
  limit: 5,
  remainingCapacity: 91,
  averageHealthScore: 50,
  eligibleSenderIdentities: 0,
  senderRemainingCapacity: 0,
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
assert.equal(noSheetPlan.runLeadScout, false)
assert.equal(noSheetPlan.runResearchApproval, true)
assert.equal(noSheetPlan.runQueue, true)
assert.equal(noSheetPlan.sendLimit, 1)
assert.equal(noSheetPlan.approveLimit, 20)
assert.ok(
  noSheetPlan.guardrails.includes(
    'If Google Sheet intake fails, the system falls back to existing approved contacts'
  )
)

const autonomousScoutPlan = buildDailyOutboundPlan({
  approvalWindow: healthyWindow,
  env: {
    LEAD_SCOUT_ENABLED: 'true',
    LEAD_SCOUT_DAILY_LIMIT: '25',
  },
  query: {},
})

assert.equal(autonomousScoutPlan.runLeadScout, true)
assert.equal(autonomousScoutPlan.leadScoutLimit, 10)
assert.ok(
  autonomousScoutPlan.guardrails.includes(
    'Autonomous lead scout imports only exact public-contact evidence when enabled'
  )
)

const disabledAutonomousScoutPlan = buildDailyOutboundPlan({
  approvalWindow: healthyWindow,
  env: {
    LEAD_SCOUT_ENABLED: 'true',
  },
  query: {
    leadScout: 'false',
  },
})

assert.equal(disabledAutonomousScoutPlan.runLeadScout, false)

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

const growthHealthyPlan = buildDailyOutboundPlan({
  approvalWindow: healthyWindow,
  env: {
    DAILY_OUTBOUND_MODE: 'growth',
    DAILY_OUTBOUND_SEND_LIMIT: '50',
    DAILY_OUTBOUND_APPROVE_LIMIT: '50',
  },
  query: {},
})

assert.equal(growthHealthyPlan.mode, 'growth')
assert.equal(growthHealthyPlan.sendLimit, 50)
assert.equal(growthHealthyPlan.approveLimit, 20)
assert.ok(
  growthHealthyPlan.guardrails.includes(
    'Growth mode is enabled; volume still follows reputation health, validation, and domain capacity'
  )
)

const growthQueryPlan = buildDailyOutboundPlan({
  approvalWindow: healthyWindow,
  env: {
    DAILY_OUTBOUND_SEND_LIMIT: '5',
  },
  query: {
    mode: 'growth',
    sendLimit: '50',
  },
})

assert.equal(growthQueryPlan.mode, 'growth')
assert.equal(growthQueryPlan.sendLimit, 50)

const growthLowHealthPlan = buildDailyOutboundPlan({
  approvalWindow: lowHealthWindow,
  env: {
    DAILY_OUTBOUND_MODE: 'growth',
    DAILY_OUTBOUND_SEND_LIMIT: '50',
  },
  query: {},
})

assert.equal(growthLowHealthPlan.mode, 'growth')
assert.equal(growthLowHealthPlan.sendLimit, 5)
assert.ok(
  growthLowHealthPlan.guardrails.includes(
    'Growth mode low reputation health caps daily queueing at 5 sends'
  )
)

const noHealthySenderPlan = buildDailyOutboundPlan({
  approvalWindow: noHealthySenderWindow,
  env: {
    DAILY_OUTBOUND_MODE: 'growth',
    DAILY_OUTBOUND_SEND_LIMIT: '50',
  },
  query: {},
})

assert.equal(noHealthySenderPlan.sendLimit, 0)
assert.equal(noHealthySenderPlan.runQueue, false)
assert.ok(
  noHealthySenderPlan.guardrails.includes(
    'No healthy sender identity is available; queueing is blocked until domain health recovers'
  )
)

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
