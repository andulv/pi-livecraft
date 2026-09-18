import assert from 'node:assert/strict'
import test from 'node:test'
import {
  forgetWorkspaceSession,
  readWorkspaceSessionSelections,
  rememberWorkspaceSession,
  writeWorkspaceSessionSelections,
  type WorkspaceSessionSelections,
} from '../src/features/workspace/workspace-session-state.ts'

const workspaceA = '/workspace/a'
const workspaceB = '/workspace/b'

function selections(overrides: WorkspaceSessionSelections = {}): WorkspaceSessionSelections {
  return overrides
}

test('remembers and forgets a workspace session path', () => {
  const remembered = rememberWorkspaceSession(selections(), workspaceA, '/sessions/a.json', 10)
  assert.deepEqual(remembered[workspaceA], { sessionPath: '/sessions/a.json', touchedAt: 10 })

  const forgotten = forgetWorkspaceSession(remembered, workspaceA)
  assert.deepEqual(forgotten, {})
})

test('ignores empty workspace and session paths', () => {
  const initial = selections()
  assert.equal(rememberWorkspaceSession(initial, '', '/sessions/a.json'), initial)
  assert.equal(rememberWorkspaceSession(initial, workspaceA, '  '), initial)
})

test('round-trips remembered selections', () => {
  const initial = {
    [workspaceA]: { sessionPath: '/sessions/a.json', touchedAt: 10 },
    [workspaceB]: { sessionPath: '/sessions/b.json', touchedAt: 20 },
  }
  const restored = readWorkspaceSessionSelections(writeWorkspaceSessionSelections(initial))
  assert.deepEqual(restored, initial)
})

test('malformed and unsupported persisted state fails safely', () => {
  assert.deepEqual(readWorkspaceSessionSelections(null), {})
  assert.deepEqual(readWorkspaceSessionSelections('not-json'), {})
  assert.deepEqual(
    readWorkspaceSessionSelections('{"version":2,"workspaces":{}}'),
    {},
  )
  assert.deepEqual(readWorkspaceSessionSelections('{"version":1}'), {})
})

test('skips malformed workspace entries', () => {
  const raw = JSON.stringify({
    version: 1,
    workspaces: {
      [workspaceA]: { sessionPath: '', touchedAt: 1 },
      [workspaceB]: { sessionPath: '/sessions/b.json', touchedAt: 2 },
      '/workspace/c': { sessionPath: '/sessions/c.json', touchedAt: 'old' },
    },
  })
  assert.deepEqual(readWorkspaceSessionSelections(raw), {
    [workspaceB]: { sessionPath: '/sessions/b.json', touchedAt: 2 },
  })
})

test('bounds oversized persisted state while reading', () => {
  const workspaces: Record<string, { sessionPath: string; touchedAt: number }> = {}
  for (let index = 0; index < 30; index++) {
    workspaces[`/workspace/${index}`] = {
      sessionPath: `/sessions/${index}.json`,
      touchedAt: index,
    }
  }

  const restored = readWorkspaceSessionSelections(JSON.stringify({ version: 1, workspaces }))
  assert.equal(Object.keys(restored).length, 24)
  assert.equal(restored['/workspace/5'], undefined)
  assert.ok(restored['/workspace/6'])
  assert.ok(restored['/workspace/29'])
})

test('evicts least-recently-touched workspaces when persisted state is bounded', () => {
  const initial: WorkspaceSessionSelections = {}
  for (let index = 0; index < 30; index++) {
    initial[`/workspace/${index}`] = {
      sessionPath: `/sessions/${index}.json`,
      touchedAt: index,
    }
  }

  const restored = readWorkspaceSessionSelections(writeWorkspaceSessionSelections(initial))
  assert.equal(Object.keys(restored).length, 24)
  for (let index = 0; index < 6; index++) {
    assert.equal(restored[`/workspace/${index}`], undefined)
  }
  for (let index = 6; index < 30; index++) {
    assert.ok(restored[`/workspace/${index}`])
  }
})
