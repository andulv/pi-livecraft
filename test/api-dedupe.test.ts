import assert from 'node:assert/strict'
import test from 'node:test'
import { getGitProject, getQuotas, getWorkspaceFile } from '../src/api.ts'

/** Replaces the global fetch for one test and restores it afterwards. */
function withFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
  run: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch
  globalThis.fetch =
    ((input: unknown, init?: RequestInit) =>
      handler(typeof input === 'string' ? input : String(input), init)) as typeof fetch
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
      const [first, second] = await Promise.all([
        getGitProject('/x', 'test:dedupe'),
        getGitProject('/x', 'test:dedupe'),
      ])
      assert.equal(calls, 1)
      assert.deepEqual(first, second)
      await getGitProject('/x', 'test:dedupe')
      assert.equal(calls, 2)
    },
  )
})

test('cancelled file reads are independent, retry fresh, and do not report intentional aborts', async () => {
  let reads = 0
  const reports: string[] = []
  await withFetch(
    async (url, init) => {
      if (url === '/api/client-log') {
        reports.push(String(init?.body))
        return new Response('{}')
      }
      const version = ++reads
      if (version === 1) {
        await new Promise<void>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        })
      }
      return new Response(JSON.stringify({ content: `version-${version}` }))
    },
    async () => {
      const controller = new AbortController()
      const cancelled = getWorkspaceFile('/x', 'file.txt', controller.signal)
      const rejection = assert.rejects(cancelled, { name: 'AbortError' })
      controller.abort()
      // This read starts before the aborted promise has settled.
      const fresh = getWorkspaceFile('/x', 'file.txt', new AbortController().signal)
      assert.equal((await fresh).content, 'version-2')
      await rejection
      assert.equal(reports.length, 0)
      assert.equal(
        (await getWorkspaceFile('/x', 'file.txt', new AbortController().signal)).content,
        'version-3',
      )
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
      await Promise.all([getGitProject('/x', 'test:dedupe'), getQuotas('test:dedupe')])
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
