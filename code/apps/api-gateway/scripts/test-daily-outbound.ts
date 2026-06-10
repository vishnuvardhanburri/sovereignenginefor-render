import assert from 'node:assert/strict'
import {
  applyDailyVolumeBand,
  buildDailyOutboundPlan,
  resolveDailyBoolean,
  resolveDailyVolumeBand,
  resolveDailySheetUrl,
} from '../lib/daily-outbound'
import { computeSystemApprovalLimit } from '../lib/contact-approval-window'

const healthyWindow = {
  limit: 20,
  activeDomains: 2,
  remainingCapacity: 100,
  averageHealthScore: 96,
  policy: 'domain_capacity_health_window' as const,
}

const highCapacityWindow = {
  ...healthyWindow,
  limit: 1_000_000,
  remainingCapacity: 1_000,
  eligibleSenderIdentities: 4,
  senderRemainingCapacity: 1_000,
}

const lowHealthWindow = {
  ...healthyWindow,
  limit: 100_000,
  remainingCapacity: 50,
  averageHealthScore: 50,
}

const noHealthySenderWindow = {
  ...healthyWindow,
  limit: 100_000,
  remainingCapacity: 91,
  averageHealthScore: 50,
  eligibleSenderIdentities: 0,
  senderRemainingCapacity: 0,
}

const severeRecoveryWindow = {
  ...healthyWindow,
  limit: 1_000,
  remainingCapacity: 0,
  averageHealthScore: 24,
  eligibleSenderIdentities: 0,
  senderRemainingCapacity: 0,
}

assert.equal(resolveDailyBoolean(undefined, true), true)
assert.equal(resolveDailyBoolean('false', true), false)
assert.equal(resolveDailyBoolean('0', true), false)
assert.equal(resolveDailyBoolean('yes', false), true)

assert.equal(
  computeSystemApprovalLimit({
    activeDomains: 2,
    remainingCapacity: 91,
    senderRemainingCapacity: 91,
    averageHealthScore: 50,
  }),
  1_000_000
)

assert.equal(
  computeSystemApprovalLimit({
    activeDomains: 2,
    remainingCapacity: 1_000,
    senderRemainingCapacity: 1_000,
    averageHealthScore: 96,
  }),
  1_000_000
)

assert.equal(
  computeSystemApprovalLimit({
    activeDomains: 0,
    remainingCapacity: 0,
    senderRemainingCapacity: 0,
    averageHealthScore: 100,
  }),
  1_000
)

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
assert.equal(noSheetPlan.runPublicSearch, true)
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
assert.equal(autonomousScoutPlan.leadScoutLimit, 25)
assert.ok(
  autonomousScoutPlan.guardrails.includes(
    'Autonomous lead scout crawls public company pages and imports only proof-backed contacts'
  )
)

const publicSearchPlan = buildDailyOutboundPlan({
  approvalWindow: healthyWindow,
  env: {
    SERPAPI_API_KEY: 'configured',
    PUBLIC_SEARCH_DAILY_LIMIT: '900',
  },
  query: {},
})

assert.equal(publicSearchPlan.runPublicSearch, true)
assert.equal(publicSearchPlan.publicSearchLimit, 900)
assert.ok(
  publicSearchPlan.guardrails.includes(
    'Public search expands discovery through query/domain extraction, then evidence checks decide approval'
  )
)

const publicSearchWithoutApiKeyPlan = buildDailyOutboundPlan({
  approvalWindow: healthyWindow,
  env: {},
  query: {
    publicSearchLimit: '125',
  },
})

assert.equal(publicSearchWithoutApiKeyPlan.runPublicSearch, true)
assert.equal(publicSearchWithoutApiKeyPlan.publicSearchLimit, 125)

const disabledPublicSearchPlan = buildDailyOutboundPlan({
  approvalWindow: healthyWindow,
  env: {
    SERPAPI_API_KEY: 'configured',
  },
  query: {
    publicSearch: 'false',
  },
})

assert.equal(disabledPublicSearchPlan.runPublicSearch, false)

const mapsPlan = buildDailyOutboundPlan({
  approvalWindow: healthyWindow,
  env: {
    GOOGLE_MAPS_SOURCE_ENABLED: 'true',
    APIFY_GOOGLE_MAPS_DATASET_ID: 'dataset-123',
    GOOGLE_MAPS_DAILY_LIMIT: '250',
  },
  query: {},
})

assert.equal(mapsPlan.runMapsImport, true)
assert.equal(mapsPlan.mapsDatasetId, 'dataset-123')
assert.equal(mapsPlan.mapsLimit, 250)
assert.ok(
  mapsPlan.guardrails.includes(
    'Google Maps/Apify intake imports public business leads only after evidence filtering'
  )
)

const tokenOnlyMapsPlan = buildDailyOutboundPlan({
  approvalWindow: healthyWindow,
  env: {
    GOOGLE_MAPS_SOURCE_ENABLED: 'true',
    APIFY_API_TOKEN: 'token-only',
  },
  query: {},
})

assert.equal(tokenOnlyMapsPlan.runMapsImport, true)
assert.equal(tokenOnlyMapsPlan.mapsDatasetId, '')

const taskOnlyMapsPlan = buildDailyOutboundPlan({
  approvalWindow: healthyWindow,
  env: {
    GOOGLE_MAPS_SOURCE_ENABLED: 'true',
    APIFY_API_TOKEN: 'token-only',
    APIFY_GOOGLE_MAPS_TASK_ID: 'saved-google-maps-task',
  },
  query: {},
})

assert.equal(taskOnlyMapsPlan.runMapsImport, true)
assert.equal(taskOnlyMapsPlan.mapsDatasetId, '')

const actorOnlyMapsPlan = buildDailyOutboundPlan({
  approvalWindow: healthyWindow,
  env: {
    GOOGLE_MAPS_SOURCE_ENABLED: 'true',
    APIFY_API_TOKEN: 'token-only',
    APIFY_GOOGLE_MAPS_ACTOR_ID: 'compass/crawler-google-places',
  },
  query: {},
})

assert.equal(actorOnlyMapsPlan.runMapsImport, true)
assert.equal(actorOnlyMapsPlan.mapsDatasetId, '')

const disabledMapsPlan = buildDailyOutboundPlan({
  approvalWindow: healthyWindow,
  env: {
    GOOGLE_MAPS_SOURCE_ENABLED: 'true',
    APIFY_GOOGLE_MAPS_DATASET_ID: 'dataset-123',
  },
  query: {
    mapsImport: 'false',
  },
})

assert.equal(disabledMapsPlan.runMapsImport, false)

const zeroMapsLimitPlan = buildDailyOutboundPlan({
  approvalWindow: healthyWindow,
  env: {
    DAILY_OUTBOUND_RUN_MAPS: 'true',
    APIFY_API_TOKEN: 'token-only',
  },
  query: {
    mapsLimit: '0',
  },
})

assert.equal(zeroMapsLimitPlan.mapsLimit, 0)
assert.equal(zeroMapsLimitPlan.runMapsImport, false)

const researchInventoryPlan = buildDailyOutboundPlan({
  approvalWindow: highCapacityWindow,
  env: {
    WEB_MEMORY_PROFILE: 'free',
    WEB_FREE_TIER_SAFE_MODE: 'true',
    DAILY_OUTBOUND_RESEARCH_UNLIMITED: 'true',
    DAILY_OUTBOUND_READY_INVENTORY_TARGET: '1600',
    DAILY_OUTBOUND_RESEARCH_LIMIT: '120',
    DAILY_OUTBOUND_RESEARCH_APPROVE_LIMIT: '1600',
    DAILY_OUTBOUND_APPROVE_LIMIT: '25',
    DAILY_OUTBOUND_SMALL_MAX_LEAD_SCOUT_LIMIT: '120',
    DAILY_OUTBOUND_SMALL_MAX_PUBLIC_SEARCH_LIMIT: '120',
    DAILY_OUTBOUND_SMALL_MAX_MAPS_LIMIT: '10',
    LEAD_SCOUT_ENABLED: 'true',
    LEAD_SCOUT_DAILY_LIMIT: '40',
    PUBLIC_SEARCH_SOURCE_ENABLED: 'true',
    PUBLIC_SEARCH_DAILY_LIMIT: '10',
    GOOGLE_MAPS_SOURCE_ENABLED: 'true',
    GOOGLE_MAPS_DAILY_LIMIT: '2',
    APIFY_API_TOKEN: 'token-only',
  },
  query: {
    leadScoutLimit: '20',
    publicSearchLimit: '5',
    mapsLimit: '2',
  },
})

assert.equal(researchInventoryPlan.researchUnlimited, true)
assert.equal(researchInventoryPlan.readyInventoryTarget, 1600)
assert.equal(researchInventoryPlan.leadScoutLimit, 120)
assert.equal(researchInventoryPlan.publicSearchLimit, 120)
assert.equal(researchInventoryPlan.mapsLimit, 10)
assert.equal(researchInventoryPlan.approveLimit, 1600)
assert.equal(researchInventoryPlan.sendLimit, 1)

assert.deepEqual(resolveDailyVolumeBand({ env: {} }), {
  minDailyVolume: 120,
  maxDailyVolume: 150,
})

const catchUpPlan = buildDailyOutboundPlan({
  approvalWindow: highCapacityWindow,
  env: {
    DAILY_OUTBOUND_MODE: 'growth',
    DAILY_OUTBOUND_GROWTH_MAX_SEND_LIMIT: '800',
  },
  query: {
    sendLimit: '8',
    mode: 'growth',
  },
})
const catchUpAdjustment = applyDailyVolumeBand({
  plan: catchUpPlan,
  approvalWindow: highCapacityWindow,
  sentToday: 17,
  env: {
    DAILY_OUTBOUND_GROWTH_MAX_SEND_LIMIT: '800',
  },
})

assert.equal(catchUpAdjustment.sendLimit, 103)
assert.equal(catchUpAdjustment.runQueue, true)
assert.equal(catchUpAdjustment.remainingToMin, 103)
assert.ok(
  catchUpAdjustment.guardrails.some((guardrail) =>
    guardrail.includes('raising this cycle from 8 to 103')
  )
)

const ceilingAdjustment = applyDailyVolumeBand({
  plan: catchUpPlan,
  approvalWindow: highCapacityWindow,
  sentToday: 145,
  env: {
    DAILY_OUTBOUND_GROWTH_MAX_SEND_LIMIT: '800',
  },
})

assert.equal(ceilingAdjustment.sendLimit, 5)
assert.equal(ceilingAdjustment.runQueue, true)

const stoppedAtCeilingAdjustment = applyDailyVolumeBand({
  plan: catchUpPlan,
  approvalWindow: highCapacityWindow,
  sentToday: 150,
  env: {
    DAILY_OUTBOUND_GROWTH_MAX_SEND_LIMIT: '800',
  },
})

assert.equal(stoppedAtCeilingAdjustment.sendLimit, 0)
assert.equal(stoppedAtCeilingAdjustment.runQueue, false)

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

const growthDefaultMaxPlan = buildDailyOutboundPlan({
  approvalWindow: highCapacityWindow,
  env: {
    DAILY_OUTBOUND_MODE: 'growth',
    DAILY_OUTBOUND_SEND_LIMIT: '800',
    DAILY_OUTBOUND_APPROVE_LIMIT: '800',
  },
  query: {},
})

assert.equal(growthDefaultMaxPlan.sendLimit, 100)
assert.equal(growthDefaultMaxPlan.approveLimit, 1_000_000)

const providerBackedGrowthPlan = buildDailyOutboundPlan({
  approvalWindow: highCapacityWindow,
  env: {
    DAILY_OUTBOUND_MODE: 'growth',
    DAILY_OUTBOUND_GROWTH_MAX_SEND_LIMIT: '800',
    DAILY_OUTBOUND_MAX_SEND_LIMIT: '800',
    DAILY_OUTBOUND_SEND_LIMIT: '800',
    DAILY_OUTBOUND_APPROVE_LIMIT: '800',
  },
  query: {},
})

assert.equal(providerBackedGrowthPlan.sendLimit, 150)
assert.equal(providerBackedGrowthPlan.approveLimit, 1_000_000)
assert.ok(
  providerBackedGrowthPlan.guardrails.includes(
    'Provider-backed growth ceiling is configured at 150/day; queueing still requires verified contacts, healthy domains, and active sender capacity'
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

assert.equal(noHealthySenderPlan.sendLimit, 50)
assert.equal(noHealthySenderPlan.runQueue, true)
assert.ok(
  noHealthySenderPlan.guardrails.includes(
    'No healthy sender identity is available; queueing is blocked until domain health recovers'
  )
)
assert.ok(
  noHealthySenderPlan.guardrails.some((guardrail) =>
    guardrail.includes('verified-only recovery batch while sender health rebuilds')
  )
)

const recoveryTricklePlan = buildDailyOutboundPlan({
  approvalWindow: severeRecoveryWindow,
  env: {
    DAILY_OUTBOUND_MODE: 'growth',
    DAILY_OUTBOUND_SEND_LIMIT: '10',
  },
  query: {
    recoveryMode: '1',
  },
})

assert.equal(recoveryTricklePlan.sendLimit, 10)
assert.equal(recoveryTricklePlan.runQueue, true)
assert.ok(
  recoveryTricklePlan.guardrails.some((guardrail) =>
    guardrail.includes('Recovery mode allows a verified-only recovery batch')
  )
)

const validationBackedRecoveryPlan = buildDailyOutboundPlan({
  approvalWindow: noHealthySenderWindow,
  env: {
    DAILY_OUTBOUND_MODE: 'growth',
    DAILY_OUTBOUND_SEND_LIMIT: '50',
  },
  query: {},
})

assert.equal(validationBackedRecoveryPlan.sendLimit, 50)
assert.equal(validationBackedRecoveryPlan.runQueue, true)
assert.ok(
  validationBackedRecoveryPlan.guardrails.some((guardrail) =>
    guardrail.includes('verified-only recovery batch while sender health rebuilds')
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
