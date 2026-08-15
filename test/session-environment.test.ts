import assert from 'node:assert/strict'
import test from 'node:test'
import { EnvironmentCache } from '../server/features/session-environment/environment-cache.ts'

function setStatusEvent(statusText: string): unknown {
  return {
    kind: 'event',
    event: 'pi',
    sessionId: 'session-1',
    data: {
      type: 'extension_ui_request',
      method: 'setStatus',
      statusKey: 'pi-livecraft.environment',
      statusText,
    },
  }
}

const fullReport = JSON.stringify({
  protocol: 'pi-livecraft.environment',
  version: 1,
  refreshedAt: 1_000,
  tools: [
    {
      name: 'read',
      description: 'Read file contents',
      active: true,
      source: 'builtin',
      params: [{ name: 'path', type: 'string', required: true }],
    },
    {
      name: 'ketch_search',
      active: false,
      source: 'extension',
      sourceName: 'index.ts',
      sourcePath: '/home/user/.pi/agent/extensions/pi-ketch/index.ts',
      estimatedContextChars: 1_290,
    },
  ],
  skills: [{
    name: 'skill:ketch',
    path: '/home/user/.pi/agent/skills/ketch/SKILL.md',
    active: true,
    scope: 'user',
    origin: 'top-level',
  }],
  contextFiles: [{ path: '/repo/AGENTS.md', bytes: 8_400 }],
})

test('accepts the versioned environment payload', () => {
  const cache = new EnvironmentCache()
  assert.equal(cache.receiveManagerEvent(setStatusEvent(fullReport)), true)
  const snapshot = cache.snapshot('session-1', false)
  assert.equal(snapshot.tools.length, 2)
  assert.equal(snapshot.tools[0].name, 'read')
  assert.deepEqual(snapshot.tools[0].params?.[0], { name: 'path', type: 'string', required: true })
  assert.equal(snapshot.tools[1].active, false)
  assert.equal(snapshot.tools[1].sourcePath, '/home/user/.pi/agent/extensions/pi-ketch/index.ts')
  assert.equal(snapshot.tools[1].estimatedContextChars, 1_290)
  assert.deepEqual(snapshot.skills, [{
    name: 'skill:ketch',
    path: '/home/user/.pi/agent/skills/ketch/SKILL.md',
    active: true,
    scope: 'user',
    origin: 'top-level',
  }])
  assert.deepEqual(snapshot.contextFiles, [{ path: '/repo/AGENTS.md', bytes: 8_400 }])
  assert.equal(snapshot.updatedAt, 1_000)
  assert.equal(snapshot.refreshing, false)
})

test('ignores payloads with the wrong protocol, version, or shape', () => {
  const cache = new EnvironmentCache()
  const report = JSON.parse(fullReport)
  const wrongProtocol = JSON.stringify({ ...report, protocol: 'other.protocol' })
  const wrongVersion = JSON.stringify({ ...report, version: 2 })
  const invalidTool = JSON.stringify({
    protocol: 'pi-livecraft.environment',
    version: 1,
    refreshedAt: 1_000,
    tools: [{ name: 'read' }],
  })
  for (const payload of [wrongProtocol, wrongVersion, invalidTool, '{not json']) {
    assert.equal(cache.receiveManagerEvent(setStatusEvent(payload)), false)
  }
  assert.equal(cache.snapshot('session-1', true).updatedAt, undefined)
})

test('ignores status events without a session', () => {
  const cache = new EnvironmentCache()
  const event = setStatusEvent(fullReport) as { sessionId?: unknown }
  delete event.sessionId
  assert.equal(cache.receiveManagerEvent(event), false)
})

test('ignores status events for other keys', () => {
  const cache = new EnvironmentCache()
  const event = setStatusEvent(fullReport) as { data: { statusKey: string } }
  event.data.statusKey = 'pi-livecraft.quotas'
  assert.equal(cache.receiveManagerEvent(event), false)
})

test('keeps the previous section when a newer report omits it', () => {
  const cache = new EnvironmentCache()
  cache.receiveManagerEvent(setStatusEvent(fullReport))
  // Session start publishes tools before a command context can read context files.
  const toolsOnly = JSON.stringify({
    protocol: 'pi-livecraft.environment',
    version: 1,
    refreshedAt: 2_000,
    tools: [{ name: 'bash', active: true, source: 'builtin' }],
  })
  assert.equal(cache.receiveManagerEvent(setStatusEvent(toolsOnly)), true)
  const snapshot = cache.snapshot('session-1', false)
  assert.deepEqual(snapshot.tools.map((tool) => tool.name), ['bash'])
  assert.deepEqual(snapshot.skills.map((skill) => skill.path), [
    '/home/user/.pi/agent/skills/ketch/SKILL.md',
  ])
  assert.deepEqual(snapshot.contextFiles, [{ path: '/repo/AGENTS.md', bytes: 8_400 }])
  assert.equal(snapshot.updatedAt, 2_000)
})

test('rejects a report without any section', () => {
  const cache = new EnvironmentCache()
  cache.receiveManagerEvent(setStatusEvent(fullReport))
  const empty = JSON.stringify({
    protocol: 'pi-livecraft.environment',
    version: 1,
    refreshedAt: 3_000,
  })
  assert.equal(cache.receiveManagerEvent(setStatusEvent(empty)), false)
  assert.equal(cache.snapshot('session-1', false).updatedAt, 1_000)
})

test('keeps sessions isolated from each other', () => {
  const cache = new EnvironmentCache()
  cache.receiveManagerEvent(setStatusEvent(fullReport))
  // Another project's session publishes an empty context-file section.
  const otherSession = JSON.stringify({
    protocol: 'pi-livecraft.environment',
    version: 1,
    refreshedAt: 4_000,
    tools: [{ name: 'bash', active: true, source: 'builtin' }],
    contextFiles: [],
  })
  const event = setStatusEvent(otherSession) as { sessionId: string; data: { statusText: string } }
  event.sessionId = 'session-2'
  assert.equal(cache.receiveManagerEvent(event), true)
  const first = cache.snapshot('session-1', false)
  const second = cache.snapshot('session-2', false)
  assert.deepEqual(first.contextFiles, [{ path: '/repo/AGENTS.md', bytes: 8_400 }])
  assert.deepEqual(second.contextFiles, [])
  assert.equal(second.updatedAt, 4_000)
  // A session with no report yet reads empty, not another session's data.
  assert.deepEqual(cache.snapshot('session-3', false).tools, [])
})

test('snapshot reports session requirement and refresh state', () => {
  const cache = new EnvironmentCache()
  assert.equal(cache.snapshot('session-1', true).sessionRequired, true)
  cache.setRefreshing('session-1', true)
  assert.equal(cache.snapshot('session-1', false).refreshing, true)
  assert.equal(cache.snapshot('session-2', false).refreshing, false)
  cache.receiveManagerEvent(setStatusEvent(fullReport))
  assert.equal(cache.snapshot('session-1', false).refreshing, false)
})
