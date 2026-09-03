import assert from 'node:assert/strict'
import test from 'node:test'
import { createOrderedSender } from '../src/api.ts'

/** Double that resolves under test control. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {}
  const promise = new Promise<void>((settled) => {
    resolve = settled
  })
  return { promise, resolve }
}

test('ordered sender keeps exactly one POST in flight, in submission order', async () => {
  const first = deferred()
  const second = deferred()
  const batches: string[] = []
  let calls = 0
  const sender = createOrderedSender((data) => {
    calls++
    batches.push(data)
    return calls === 1 ? first.promise : second.promise
  })

  sender.send('a')
  sender.send('b')
  sender.send('c')

  assert.deepEqual(batches, ['a'], 'only the first send is in flight')
  first.resolve()
  await first.promise
  await Promise.resolve()
  assert.deepEqual(batches, ['a', 'bc'], 'backlog merges into the next POST')
  second.resolve()
})

test('ordered sender sends nothing for empty input and recovers from failures', async () => {
  const gate = deferred()
  const batches: string[] = []
  const sender = createOrderedSender((data) => {
    batches.push(data)
    return gate.promise.then(() => {
      throw new Error('POST failed')
    })
  })

  sender.send('')
  assert.deepEqual(batches, [], 'empty data never posts')

  sender.send('ls\r')
  gate.resolve()
  await new Promise((resolve) => setTimeout(resolve, 10))

  sender.send('after-failure')
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.deepEqual(batches, ['ls\r', 'after-failure'], 'a failed POST never blocks the queue')
})

test('output payloads are extracted from the raw SSE data field', async () => {
  const { parseTerminalOutputPayload } = await import('../src/api.ts')
  const b64 = Buffer.from('hello world').toString('base64')
  assert.equal(parseTerminalOutputPayload(JSON.stringify({ data: b64 })), b64)
  // The regression: the raw JSON reached atob instead of the extracted field.
  assert.equal(
    parseTerminalOutputPayload(JSON.stringify({ data: 'not-strictly-base64' })),
    'not-strictly-base64',
  )
  assert.equal(parseTerminalOutputPayload('{broken'), null)
  assert.equal(parseTerminalOutputPayload('["array"]'), null)
  assert.equal(parseTerminalOutputPayload(''), null)
})
