import assert from 'node:assert/strict'
import test from 'node:test'
import { getGitProject, getQuotas } from '../src/api.ts'

/** Replaces the global fetch for one test and restores it afterwards. */
function withFetch(
  handler: (url: string) => Promise<Response>,
  run: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch
  globalThis.fetch =
    ((input: unknown) => handler(typeof input === 'string' ? input : String(input))) as typeof fetch
  return run().finally(() => {
    globalThis.fetch = original
  })
}

test('shares concurrent identical GET requests and refetches after they settle', async () => {
  let calls = 0
  await withFetch(
    async () => {
      calls += 1
      return new Response(JSON.stringify({ root: '/x', workspaces: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
    async () => {
      const [first, second] = await Promise.all([getGitProject('/x'), getGitProject('/x')])
      assert.equal(calls, 1)
      assert.deepEqual(first, second)
      await getGitProject('/x')
      assert.equal(calls, 2)
    },
  )
})

test('keeps distinct GET paths separate and never dedupes writes', async () => {
  const seen = new Map<string, number>()
  await withFetch(
    async (url) => {
      seen.set(url, (seen.get(url) ?? 0) + 1)
      const body = url.startsWith('/api/quotas')
        ? { providers: [] }
        : { root: '/x', workspaces: [] }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
    async () => {
      await Promise.all([getGitProject('/x'), getQuotas()])
      // createSession is a POST (write) and must not be deduped even if called twice.
      const { createSession } = await import('../src/api.ts')
      await Promise.all([
        createSession('/x'),
        createSession('/x'),
      ])
      assert.equal(seen.get('/api/git/project?cwd=%2Fx'), 1)
      assert.equal(seen.get('/api/quotas'), 1)
      assert.equal(seen.get('/api/sessions'), 2)
    },
  )
})
