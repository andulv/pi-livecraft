import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  ManagerRequest,
  ManagerRuntimeIdentity,
  ManagerRuntimeStatus,
} from '../shared/types.ts'
import type { ManagerClient } from '../server/manager-client.ts'
import { ManagerRuntimeMonitor } from '../server/manager-runtime-monitor.ts'
import { calculateManagerRuntimeRevision } from '../server/manager-runtime.ts'

class FakeManager {
  connected = true
  identity: ManagerRuntimeIdentity
  actions: ManagerRequest['action'][] = []
  restartError: string | undefined

  constructor(identity: ManagerRuntimeIdentity) {
    this.identity = identity
  }

  async request(request: Pick<ManagerRequest, 'action'>): Promise<unknown> {
    this.actions.push(request.action)
    if (request.action === 'status') return this.identity
    if (request.action === 'restart') {
      if (this.restartError) throw new Error(this.restartError)
      return { accepted: true }
    }
    throw new Error(`Unexpected action: ${request.action}`)
  }
}

test('leaves active-work restart validation to the manager', async () => {
  const manager = new FakeManager({
    instanceId: 'manager-1',
    startedAt: new Date().toISOString(),
    runtimeRevision: 'sha256-v1:obsolete',
    supervised: true,
  })
  manager.restartError = 'Active Pi work must settle before restarting'
  const monitor = new ManagerRuntimeMonitor(manager as unknown as ManagerClient, () => undefined)

  try {
    monitor.start()
    monitor.connected()
    await waitForState(monitor, 'stale')
    await assert.rejects(monitor.restart(), /Active Pi work/)
    assert.equal(manager.actions.includes('list'), false)
    assert.equal(manager.actions.includes('restart'), true)
  } finally {
    monitor.stop()
  }
})

test('marks an obsolete supervised manager as restartable and requests one restart', async () => {
  const { revision } = await calculateManagerRuntimeRevision()
  const manager = new FakeManager({
    instanceId: 'manager-1',
    startedAt: new Date().toISOString(),
    runtimeRevision: revision,
    supervised: true,
  })
  const states: ManagerRuntimeStatus[] = []
  const monitor = new ManagerRuntimeMonitor(
    manager as unknown as ManagerClient,
    (status) => states.push(status),
  )

  try {
    monitor.start()
    monitor.connected()
    await waitForState(monitor, 'current')

    manager.identity = { ...manager.identity, runtimeRevision: 'sha256-v1:obsolete' }
    monitor.connected()
    await waitForState(monitor, 'stale')
    assert.deepEqual(monitor.status, { state: 'stale', canRestart: true })

    const restart = monitor.restart()
    await assert.rejects(monitor.restart(), /already in progress/)
    await restart
    assert.equal(monitor.status.state, 'restarting')
    assert.deepEqual(manager.actions.slice(-2), ['status', 'restart'])

    manager.identity = { ...manager.identity, instanceId: 'manager-2', runtimeRevision: revision }
    monitor.connected()
    await waitForState(monitor, 'current')
    assert.ok(states.some(({ state }) => state === 'current'))
  } finally {
    monitor.stop()
  }
})

/** Polls asynchronous monitor work without coupling the test to file-system timing. */
async function waitForState(
  monitor: ManagerRuntimeMonitor,
  state: ManagerRuntimeStatus['state'],
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (monitor.status.state === state) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail(`Manager runtime did not reach ${state}; current state: ${monitor.status.state}`)
}
