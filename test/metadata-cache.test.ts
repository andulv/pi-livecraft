import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MetadataCache,
  modelDependency,
} from '../server/features/session-metadata/metadata-cache.ts'

test('serves repeated loads from the cache within the TTL', async () => {
  let calls = 0
  const cache = new MetadataCache({ ttlMs: 60_000 })
  const first = await cache.load('models:s1', async () => {
    calls += 1
    return [{ id: 'm1' }]
  })
  const second = await cache.load('models:s1', async () => {
    calls += 1
    return [{ id: 'm2' }]
  })

  assert.equal(calls, 1)
  assert.equal(first.cached, false)
  assert.equal(second.cached, true)
  assert.deepEqual(second.value, [{ id: 'm1' }])
})

test('reloads when the dependency string changes', async () => {
  let calls = 0
  const cache = new MetadataCache({ ttlMs: 60_000 })
  await cache.load('thinking:s1', async () => {
    calls += 1
    return ['off']
  }, modelDependency({ provider: 'test', id: 'model-a' }))
  await cache.load('thinking:s1', async () => {
    calls += 1
    return ['off', 'high']
  }, modelDependency({ provider: 'test', id: 'model-b' }))

  assert.equal(calls, 2)
})

test('derives a distinct dependency from Pi’s object-shaped model state', () => {
  assert.equal(
    modelDependency({ provider: 'catherder-llama', id: 'qwen38' }),
    'catherder-llama/qwen38',
  )
  assert.equal(modelDependency({ id: 'qwen38' }), '')
  assert.equal(modelDependency('legacy-model-id'), 'legacy-model-id')
})

test('expires entries after the TTL', async () => {
  let now = 1_000
  let calls = 0
  const cache = new MetadataCache({ ttlMs: 500, now: () => now })
  await cache.load('commands:s1', async () => {
    calls += 1
    return []
  })
  now += 501
  await cache.load('commands:s1', async () => {
    calls += 1
    return []
  })

  assert.equal(calls, 2)
})

test('combines concurrent loads into one fetch', async () => {
  let calls = 0
  const cache = new MetadataCache({ ttlMs: 60_000 })
  const [first, second] = await Promise.all([
    cache.load('models:s1', async () => {
      calls += 1
      return []
    }),
    cache.load('models:s1', async () => {
      calls += 1
      return []
    }),
  ])

  assert.equal(calls, 1)
  assert.equal(first.cached, false)
  assert.equal(second.cached, true)
})

test('invalidation blocks in-flight loads from repopulating and forces a reload', async () => {
  let calls = 0
  let release: (value: string[]) => void = () => {}
  const cache = new MetadataCache({ ttlMs: 60_000 })
  const first = cache.load('models:s1', async () => {
    calls += 1
    return ['stale']
  })
  await cache.invalidatePrefix('models:')
  release(['fresh'])
  const [result] = await Promise.all([first])
  assert.deepEqual(result.value, ['stale'])

  const second = await cache.load('models:s1', async () => {
    calls += 1
    return ['fresh']
  })
  assert.equal(calls, 2)
  assert.equal(second.cached, false)
  assert.deepEqual(second.value, ['fresh'])
})

test('never caches failed loads', async () => {
  let calls = 0
  const cache = new MetadataCache({ ttlMs: 60_000 })
  await assert.rejects(
    cache.load('models:s1', async () => {
      calls += 1
      throw new Error('pi unavailable')
    }),
  )
  const result = await cache.load('models:s1', async () => {
    calls += 1
    return []
  })

  assert.equal(calls, 2)
  assert.deepEqual(result.value, [])
})

test('evicts the least recently used session beyond the session bound', async () => {
  let now = 1_000
  const cache = new MetadataCache({ ttlMs: 60_000, maxSessions: 2, now: () => now })
  await cache.load('models:s1', async () => ['a'])
  now += 10
  await cache.load('models:s2', async () => ['b'])
  now += 10
  await cache.load('models:s1', async () => ['a2'])
  now += 10
  // A third session evicts s2, the least recently used session. Re-loading s2 then
  // evicts s1, which is now the least recently used.
  await cache.load('models:s3', async () => ['c'])
  const s2 = await cache.load('models:s2', async () => ['b2'])
  const s1 = await cache.load('models:s1', async () => ['a3'])
  const s1Again = await cache.load('models:s1', async () => ['a4'])

  assert.equal(s2.cached, false)
  assert.deepEqual(s2.value, ['b2'])
  assert.equal(s1.cached, false)
  assert.equal(s1Again.cached, true)
  assert.deepEqual(s1Again.value, ['a3'])
})

test('clear drops everything, including in-flight loads', async () => {
  const cache = new MetadataCache({ ttlMs: 60_000 })
  let release: (value: string[]) => void = () => {}
  const inflight = cache.load(
    'models:s1',
    () =>
      new Promise<string[]>((resolve) => {
        release = resolve
      }),
  )
  cache.clear()
  release(['inflight'])
  assert.equal((await inflight).cached, false)

  const next = await cache.load('models:s1', async () => ['c'])
  assert.equal(next.cached, false)
  assert.deepEqual(next.value, ['c'])
})
