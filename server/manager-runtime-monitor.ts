import { watchFile, unwatchFile } from 'node:fs'
import { isObject } from '../shared/is-object.ts'
import type { ManagerRuntimeIdentity, ManagerRuntimeStatus } from '../shared/types.ts'
import type { ManagerClient } from './manager-client.ts'
import { calculateManagerRuntimeRevision, managerRuntimeManifestPath } from './manager-runtime.ts'

const reconnectTimeoutMs = 10_000

/** Tracks whether the connected manager still matches its declared runtime files. */
export class ManagerRuntimeMonitor {
  readonly #manager: ManagerClient
  readonly #onChange: (status: ManagerRuntimeStatus) => void
  #status: ManagerRuntimeStatus = { state: 'disconnected', canRestart: false }
  #identity: ManagerRuntimeIdentity | undefined
  #expectedRevision: string | undefined
  #revisionError: string | undefined
  #watchedPaths = new Set<string>()
  #refreshTimer: NodeJS.Timeout | undefined
  #reconnectTimer: NodeJS.Timeout | undefined
  #revisionRefresh = 0
  #verification = 0
  #restartRequested = false
  #restartingInstanceId: string | undefined

  constructor(manager: ManagerClient, onChange: (status: ManagerRuntimeStatus) => void) {
    this.#manager = manager
    this.#onChange = onChange
  }

  get status(): ManagerRuntimeStatus {
    return this.#status
  }

  /** Installs file monitoring before the manager connects. */
  start(): void {
    this.#replaceWatchers([managerRuntimeManifestPath])
    void this.#refreshExpectedRevision()
  }

  /** Releases file watchers and timers when the owning backend stops. */
  stop(): void {
    this.#revisionRefresh += 1
    for (const path of this.#watchedPaths) unwatchFile(path, this.#scheduleRefresh)
    this.#watchedPaths.clear()
    if (this.#refreshTimer) clearTimeout(this.#refreshTimer)
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)
  }

  /** Revalidates the runtime identity after each manager connection. */
  connected(): void {
    this.#restartRequested = false
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)
    this.#reconnectTimer = undefined
    if (this.#status.state !== 'restarting') this.#publish({ state: 'checking', canRestart: false })
    void this.#verifyConnectedManager()
  }

  /** Preserves an intentional restart state while ManagerClient reconnects. */
  disconnected(): void {
    this.#identity = undefined
    this.#verification += 1
    if (this.#status.state !== 'restarting')
      this.#publish({ state: 'disconnected', canRestart: false })
  }

  /** Requests one supervised restart while leaving active-work authority to the manager. */
  async restart(): Promise<void> {
    if (!this.#manager.connected) throw new Error('Pi manager is unavailable')
    if (this.#restartRequested) throw new Error('Pi manager restart is already in progress')
    if (this.#status.state !== 'stale' || !this.#status.canRestart)
      throw new Error('Pi manager cannot be restarted in its current state')
    this.#restartRequested = true
    try {
      this.#restartingInstanceId = this.#identity?.instanceId
      this.#publish({ state: 'restarting', canRestart: false })
      await this.#manager.request({ action: 'restart' }, 5_000)
      this.#reconnectTimer = setTimeout(() => {
        if (this.#status.state === 'restarting')
          this.#publish({
            state: 'disconnected',
            canRestart: false,
            error: 'Pi manager did not reconnect after restarting.',
          })
      }, reconnectTimeoutMs)
    } catch (error) {
      this.#restartRequested = false
      this.#restartingInstanceId = undefined
      if (this.#manager.connected) void this.#verifyConnectedManager()
      else this.#publish({ state: 'disconnected', canRestart: false, error: errorMessage(error) })
      throw error
    }
  }

  /** Recomputes the expected revision and updates watched paths when the manifest changes. */
  async #refreshExpectedRevision(): Promise<void> {
    const refresh = ++this.#revisionRefresh
    try {
      const discoveredRuntime = await calculateManagerRuntimeRevision()
      if (refresh !== this.#revisionRefresh) return
      this.#replaceWatchers([managerRuntimeManifestPath, ...discoveredRuntime.files])

      const runtime = await calculateManagerRuntimeRevision()
      if (refresh !== this.#revisionRefresh) return
      this.#expectedRevision = runtime.revision
      this.#revisionError = undefined
      this.#replaceWatchers([managerRuntimeManifestPath, ...runtime.files])
      if (this.#manager.connected && !this.#restartRequested) await this.#verifyConnectedManager()
    } catch (error) {
      if (refresh !== this.#revisionRefresh) return
      this.#expectedRevision = undefined
      this.#revisionError = errorMessage(error)
      this.#replaceWatchers([managerRuntimeManifestPath, ...this.#watchedPaths])
      this.#publish({ state: 'unknown', canRestart: false, error: this.#revisionError })
    }
  }

  /** Reads the process identity once and discards responses from superseded connections. */
  async #verifyConnectedManager(): Promise<void> {
    const verification = ++this.#verification
    if (!this.#manager.connected || this.#restartRequested) return
    try {
      const value = await this.#manager.request({ action: 'status' }, 5_000)
      if (verification !== this.#verification || !this.#manager.connected || this.#restartRequested)
        return
      const identity = managerRuntimeIdentity(value)
      if (!identity) throw new Error('Pi manager returned an invalid runtime status')
      this.#identity = identity
      if (
        this.#status.state === 'restarting' && identity.instanceId === this.#restartingInstanceId
      ) {
        this.#publish({
          state: 'unknown',
          canRestart: false,
          error: 'Pi manager reconnected without starting a new instance.',
        })
        return
      }
      this.#restartingInstanceId = undefined
      this.#compareRevisions()
    } catch (error) {
      if (verification === this.#verification && this.#manager.connected && !this.#restartRequested)
        this.#publish({ state: 'unknown', canRestart: false, error: errorMessage(error) })
    }
  }

  /** Converts the process identity and expected hash into the public runtime state. */
  #compareRevisions(): void {
    if (!this.#identity) {
      this.#publish({ state: 'unknown', canRestart: false })
      return
    }
    if (!this.#expectedRevision) {
      this.#publish(
        this.#revisionError
          ? { state: 'unknown', canRestart: false, error: this.#revisionError }
          : { state: 'checking', canRestart: false },
      )
      return
    }
    if (!this.#identity.runtimeRevision) {
      this.#publish({
        state: 'unknown',
        canRestart: false,
        error: 'Pi manager did not provide a runtime revision.',
      })
      return
    }
    const current = this.#identity.runtimeRevision === this.#expectedRevision
    this.#publish({
      state: current ? 'current' : 'stale',
      canRestart: !current && this.#identity.supervised,
    })
  }

  /** Keeps polling limited to the manifest and its declared runtime files. */
  #replaceWatchers(paths: string[]): void {
    const nextPaths = new Set(paths)
    for (const path of this.#watchedPaths) {
      if (!nextPaths.has(path)) unwatchFile(path, this.#scheduleRefresh)
    }
    for (const path of nextPaths) {
      if (!this.#watchedPaths.has(path)) watchFile(path, { interval: 750 }, this.#scheduleRefresh)
    }
    this.#watchedPaths = nextPaths
  }

  readonly #scheduleRefresh = (): void => {
    if (this.#refreshTimer) clearTimeout(this.#refreshTimer)
    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = undefined
      void this.#refreshExpectedRevision()
    }, 200)
  }

  /** Emits only observable state changes to avoid redundant SSE traffic. */
  #publish(status: ManagerRuntimeStatus): void {
    if (JSON.stringify(status) === JSON.stringify(this.#status)) return
    this.#status = status
    this.#onChange(status)
  }
}

function managerRuntimeIdentity(value: unknown): ManagerRuntimeIdentity | undefined {
  if (
    !isObject(value) || typeof value.instanceId !== 'string' || typeof value.startedAt !== 'string'
    || typeof value.supervised !== 'boolean'
  ) return undefined
  if (value.runtimeRevision !== null && typeof value.runtimeRevision !== 'string') return undefined
  return {
    instanceId: value.instanceId,
    startedAt: value.startedAt,
    runtimeRevision: value.runtimeRevision,
    supervised: value.supervised,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
