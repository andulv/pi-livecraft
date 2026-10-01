import assert from 'node:assert/strict'
import test from 'node:test'
import { sendBrowserInput } from '../src/api.ts'
import type { BrowserInputEvent } from '../shared/types.ts'

const target = { workspacePath: '/workspace', browserId: 'main' }

function move(x: number): BrowserInputEvent {
  return { type: 'mouseMoved', x, y: 0, button: 'none', clickCount: 0, modifiers: 0 }
}

test('sends one input request at a time, merging queued moves without reordering', async () => {
  const sent: Array<{ type: string; x?: number }> = []
  let inFlight = 0
  let maxInFlight = 0
  const releases: Array<() => void> = []
  const original = globalThis.fetch
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { type: string; x?: number }
    sent.push({ type: body.type, ...(body.x === undefined ? {} : { x: body.x }) })
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise<void>((resolve) => releases.push(resolve))
    inFlight -= 1
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch

  try {
    sendBrowserInput(target, move(1))
    // While the first request is pending: three moves collapse into the last one, the
    // press keeps its place, and the move after it is not merged across the press.
    sendBrowserInput(target, move(2))
    sendBrowserInput(target, move(3))
    sendBrowserInput(target, move(4))
    sendBrowserInput(target, {
      type: 'mousePressed',
      x: 4,
      y: 0,
      button: 'left',
      clickCount: 1,
      modifiers: 0,
    })
    sendBrowserInput(target, move(5))

    for (let index = 0; index < 4; index++) {
      while (releases.length === 0) await new Promise((resolve) => setImmediate(resolve))
      releases.shift()?.()
    }
    await new Promise((resolve) => setImmediate(resolve))

    assert.deepEqual(sent, [
      { type: 'mouseMoved', x: 1 },
      { type: 'mouseMoved', x: 4 },
      { type: 'mousePressed', x: 4 },
      { type: 'mouseMoved', x: 5 },
    ])
    assert.equal(maxInFlight, 1)
  } finally {
    globalThis.fetch = original
  }
})

test('sheds queued moves before discarding a stale backlog on overflow', async () => {
  const sent: string[] = []
  let release: (() => void) | undefined
  const original = globalThis.fetch
  globalThis.fetch = (async (_input, init) => {
    sent.push((JSON.parse(String(init?.body)) as { type: string }).type)
    if (sent.length === 1) await new Promise<void>((resolve) => release = resolve)
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  const overflowTarget = { workspacePath: '/overflow', browserId: 'main' }
  const key = (type: 'keyDown' | 'keyUp'): BrowserInputEvent => ({
    type,
    key: 'a',
    code: 'KeyA',
    keyCode: 65,
    modifiers: 0,
  })

  try {
    sendBrowserInput(overflowTarget, move(0))
    await new Promise((resolve) => setImmediate(resolve))
    // A queued move is shed first when the backlog exceeds 200 events.
    sendBrowserInput(overflowTarget, move(1))
    for (let index = 0; index < 200; index++) sendBrowserInput(overflowTarget, key('keyDown'))
    // Only presses and keys remain: the next overflow discards the stale backlog.
    sendBrowserInput(overflowTarget, key('keyUp'))
    release?.()
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.deepEqual(sent, ['mouseMoved'])
  } finally {
    globalThis.fetch = original
  }
})
