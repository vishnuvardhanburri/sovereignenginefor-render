import assert from 'node:assert/strict'
import { mapHunterVerification, verifyEmailWithHunter } from '../lib/integrations/hunter'

async function main() {
  assert.deepEqual(mapHunterVerification({ result: 'deliverable', score: 97, accept_all: false }), {
    verdict: 'valid',
    score: 0.97,
    catchAll: false,
  })

  assert.deepEqual(mapHunterVerification({ result: 'undeliverable', score: 4, accept_all: false }), {
    verdict: 'invalid',
    score: 0.04,
    catchAll: false,
  })

  assert.deepEqual(mapHunterVerification({ result: 'risky', score: 62, accept_all: true }), {
    verdict: 'risky',
    score: 0.62,
    catchAll: true,
  })

  const noKey = await verifyEmailWithHunter('hello@example.com', { apiKey: '' })
  assert.equal(noKey.verdict, 'unknown')
  assert.equal(noKey.error, 'hunter_not_configured')

  const valid = await verifyEmailWithHunter('hello@example.com', {
    apiKey: 'test-key',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          data: {
            result: 'deliverable',
            score: 91,
            accept_all: false,
            mx_records: true,
            smtp_check: true,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      ),
  })

  assert.equal(valid.verdict, 'valid')
  assert.equal(valid.score, 0.91)
  assert.equal(valid.catchAll, false)
  assert.equal(valid.provider, 'hunter')

  const exhausted = await verifyEmailWithHunter('hello@example.com', {
    apiKey: 'test-key',
    fetchImpl: async () =>
      new Response(JSON.stringify({ errors: [{ details: 'plan limit reached' }] }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
  })

  assert.equal(exhausted.verdict, 'unknown')
  assert.equal(exhausted.error, 'hunter_http_429')

  console.log('hunter verification tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
