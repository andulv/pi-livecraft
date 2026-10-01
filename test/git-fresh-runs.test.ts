import assert from 'node:assert/strict'
import test from 'node:test'
import { FreshRuns } from '../server/features/git/fresh-runs.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('callers arriving together share one run', async () => {
  const runs = new FreshRuns<number>()
  let started = 0
  const task = async () => ++started
  const results = await Promise.all([runs.run('a', task), runs.run('a', task), runs.run('a', task)])
  assert.deepEqual(results, [1, 1, 1])
  assert.equal(await runs.run('a', task), 2)
})

test('a caller arriving mid-run gets a later run, shared with other late callers', async () => {
  const runs = new FreshRuns<string>()
  const first = deferred<string>()
  const begun = deferred<void>()
  const started: string[] = []
  const firstResult = runs.run('a', () => {
    started.push('first')
    begun.resolve()
    return first.promise
  })
  await begun.promise
  const late = [
    runs.run('a', async () => {
      started.push('second')
      return 'second'
    }),
    runs.run('a', async () => 'unused'),
  ]
  assert.deepEqual(started, ['first'])
  first.resolve('first')
  assert.equal(await firstResult, 'first')
  assert.deepEqual(await Promise.all(late), ['second', 'second'])
  assert.deepEqual(started, ['first', 'second'])
})

test('keys run independently and a failure reaches only its sharers', async () => {
  const runs = new FreshRuns<string>()
  const failed = runs.run('a', async () => {
    throw new Error('broken')
  })
  const other = runs.run('b', async () => 'ok')
  await assert.rejects(failed, /broken/)
  assert.equal(await other, 'ok')
  assert.equal(await runs.run('a', async () => 'recovered'), 'recovered')
})
