import { createReadStream } from 'node:fs'
import { readdir, realpath, stat } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { ManagerClient } from './manager-client.ts'
import { ManagerRuntimeMonitor } from './manager-runtime-monitor.ts'
import { listRecentPiSessions, loadPiSession, resolvePiSessions } from './pi-session-store.ts'
import {
  commitChanges,
  discardChanges,
  discardFileChanges,
  getGitFileDiff,
  getGitProject,
  getGitSnapshot,
  pullCommits,
  pushCommits,
  resetGitCommit,
  revertGitCommit,
} from './features/git/git.ts'
import { QuotaService } from './features/quotas/quota-service.ts'
import { EnvironmentService } from './features/session-environment/environment-service.ts'
import {
  ExtensionSettingsError,
  readExtensionSettings,
  updateExtensionSetting,
} from './features/extension-settings/extension-settings.ts'
import {
  PiSettingsError,
  readPiSettings,
  savePiSettingsDocument,
  updatePiSetting,
} from './features/pi-settings/pi-settings.ts'
import { openTerminalApplication, TerminalTemplateError } from './features/terminal/launcher.ts'
import { parseBrowserInputEvent, parseBrowserViewport } from './features/browser/browser-session.ts'
import { BrowserService, parseBrowserId } from './features/browser/browser-service.ts'
import {
  parseTerminalId,
  parseTerminalInput,
  parseTerminalResize,
  TerminalService,
} from './features/terminal/session.ts'
import {
  DiagnosticsRecorder,
  type SnapshotStageMeasurement,
} from './features/diagnostics/diagnostics.ts'
import { MetadataCache } from './features/session-metadata/metadata-cache.ts'
import { openSseStream, parseSseLastEventId } from './sse-response.ts'
import {
  openVSCodeApplication,
  readWorkspaceTitleBarColor,
  VSCodeSettingsError,
} from './features/vscode/launcher.ts'
import {
  listWorkspaceFiles,
  readWorkspaceFile,
  resolveWorkspaceFilePath,
  WorkspaceFileError,
} from './workspace-file.ts'
import {
  activeSessionMessages,
  LiveSessionEvents,
  sliceSnapshotDelta,
  snapshotCursor,
} from './session-snapshot.ts'
import { AppLog, slowSnapshotThresholdMs } from './features/app-log/app-log.ts'
import { loadPromptTemplates, savePromptTemplate } from './prompt-templates.ts'
import { responseControlsReport } from '../shared/response-controls.ts'
import { externalWorkspacePath, openPath } from './system-integration.ts'
import { expandHomePath } from './home-path.ts'
import type {
  ClientLogRequestBody,
  DirectoryListing,
  JsonObject,
  ManagerEvent,
  SessionSnapshot,
} from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'
import { providerFailure } from '../shared/provider-failure.ts'

const host = '127.0.0.1'
const port = readPort('PI_LIVECRAFT_BACKEND_PORT', 43_121)
const managerPort = readPort('PI_LIVECRAFT_MANAGER_PORT', 43_120)
const manager = new ManagerClient(host, managerPort)
const eventClients = new Set<ServerResponse>()
const liveSessionEvents = new Map<string, LiveSessionEvents>()
let piEventSequence = 0
const distDirectory = fileURLToPath(new URL('../dist/', import.meta.url))
const quotas = new QuotaService(manager)
const environment = new EnvironmentService(manager)
const diagnostics = new DiagnosticsRecorder()
const appLog = new AppLog(fileURLToPath(new URL('../pi-livecraft-app.log', import.meta.url)))
appLog.boot(process.pid)

/** Records one snapshot once in both bounded and persistent diagnostics. */
function recordSnapshot(stage: SnapshotStageMeasurement): void {
  diagnostics.snapshot(stage)
  if (stage.totalMs >= slowSnapshotThresholdMs) appLog.slowSnapshot(stage)
}
const metadata = new MetadataCache()
const browsers = new BrowserService()
process.once('exit', () => {
  appLog.shutdown('exit')
  browsers.killSync()
})
const terminals = new TerminalService()
process.once('exit', () => {
  appLog.shutdown('exit')
  terminals.killSync()
})
const managerRuntime = new ManagerRuntimeMonitor(manager, (status) => {
  broadcast({ kind: 'event', event: 'manager_status', sessionId: '', data: status })
})

manager.on('event', (event: ManagerEvent) => {
  quotas.receiveManagerEvent(event)
  environment.receiveManagerEvent(event)
  if (event.event === 'session_exited' || event.event === 'session_reassigned') {
    metadata.dropSession(event.sessionId)
    liveSessionEvents.delete(event.sessionId)
  }
  if (event.event === 'pi' && isObject(event.data)) {
    logProviderFailure(event.sessionId, event.data)
    const sequence = ++piEventSequence
    const live = liveSessionEvents.get(event.sessionId) ?? new LiveSessionEvents()
    liveSessionEvents.set(event.sessionId, live)
    live.receive(event.data, sequence)
    broadcast({ ...event, sequence })
    return
  }
  broadcast(event)
})
manager.on('connected', () => {
  appLog.manager('connected')
  managerRuntime.connected()
  metadata.clear()
  broadcast({ kind: 'event', event: 'manager_connected', sessionId: '' })
  void quotas.restoreFromIdleSession()
  void environment.restoreFromIdleSession()
})
manager.on('disconnected', () => {
  appLog.manager('disconnected')
  managerRuntime.disconnected()
  metadata.clear()
  broadcast({ kind: 'event', event: 'manager_disconnected', sessionId: '' })
})
managerRuntime.start()
manager.start()

// Default signal death skips 'exit' handlers, so clean stops must write their marker
// here; afterwards 'unknown' really means an abnormal end (SIGKILL, OOM, hard crash).
const stopForSignal = (): void => {
  appLog.shutdown('exit')
  process.exit(0)
}
process.on('SIGINT', stopForSignal)
process.on('SIGTERM', stopForSignal)

// Logging the fault keeps the terminal stack trace and the crash-restart behavior
// unchanged; the marker lets the next boot report the run as ended abruptly.
process.on('uncaughtException', (error: unknown) => {
  appLog.uncaught('uncaughtException', error)
  appLog.shutdown('crash')
  throw error
})
process.on('unhandledRejection', (reason: unknown) => {
  appLog.uncaught('unhandledRejection', reason)
})

const server = createServer((request, response) => {
  void route(request, response).catch((error) => {
    const status = error instanceof HttpError ? error.status : 500
    const route = (request.url ?? '').split('?')[0].replace(/sessions\/[^/]+/g, 'sessions/:id')
    diagnostics.error(route)
    appLog.requestError(route, status)
    if (!response.headersSent) sendJson(response, status, { error: errorMessage(error) })
    else response.end()
  })
})

server.listen(port, host, () => {
  console.log(`Pi backend listening on http://${host}:${port}`)
})

/** Centralizes HTTP routing so validation and responses remain consistent across endpoints. */
async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? 'GET'
  const url = new URL(request.url ?? '/', `http://${host}`)

  if (method === 'GET' && url.pathname === '/api/diagnostics') {
    diagnostics.request('diagnostics')
    sendJson(response, 200, diagnostics.snapshotState())
    return
  }

  if (method === 'POST' && url.pathname === '/api/client-log') {
    diagnostics.request('client-log')
    const body = await readJsonBody(request)
    if (!isClientLogBody(body))
      throw new HttpError(400, 'Client log needs a known source and a message')
    sendJson(response, 202, { logged: appLog.client(body) })
    return
  }

  if (method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, manager.connected ? 200 : 503, {
      ok: true,
      managerConnected: manager.connected,
    })
    return
  }

  if (method === 'GET' && url.pathname === '/api/events') {
    diagnostics.sseOpen()
    appLog.sseOpen()
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    response.write(
      `retry: 500\n\ndata: ${
        JSON.stringify({
          kind: 'event',
          event: manager.connected
            ? 'manager_connected'
            : 'manager_disconnected',
          sessionId: '',
        })
      }\n\n`,
    )
    response.write(
      `data: ${
        JSON.stringify({
          kind: 'event',
          event: 'manager_status',
          sessionId: '',
          data: managerRuntime.status,
        })
      }\n\n`,
    )
    eventClients.add(response)
    request.on('close', () => eventClients.delete(response))
    return
  }

  if (method === 'POST' && url.pathname === '/api/manager/restart') {
    await readJsonBody(request)
    try {
      await managerRuntime.restart()
    } catch (error) {
      throw new HttpError(manager.connected ? 409 : 503, errorMessage(error))
    }
    sendJson(response, 202, { accepted: true })
    return
  }

  if (method === 'GET' && url.pathname === '/api/sessions') {
    diagnostics.request('sessions')
    sendJson(response, 200, await manager.request({ action: 'list' }))
    return
  }

  if (method === 'GET' && url.pathname === '/api/quotas') {
    diagnostics.request('quotas')
    sendJson(response, 200, await quotas.snapshot())
    return
  }

  if (method === 'POST' && url.pathname === '/api/quotas/refresh') {
    const body = await readJsonBody(request)
    if (typeof body.sessionId !== 'string' || !body.sessionId)
      throw new HttpError(409, 'An open Pi session is required to refresh quotas.')
    sendJson(response, 200, await quotas.refresh(body.sessionId, body.automatic === true))
    return
  }

  if (method === 'POST' && url.pathname === '/api/quotas/reset') {
    const body = await readJsonBody(request)
    if (typeof body.sessionId !== 'string' || !body.sessionId)
      throw new HttpError(409, 'An open Pi session is required to redeem a reset.')
    const target = body.target === 'glm-five-hour' || body.target === 'glm-week'
      ? body.target
      : 'openai'
    sendJson(response, 200, await quotas.reset(body.sessionId, target))
    return
  }

  if (method === 'GET' && url.pathname === '/api/environment') {
    diagnostics.request('environment')
    const sessionId = url.searchParams.get('sessionId')
    if (!sessionId) throw new HttpError(400, 'A session identifier is required.')
    sendJson(response, 200, await environment.snapshot(sessionId))
    return
  }

  if (method === 'POST' && url.pathname === '/api/environment/refresh') {
    const body = await readJsonBody(request)
    if (typeof body.sessionId !== 'string' || !body.sessionId)
      throw new HttpError(409, 'An open Pi session is required to refresh the environment.')
    sendJson(response, 200, await environment.refresh(body.sessionId))
    return
  }

  if (method === 'GET' && url.pathname === '/api/extension-settings') {
    try {
      sendJson(response, 200, await readExtensionSettings())
    } catch (error) {
      if (error instanceof ExtensionSettingsError) throw new HttpError(409, error.message)
      throw error
    }
    return
  }

  if (method === 'POST' && url.pathname === '/api/extension-settings') {
    const body = await readJsonBody(request)
    if (typeof body.extension !== 'string' || typeof body.id !== 'string')
      throw new HttpError(400, 'Extension and setting identifiers are required')
    try {
      sendJson(response, 200, await updateExtensionSetting(body.extension, body.id, body.value))
    } catch (error) {
      if (error instanceof ExtensionSettingsError) throw new HttpError(400, error.message)
      throw error
    }
    return
  }

  if (method === 'GET' && url.pathname === '/api/pi-settings') {
    const cwdParam = url.searchParams.get('cwd')
    const cwd = cwdParam ? await resolveWorkingDirectory(cwdParam) : undefined
    try {
      sendJson(response, 200, await readPiSettings(cwd))
    } catch (error) {
      if (error instanceof PiSettingsError) throw new HttpError(409, error.message)
      throw error
    }
    return
  }

  if (method === 'POST' && url.pathname === '/api/pi-settings') {
    const body = await readJsonBody(request)
    if (body.scope !== 'global' && body.scope !== 'project')
      throw new HttpError(400, 'A settings scope of “global” or “project” is required')
    if (typeof body.id !== 'string') throw new HttpError(400, 'A setting identifier is required')
    const cwd = typeof body.cwd === 'string' && body.cwd
      ? await resolveWorkingDirectory(body.cwd)
      : undefined
    try {
      sendJson(response, 200, await updatePiSetting(body.scope, cwd, body.id, body.value))
    } catch (error) {
      if (error instanceof PiSettingsError) throw new HttpError(400, error.message)
      throw error
    }
    return
  }

  if (method === 'PUT' && url.pathname === '/api/pi-settings/document') {
    const body = await readJsonBody(request)
    if (body.scope !== 'global' && body.scope !== 'project')
      throw new HttpError(400, 'A settings scope of “global” or “project” is required')
    if (typeof body.text !== 'string') throw new HttpError(400, 'Document text is required')
    const cwd = typeof body.cwd === 'string' && body.cwd
      ? await resolveWorkingDirectory(body.cwd)
      : undefined
    try {
      sendJson(response, 200, await savePiSettingsDocument(body.scope, cwd, body.text))
    } catch (error) {
      if (error instanceof PiSettingsError) throw new HttpError(400, error.message)
      throw error
    }
    return
  }

  if (method === 'GET' && url.pathname === '/api/sessions/recent') {
    diagnostics.request('sessions/recent')
    const cwd = await resolveWorkingDirectory(url.searchParams.get('cwd') ?? '~/.pi')
    sendJson(response, 200, await listRecentPiSessions(cwd))
    return
  }

  if (method === 'POST' && url.pathname === '/api/sessions/resolve') {
    const body = await readJsonBody(request)
    if (!Array.isArray(body.paths)) throw new HttpError(400, 'Session paths are required')
    const paths = body.paths.filter((path: unknown): path is string =>
      typeof path === 'string' && path.length > 0
    )
    sendJson(response, 200, await resolvePiSessions(paths))
    return
  }

  if (method === 'GET' && url.pathname === '/api/directories') {
    sendJson(response, 200, await listDirectories(url.searchParams.get('path') ?? '~/.pi'))
    return
  }

  if (method === 'POST' && url.pathname === '/api/explorer') {
    const body = await readJsonBody(request)
    if (typeof body.cwd !== 'string') throw new HttpError(400, 'Working directory is required')
    await openPath(await resolveWorkingDirectory(body.cwd))
    sendJson(response, 200, {})
    return
  }

  if (method === 'GET' && url.pathname === '/api/git') {
    diagnostics.request('git')
    const cwd = await resolveWorkingDirectory(url.searchParams.get('cwd') ?? '~/.pi')
    sendJson(response, 200, await getGitSnapshot(cwd))
    return
  }

  if (method === 'GET' && url.pathname === '/api/git/project') {
    const cwd = await resolveWorkingDirectory(url.searchParams.get('cwd') ?? '~/.pi')
    const project = await getGitProject(cwd)
    if (!project) throw new HttpError(400, 'Choose a directory inside a Git repository.')
    sendJson(response, 200, project)
    return
  }

  if (method === 'GET' && url.pathname === '/api/git/diff') {
    const cwd = await resolveWorkingDirectory(url.searchParams.get('cwd') ?? '~/.pi')
    const path = url.searchParams.get('path')
    if (!path) throw new HttpError(400, 'File path is required')
    sendJson(
      response,
      200,
      await getGitFileDiff(cwd, path, url.searchParams.get('commit') ?? undefined),
    )
    return
  }

  if (method === 'GET' && url.pathname === '/api/files/list') {
    const cwd = await resolveWorkingDirectory(url.searchParams.get('cwd') ?? '~/.pi')
    try {
      sendJson(response, 200, await listWorkspaceFiles(cwd, url.searchParams.get('path') ?? ''))
    } catch (error) {
      if (error instanceof WorkspaceFileError) throw new HttpError(error.status, error.message)
      throw error
    }
    return
  }

  if (method === 'GET' && (url.pathname === '/api/files' || url.pathname === '/api/files/path')) {
    const cwd = await resolveWorkingDirectory(url.searchParams.get('cwd') ?? '~/.pi')
    const path = url.searchParams.get('path')
    if (!path) throw new HttpError(400, 'File path is required')
    try {
      const file = await readWorkspaceFile(cwd, path)
      sendJson(
        response,
        200,
        url.pathname === '/api/files'
          ? file
          : { absolutePath: file.path, path: await externalWorkspacePath(file.path) },
      )
    } catch (error) {
      if (error instanceof WorkspaceFileError) throw new HttpError(error.status, error.message)
      throw error
    }
    return
  }

  if (method === 'POST' && url.pathname === '/api/files/open') {
    const body = await readJsonBody(request)
    if (typeof body.cwd !== 'string') throw new HttpError(400, 'Working directory is required')
    if (typeof body.path !== 'string' || !body.path)
      throw new HttpError(400, 'File path is required')
    try {
      const cwd = await resolveWorkingDirectory(body.cwd)
      await openPath(await resolveWorkspaceFilePath(cwd, body.path, true))
      sendJson(response, 200, {})
    } catch (error) {
      if (error instanceof WorkspaceFileError) throw new HttpError(error.status, error.message)
      throw error
    }
    return
  }

  if (method === 'GET' && url.pathname === '/api/vscode/titlebar-color') {
    const cwd = await resolveWorkingDirectory(url.searchParams.get('cwd') ?? '~/.pi')
    sendJson(response, 200, { color: await readWorkspaceTitleBarColor(cwd) })
    return
  }

  if (method === 'POST' && url.pathname === '/api/vscode') {
    const body = await readJsonBody(request)
    if (typeof body.cwd !== 'string') throw new HttpError(400, 'Working directory is required')
    if (
      typeof body.projectName !== 'string' || typeof body.workspaceName !== 'string'
      || typeof body.color !== 'string' || typeof body.isMainWorktree !== 'boolean'
    ) throw new HttpError(400, 'VS Code workspace identity is required')
    try {
      await openVSCodeApplication(await resolveWorkingDirectory(body.cwd), {
        projectName: body.projectName,
        workspaceName: body.workspaceName,
        color: body.color,
        isMainWorktree: body.isMainWorktree,
      })
      sendJson(response, 200, { ok: true })
    } catch (error) {
      if (error instanceof VSCodeSettingsError) throw new HttpError(400, error.message)
      throw error
    }
    return
  }

  if (method === 'POST' && url.pathname === '/api/terminal') {
    const body = await readJsonBody(request)
    if (typeof body.cwd !== 'string') throw new HttpError(400, 'Working directory is required')
    const template = typeof body.template === 'string' && body.template.trim()
      ? body.template
      : undefined
    if (template !== undefined && template.length > 2000)
      throw new HttpError(400, 'Terminal command template is too long')
    try {
      await openTerminalApplication(await resolveWorkingDirectory(body.cwd), template)
      sendJson(response, 200, { ok: true })
    } catch (error) {
      if (error instanceof TerminalTemplateError) throw new HttpError(400, error.message)
      throw error
    }
    return
  }

  if (method === 'POST' && url.pathname === '/api/git/commit') {
    const body = await readJsonBody(request)
    if (typeof body.cwd !== 'string') throw new HttpError(400, 'Working directory is required')
    const cwd = await resolveWorkingDirectory(body.cwd)
    const message = typeof body.message === 'string' ? body.message : ''
    await commitChanges(cwd, message)
    sendJson(response, 200, { ok: true })
    return
  }

  if (method === 'POST' && url.pathname === '/api/git/pull') {
    const body = await readJsonBody(request)
    if (typeof body.cwd !== 'string') throw new HttpError(400, 'Working directory is required')
    await pullCommits(await resolveWorkingDirectory(body.cwd))
    sendJson(response, 200, { ok: true })
    return
  }

  if (method === 'POST' && url.pathname === '/api/git/push') {
    const body = await readJsonBody(request)
    if (typeof body.cwd !== 'string') throw new HttpError(400, 'Working directory is required')
    const cwd = await resolveWorkingDirectory(body.cwd)
    sendJson(response, 200, await pushCommits(cwd))
    return
  }

  if (method === 'POST' && url.pathname === '/api/git/discard') {
    const body = await readJsonBody(request)
    if (typeof body.cwd !== 'string') throw new HttpError(400, 'Working directory is required')
    const cwd = await resolveWorkingDirectory(body.cwd)
    if (typeof body.path === 'string') await discardFileChanges(cwd, body.path)
    else await discardChanges(cwd)
    sendJson(response, 200, { ok: true })
    return
  }

  if (method === 'POST' && url.pathname === '/api/git/reset') {
    const body = await readJsonBody(request)
    if (typeof body.cwd !== 'string' || typeof body.hash !== 'string')
      throw new HttpError(400, 'Working directory and commit hash are required')
    const cwd = await resolveWorkingDirectory(body.cwd)
    sendJson(response, 200, await resetGitCommit(cwd, body.hash))
    return
  }

  if (method === 'POST' && url.pathname === '/api/git/revert') {
    const body = await readJsonBody(request)
    if (typeof body.cwd !== 'string' || typeof body.hash !== 'string')
      throw new HttpError(400, 'Working directory and commit hash are required')
    const cwd = await resolveWorkingDirectory(body.cwd)
    sendJson(response, 200, await revertGitCommit(cwd, body.hash))
    return
  }

  if (method === 'POST' && url.pathname === '/api/prompts') {
    const body = await readJsonBody(request)
    if (typeof body.cwd !== 'string') throw new HttpError(400, 'Working directory is required')
    if (body.scope !== 'project' && body.scope !== 'global')
      throw new HttpError(400, 'Prompt scope must be project or global')
    if (typeof body.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(body.name))
      throw new HttpError(
        400,
        'Prompt name must use 1–80 letters, numbers, hyphens, or underscores',
      )
    if (typeof body.content !== 'string' || !body.content.trim() || body.content.length > 100_000)
      throw new HttpError(400, 'Prompt content must contain between 1 and 100,000 characters')
    try {
      const cwd = await resolveWorkingDirectory(body.cwd)
      const saved = await savePromptTemplate(cwd, body.scope, body.name, body.content)
      metadata.invalidatePrefix('templates:')
      sendJson(response, 201, saved)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new HttpError(409, `Prompt “${body.name}” already exists in this location`)
      throw error
    }
    return
  }

  if (method === 'POST' && url.pathname === '/api/sessions/rename') {
    const body = await readJsonBody(request)
    if (typeof body.cwd !== 'string' || typeof body.sessionPath !== 'string') {
      throw new HttpError(400, 'Working directory and session path are required')
    }
    if (
      typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120
      || /[\r\n]/.test(body.name)
    ) throw new HttpError(400, 'Session name must contain between 1 and 120 characters')
    const cwd = await resolveWorkingDirectory(body.cwd)
    const session = await loadPiSession(body.sessionPath)
    if (session.cwd !== cwd)
      throw new HttpError(400, 'Pi session does not belong to this working directory')
    await manager.request({
      action: 'rename',
      cwd,
      name: body.name.trim(),
      sessionPath: session.sessionPath,
    })
    sendJson(response, 200, { name: body.name.trim() })
    return
  }

  if (method === 'POST' && url.pathname === '/api/sessions') {
    const body = await readJsonBody(request)
    const cwd = await resolveWorkingDirectory(typeof body.cwd === 'string' ? body.cwd : '~/.pi')
    if (typeof body.sessionPath === 'string') {
      const session = await loadPiSession(body.sessionPath)
      if (session.cwd !== cwd)
        throw new HttpError(400, 'Pi session does not belong to this working directory')
      sendJson(
        response,
        201,
        await manager.request({
          action: 'open',
          cwd,
          name: session.name,
          sessionPath: session.sessionPath,
        }),
      )
      return
    }
    const session = await manager.request({ action: 'create', cwd })
    sendJson(response, 201, session)
    return
  }

  const closeMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/close$/)
  if (method === 'POST' && closeMatch) {
    await readJsonBody(request)
    await manager.request({
      action: 'close',
      sessionId: decodeURIComponent(closeMatch[1]),
    })
    sendJson(response, 200, { closed: true })
    return
  }

  const snapshotMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/snapshot$/)
  if (method === 'GET' && snapshotMatch) {
    const sessionId = decodeURIComponent(snapshotMatch[1])
    const since = url.searchParams.get('since') ?? ''
    const snapshotStartedAt = performance.now()
    // State, entries, and stats must stay fresh; models, commands, thinking levels, fork
    // messages, and templates go through the metadata cache (see its README policy table).
    const statePromise = piCommand(sessionId, { type: 'get_state' })
    const entriesPromise = piCommand(sessionId, { type: 'get_entries' })
    const statsPromise = piCommand(sessionId, { type: 'get_session_stats' })
    const modelsResult = await metadata.load(
      `models:${sessionId}`,
      async () => arrayData(await piCommand(sessionId, { type: 'get_available_models' }), 'models'),
    )
    const commandsResult = await metadata.load(
      `commands:${sessionId}`,
      async () => arrayData(await piCommand(sessionId, { type: 'get_commands' }), 'commands'),
    )
    const forkResult = await metadata.load(
      `fork:${sessionId}`,
      async () => arrayData(await piCommand(sessionId, { type: 'get_fork_messages' }), 'messages'),
    )
    const state = await statePromise
    const stateData = objectData(state)
    const modelId = typeof stateData?.model === 'string' ? stateData.model : ''
    const thinkingResult = await metadata.load(
      `thinking:${sessionId}`,
      async () =>
        stringArrayData(
          await piCommand(sessionId, { type: 'get_available_thinking_levels' }),
          'levels',
        ),
      modelId,
    )
    for (const result of [modelsResult, commandsResult, forkResult, thinkingResult]) {
      if (result.cached) diagnostics.cacheHit()
      else diagnostics.cacheMiss()
    }
    const [entries, models, commands, stats, forkMessages, thinkingLevels] = await Promise.all([
      entriesPromise,
      modelsResult.value,
      commandsResult.value,
      statsPromise,
      forkResult.value,
      thinkingResult.value,
    ])
    const rpcMs = Math.round((performance.now() - snapshotStartedAt) * 100) / 100
    const commandList = commands
    const forkEntryIds = new Set(
      forkMessages.flatMap((message) =>
        typeof message.entryId === 'string' ? [message.entryId] : []
      ),
    )
    const buildStartedAt = performance.now()
    const messages = activeSessionMessages(
      arrayData(entries, 'entries'),
      objectData(entries)?.leafId,
      forkEntryIds,
    )
    const buildMs = Math.round((performance.now() - buildStartedAt) * 100) / 100
    const templatesStartedAt = performance.now()
    const templatesResult = await metadata.load(
      `templates:${sessionId}`,
      () => loadPromptTemplates(commandList),
    )
    if (templatesResult.cached) diagnostics.cacheHit()
    else diagnostics.cacheMiss()
    const promptTemplates = templatesResult.value
    const templatesMs = Math.round((performance.now() - templatesStartedAt) * 100) / 100
    const cursor = snapshotCursor(messages)
    const delta = since === '' ? undefined : sliceSnapshotDelta(messages, since)
    if (delta?.mode === 'delta') {
      const bytes = sendJson(response, 200, {
        state: stateData,
        models,
        thinkingLevels,
        responseControls: responseControlsReport(
          arrayData(entries, 'entries'),
          objectData(entries)?.leafId,
          stateData?.model,
          commandList.some((command) => command.name === 'livecraft-response-controls'),
        ),
        commands: commandList,
        promptTemplates,
        stats: objectData(stats),
        liveEvents: liveSessionEvents.get(sessionId)?.snapshot() ?? [],
        mode: 'delta',
        appended: delta.appended,
        cursor: delta.cursor,
      })
      const deltaTotalMs = Math.round((performance.now() - snapshotStartedAt) * 100) / 100
      recordSnapshot({
        rpcMs,
        buildMs,
        templatesMs,
        totalMs: deltaTotalMs,
        bytes,
        mode: 'delta',
      })
      return
    }
    const snapshot: SessionSnapshot = {
      state: stateData,
      messages,
      models,
      thinkingLevels,
      responseControls: responseControlsReport(
        arrayData(entries, 'entries'),
        objectData(entries)?.leafId,
        stateData?.model,
        commandList.some((command) => command.name === 'livecraft-response-controls'),
      ),
      commands: commandList,
      promptTemplates,
      stats: objectData(stats),
      liveEvents: liveSessionEvents.get(sessionId)?.snapshot() ?? [],
      cursor,
    }
    const bytes = sendJson(response, 200, snapshot)
    const fullTotalMs = Math.round((performance.now() - snapshotStartedAt) * 100) / 100
    recordSnapshot({
      rpcMs,
      buildMs,
      templatesMs,
      totalMs: fullTotalMs,
      bytes,
      mode: 'full',
    })
    return
  }

  const promptImprovementMatch = url.pathname.match(
    /^\/api\/sessions\/([^/]+)\/prompt-improvement$/,
  )
  if (method === 'POST' && promptImprovementMatch) {
    const body = await readJsonBody(request)
    if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 100_000) {
      throw new HttpError(400, 'A prompt between 1 and 100,000 characters is required')
    }
    if (body.direction !== undefined && typeof body.direction !== 'string') {
      throw new HttpError(400, 'Direction must be a string when provided')
    }
    const data = await manager.request({
      action: 'improve_prompt',
      sessionId: decodeURIComponent(promptImprovementMatch[1]),
      prompt: body.prompt,
      direction: body.direction,
    }, 3 * 60_000)
    sendJson(response, 200, data)
    return
  }

  const runPromptMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/run-prompt$/)
  if (method === 'POST' && runPromptMatch) {
    const body = await readJsonBody(request)
    if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 100_000) {
      throw new HttpError(400, 'A prompt between 1 and 100,000 characters is required')
    }
    const data = await manager.request({
      action: 'run_prompt',
      sessionId: decodeURIComponent(runPromptMatch[1]),
      prompt: body.prompt,
      systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt : undefined,
      thinkingLevel: typeof body.thinkingLevel === 'string' ? body.thinkingLevel : undefined,
      model: isModelBody(body.model),
      extensions: Array.isArray(body.extensions)
        ? body.extensions.filter((e: unknown): e is string => typeof e === 'string')
        : undefined,
      tools: Array.isArray(body.tools)
        ? body.tools.filter((t: unknown): t is string => typeof t === 'string')
        : undefined,
      includeContextFiles: typeof body.includeContextFiles === 'boolean'
        ? body.includeContextFiles
        : undefined,
    }, 5 * 60_000)
    sendJson(response, 200, data)
    return
  }

  const commandMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/commands$/)
  if (method === 'POST' && commandMatch) {
    const command = await readJsonBody(request)
    if (typeof command.type !== 'string' || command.type.length > 100)
      throw new HttpError(400, 'A valid Pi command type is required')
    const data = await manager.request(
      { action: 'command', sessionId: decodeURIComponent(commandMatch[1]), command },
      10 * 60_000,
    )
    sendJson(response, 200, data)
    return
  }

  if (method === 'GET' && url.pathname === '/api/browser/debug') {
    const snapshot = await browsers.debugSnapshot()
    const requestedWorkspace = url.searchParams.get('workspacePath')
    const currentWorkspacePath = requestedWorkspace === null
      ? undefined
      : await resolveBrowserWorkspace(requestedWorkspace)
    sendJson(response, 200, { ...snapshot, currentWorkspacePath })
    return
  }

  const browserInstanceMatch = url.pathname.match(
    /^\/api\/browser\/instances\/([^/]+)\/(status|start|stop|navigate|viewport|input|frames)$/,
  )
  if (browserInstanceMatch) {
    const browserId = parseBrowserId(decodeURIComponent(browserInstanceMatch[1]))
    if (!browserId) throw new HttpError(400, 'A valid browser ID is required')
    const action = browserInstanceMatch[2]

    if (method === 'GET' && (action === 'status' || action === 'frames')) {
      const workspacePath = await resolveBrowserWorkspace(
        url.searchParams.get('workspacePath'),
      )
      const browserSession = browsers.session(workspacePath, browserId)
      if (action === 'status') {
        sendJson(response, 200, browserSession.status())
        return
      }
      const stream = openSseStream(response)
      const writeEvent = (event: string, json: string): void => {
        if (event === 'frame' && stream.writableLength > 512 * 1024) return
        stream.writeEvent(event, json)
      }
      writeEvent('status', JSON.stringify(browserSession.status()))
      const currentUrl = browserSession.status().url
      if (currentUrl) writeEvent('url', JSON.stringify({ url: currentUrl }))
      const unsubscribe = browserSession.subscribe((event, json) => writeEvent(event, json))
      browserSession.addViewer()
      request.on('close', () => {
        unsubscribe()
        browserSession.releaseViewer()
      })
      return
    }

    if (method === 'POST') {
      const body = await readJsonBody(request)
      const workspacePath = await resolveBrowserWorkspace(body.workspacePath)
      const browserSession = browsers.session(workspacePath, browserId)
      if (action === 'start') {
        try {
          sendJson(response, 200, await browserSession.start())
        } catch (error) {
          throw new HttpError(400, errorMessage(error))
        }
        return
      }
      if (action === 'stop') {
        await browserSession.stop()
        sendJson(response, 200, { ok: true })
        return
      }
      if (action === 'navigate') {
        if (typeof body.url !== 'string' || !body.url)
          throw new HttpError(400, 'A URL is required')
        try {
          await browserSession.navigate(body.url)
        } catch {
          throw new HttpError(409, 'The browser session is not live')
        }
        sendJson(response, 200, { ok: true })
        return
      }
      if (action === 'viewport') {
        const viewport = parseBrowserViewport(body)
        if (!viewport) throw new HttpError(400, 'A valid viewport is required')
        await browserSession.setViewport(viewport)
        sendJson(response, 200, browserSession.status())
        return
      }
      if (action === 'input') {
        const input = parseBrowserInputEvent(body)
        if (!input) throw new HttpError(400, 'Invalid browser input event')
        try {
          await browserSession.dispatchInput(input)
        } catch {
          throw new HttpError(409, 'The browser session is not live')
        }
        sendJson(response, 200, { ok: true })
        return
      }
    }
  }

  const terminalInstanceMatch = url.pathname.match(
    /^\/api\/terminal\/instances\/([^/]+)\/(status|stream|start|stop|input|resize)$/,
  )
  if (terminalInstanceMatch) {
    const terminalId = parseTerminalId(decodeURIComponent(terminalInstanceMatch[1]))
    if (!terminalId) throw new HttpError(400, 'A valid terminal ID is required')
    const action = terminalInstanceMatch[2]

    if (method === 'GET' && (action === 'status' || action === 'stream')) {
      const workspacePath = await resolveBrowserWorkspace(
        url.searchParams.get('workspacePath'),
      )
      const terminalSession = terminals.session(workspacePath, terminalId)
      if (!terminalSession) {
        throw new HttpError(429, 'Too many terminal sessions for this workspace')
      }
      if (action === 'status') {
        sendJson(response, 200, terminalSession.status())
        return
      }
      const stream = openSseStream(response)
      const lastEventId = parseSseLastEventId(request.headers['last-event-id'])
        ?? parseSseLastEventId(url.searchParams.get('lastEventId'))
      for (const item of terminalSession.replay(lastEventId)) {
        stream.writeEvent(item.name, item.json, item.id)
      }
      const subscription = terminalSession.subscribe((event, json, id) => {
        if (!stream.writeEvent(event, json, id)) subscription.setCongested(true)
      })
      const drain = (): void => subscription.setCongested(false)
      response.on('drain', drain)
      request.on('close', () => {
        subscription.setCongested(false)
        subscription.unsubscribe()
        response.off('drain', drain)
      })
      return
    }

    if (method === 'POST') {
      const body = await readJsonBody(request)
      const workspacePath = await resolveBrowserWorkspace(body.workspacePath)
      const terminalSession = terminals.session(workspacePath, terminalId)
      if (!terminalSession) {
        throw new HttpError(429, 'Too many terminal sessions for this workspace')
      }
      if (action === 'start') {
        try {
          sendJson(response, 200, await terminalSession.start())
        } catch (error) {
          throw new HttpError(400, errorMessage(error))
        }
        return
      }
      if (action === 'stop') {
        terminalSession.stop()
        sendJson(response, 200, { ok: true })
        return
      }
      if (action === 'input') {
        const data = parseTerminalInput(body)
        if (data === null) throw new HttpError(400, 'Invalid terminal input payload')
        terminalSession.write(data)
        sendJson(response, 200, { ok: true })
        return
      }
      if (action === 'resize') {
        const resize = parseTerminalResize(body)
        if (!resize) throw new HttpError(400, 'A valid terminal size is required')
        terminalSession.resize(resize.cols, resize.rows)
        sendJson(response, 200, terminalSession.status())
        return
      }
    }
  }

  const browserInstanceRootMatch = url.pathname.match(/^\/api\/browser\/instances\/([^/]+)$/)
  if (method === 'DELETE' && browserInstanceRootMatch) {
    const browserId = parseBrowserId(decodeURIComponent(browserInstanceRootMatch[1]))
    if (!browserId) throw new HttpError(400, 'A valid browser ID is required')
    const workspacePath = await resolveBrowserWorkspace(url.searchParams.get('workspacePath'))
    await browsers.remove(workspacePath, browserId)
    sendJson(response, 200, { ok: true })
    return
  }

  if (method === 'GET' || method === 'HEAD') {
    await serveStatic(url.pathname, method, response)
    return
  }

  sendJson(response, 404, { error: 'Not found' })
}

async function piCommand(sessionId: string, command: JsonObject): Promise<JsonObject> {
  const response = await manager.request({ action: 'command', sessionId, command })
  if (!isObject(response)) throw new Error('Invalid response from Pi manager')
  return response
}

function objectData(response: JsonObject): JsonObject | null {
  return isObject(response.data) ? response.data : null
}

function arrayData(response: JsonObject, key: string): JsonObject[] {
  if (!isObject(response.data) || !Array.isArray(response.data[key])) return []
  return response.data[key].filter(isObject)
}

/** Reads a string array field from a Pi response, tolerating non-string members. */
function stringArrayData(response: JsonObject, key: string): string[] {
  if (!isObject(response.data) || !Array.isArray(response.data[key])) return []
  return response.data[key].filter((item): item is string => typeof item === 'string')
}

/** Reads and canonicalizes the workspace key used by browser and terminal instance routes. */
async function resolveBrowserWorkspace(value: unknown): Promise<string> {
  if (typeof value !== 'string') throw new HttpError(400, 'Browser workspace is required')
  return resolveWorkingDirectory(value)
}

/** Canonicalizes a client-provided path and rejects missing paths or non-directories. */
async function resolveWorkingDirectory(input: string): Promise<string> {
  const trimmed = input.trim()
  if (!trimmed) throw new HttpError(400, 'Working directory is required')
  const expanded = expandHomePath(trimmed)
  let canonical: string
  try {
    canonical = await realpath(expanded)
  } catch {
    throw new HttpError(400, 'Working directory does not exist')
  }
  if (!(await stat(canonical)).isDirectory())
    throw new HttpError(400, 'Working directory must be a directory')
  return canonical
}

/** Returns only accessible subdirectories, with a navigable parent for the picker. */
async function listDirectories(path: string): Promise<DirectoryListing> {
  const canonicalPath = await resolveWorkingDirectory(path)
  const entries = await readdir(canonicalPath, { withFileTypes: true })
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, path: resolve(canonicalPath, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name))
  const parent = dirname(canonicalPath)
  return { path: canonicalPath, parentPath: parent === canonicalPath ? null : parent, directories }
}

/** Reads the JSON body with a size limit to protect the backend from oversized requests. */
async function readJsonBody(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 2 * 1024 * 1024) throw new HttpError(413, 'Request body exceeds 2 MiB')
    chunks.push(buffer)
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!isObject(value)) throw new Error('Expected an object')
    return value
  } catch {
    throw new HttpError(400, 'Invalid JSON body')
  }
}

/** Serves the frontend build while preventing an HTTP path from escaping the distribution directory. */
async function serveStatic(
  pathname: string,
  method: string,
  response: ServerResponse,
): Promise<void> {
  const requestedPath = pathname === '/' ? 'index.html' : pathname.slice(1)
  let filePath = resolve(distDirectory, requestedPath)
  if (!filePath.startsWith(`${resolve(distDirectory)}${sep}`)) throw new HttpError(404, 'Not found')

  try {
    if (!(await stat(filePath)).isFile()) throw new Error('Not a file')
  } catch {
    filePath = resolve(distDirectory, 'index.html')
    try {
      if (!(await stat(filePath)).isFile()) throw new Error('Missing build')
    } catch {
      throw new HttpError(404, 'Frontend build not found; run npm run build')
    }
  }

  response.writeHead(200, { 'Content-Type': contentType(filePath) })
  if (method === 'HEAD') response.end()
  else createReadStream(filePath).pipe(response)
}

function broadcast(event: unknown): void {
  const frame = `data: ${JSON.stringify(event)}\n\n`
  for (const client of eventClients) client.write(frame)
}

function sendJson(response: ServerResponse, status: number, value: unknown): number {
  const body = JSON.stringify(value)
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(body)
  return body.length
}

/** Maps a file extension to the MIME type served in the HTTP response. */
function contentType(filePath: string): string {
  const types: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
  }
  return types[extname(filePath)] ?? 'application/octet-stream'
}
function isModelBody(value: unknown): { provider: string; modelId: string } | undefined {
  if (!isObject(value) || typeof value.provider !== 'string' || typeof value.modelId !== 'string')
    return undefined
  return { provider: value.provider, modelId: value.modelId }
}

/** Logs only the safe summary Pi stores for an unsuccessful provider response. */
/** Validates the client-log body without trusting client input. */
function isClientLogBody(body: unknown): body is ClientLogRequestBody {
  if (!isObject(body)) return false
  const knownSources = [
    'window-error',
    'unhandled-rejection',
    'fetch-failure',
    'sse-drop',
    'sse-reopen',
  ]
  return typeof body.source === 'string'
    && knownSources.includes(body.source)
    && typeof body.message === 'string'
    && body.message.trim() !== ''
    && body.message.length <= 500
}

function logProviderFailure(sessionId: string, event: JsonObject): void {
  if (event.type !== 'message_end' || !isObject(event.message)) return
  const failure = providerFailure(event.message)
  if (!failure) return
  const model = failure.model ? `, model ${logLine(failure.model)}` : ''
  console.error(
    `Pi provider request failed (session ${sessionId}${model}): ${logLine(failure.errorMessage)}`,
  )
  appLog.providerFailure(failure.model ?? '', failure.errorMessage)
}

/** Keeps provider-controlled error text to one readable log line. */
function logLine(value: string): string {
  const normalized = value.replace(/\s+/g, ' ')
  return normalized.length > 1_000 ? `${normalized.slice(0, 997)}...` : normalized
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Reads and validates a port from the environment, using the supplied default when unset. */
function readPort(primary: string, fallback: number): number {
  const value = Number(process.env[primary] ?? fallback)
  if (!Number.isInteger(value) || value < 1 || value > 65_535)
    throw new Error(`${primary} must be a valid port`)
  return value
}

class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
