import type {
  BrowserInstanceDebugSnapshot,
  BrowserSystemDebugSnapshot,
} from '../../../shared/types.ts'
import { browserDebugPortFor } from '../../../shared/browser-port.ts'
import { BrowserSession } from './browser-session.ts'

const browserIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/

/** Validates the opaque browser ID used in scoped API routes. */
export function parseBrowserId(value: unknown): string | null {
  return typeof value === 'string' && browserIdPattern.test(value) ? value : null
}

/** Owns browser instances grouped by canonical workspace path. */
export class BrowserService {
  readonly #workspaces = new Map<string, Map<string, BrowserSession>>()
  readonly #createSession: (debugPortBase: number) => BrowserSession

  constructor(
    createSession: (debugPortBase: number) => BrowserSession = (debugPortBase) =>
      new BrowserSession({ debugPortBase }),
  ) {
    this.#createSession = createSession
  }

  /** Returns the stable session object for one workspace and browser ID. */
  session(workspacePath: string, browserId: string): BrowserSession {
    let workspace = this.#workspaces.get(workspacePath)
    if (!workspace) {
      workspace = new Map()
      this.#workspaces.set(workspacePath, workspace)
    }
    let session = workspace.get(browserId)
    if (!session) {
      session = this.#createSession(browserDebugPortFor(workspacePath, browserId))
      workspace.set(browserId, session)
    }
    return session
  }

  /** Stops and removes one instance. Existing views must reconnect before reuse. */
  async remove(workspacePath: string, browserId: string): Promise<void> {
    const workspace = this.#workspaces.get(workspacePath)
    const session = workspace?.get(browserId)
    if (!workspace || !session) return
    await session.stop()
    workspace.delete(browserId)
    if (workspace.size === 0) this.#workspaces.delete(workspacePath)
  }

  /** Returns all registered instances for the installation, grouped by workspace. */
  async debugSnapshot(): Promise<BrowserSystemDebugSnapshot> {
    const workspaces = await Promise.all(
      [...this.#workspaces.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(async ([workspacePath, sessions]) => ({
          workspacePath,
          instances: await Promise.all(
            [...sessions.entries()]
              .sort(([left], [right]) => left.localeCompare(right))
              .map(async ([browserId, session]): Promise<BrowserInstanceDebugSnapshot> => ({
                browserId,
                ...(await session.debugSnapshot()),
              })),
          ),
        })),
    )
    return { sampledAt: Date.now(), workspaces }
  }

  /** Stops every registered Chrome instance and keeps the registry reusable. */
  async stopAll(): Promise<void> {
    await Promise.all(
      [...this.#workspaces.values()].flatMap((workspace) =>
        [...workspace.values()].map((session) => session.stop())
      ),
    )
  }

  /** Synchronous last-resort cleanup for backend exit. */
  killSync(): void {
    for (const workspace of this.#workspaces.values()) {
      for (const session of workspace.values()) session.killSync()
    }
  }
}
