import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BrowserSession,
  parseBrowserProcessInfo,
} from '../server/features/browser/browser-session.ts'

test('normalizes browser-level CDP process diagnostics', () => {
  assert.deepEqual(
    parseBrowserProcessInfo([
      { type: 'renderer', id: 321, cpuTime: 1.25 },
      { type: 'browser', id: 123, cpuTime: 4 },
      { type: 'gpu-process', id: 222, cpuTime: 0.5 },
      { type: '', id: 999, cpuTime: 0 },
      { type: 'utility', id: -1, cpuTime: 0 },
      { type: 'utility', id: 444, cpuTime: -1 },
      null,
    ]),
    [
      { pid: 123, type: 'browser', cpuTimeSeconds: 4 },
      { pid: 222, type: 'gpu-process', cpuTimeSeconds: 0.5 },
      { pid: 321, type: 'renderer', cpuTimeSeconds: 1.25 },
    ],
  )
  assert.deepEqual(parseBrowserProcessInfo(null), [])
})

test('reports an idle browser diagnostics snapshot without launching Chrome', async () => {
  const snapshot = await new BrowserSession().debugSnapshot()
  assert.equal(snapshot.status.state, 'off')
  assert.equal(snapshot.rootPid, undefined)
  assert.equal(snapshot.viewerCount, 0)
  assert.equal(snapshot.capturedFrames, 0)
  assert.equal(snapshot.capturedBytes, 0)
  assert.deepEqual(snapshot.processes, [])
  assert.ok(snapshot.sampledAt > 0)
})
