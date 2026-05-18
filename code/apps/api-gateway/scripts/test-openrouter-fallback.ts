import assert from 'node:assert/strict'
import { extractJsonObject, tryOpenRouterJson } from '../lib/ai/openrouter'

async function main() {
  assert.deepEqual(
    extractJsonObject('```json\n{"recommendedContent":"hello","score":0.9}\n```'),
    { recommendedContent: 'hello', score: 0.9 }
  )

  assert.deepEqual(
    extractJsonObject('prefix {"a":1,"b":"two"} suffix'),
    { a: 1, b: 'two' }
  )

  const fallback = { recommendedContent: 'fallback copy', personalizationScore: 0.72 }

  const noKey = await tryOpenRouterJson({
    task: 'smart_personalization',
    system: 'Return JSON only.',
    user: 'Write one line.',
    fallback,
    apiKey: '',
    model: 'meta-llama/llama-3.1-8b-instruct:free',
  })

  assert.equal(noKey.source, 'fallback')
  assert.equal(noKey.error, 'openrouter_not_configured')
  assert.deepEqual(noKey.data, fallback)

  const noCredits = await tryOpenRouterJson({
    task: 'smart_personalization',
    system: 'Return JSON only.',
    user: 'Write one line.',
    fallback,
    apiKey: 'test-key',
    model: 'meta-llama/llama-3.1-8b-instruct:free',
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: { message: 'Insufficient credits' } }), {
        status: 402,
        headers: { 'content-type': 'application/json' },
      }),
  })

  assert.equal(noCredits.source, 'fallback')
  assert.equal(noCredits.error, 'openrouter_http_402')
  assert.deepEqual(noCredits.data, fallback)

  const ok = await tryOpenRouterJson({
    task: 'smart_personalization',
    system: 'Return JSON only.',
    user: 'Write one line.',
    fallback,
    apiKey: 'test-key',
    model: 'meta-llama/llama-3.1-8b-instruct:free',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"recommendedContent":"AI copy","personalizationScore":0.91}',
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      ),
  })

  assert.equal(ok.source, 'openrouter')
  assert.deepEqual(ok.data, { recommendedContent: 'AI copy', personalizationScore: 0.91 })

  console.log('openrouter fallback tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
