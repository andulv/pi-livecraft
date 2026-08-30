import { spawn, type ChildProcess } from 'node:child_process'
import { access, constants, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const endpointReadyTimeoutMs = 15_000

export class BrowserLaunchError extends Error {}

/** Extracts the DevTools WebSocket endpoint Chrome prints on startup. */
export function parseDevToolsEndpoint(output: string): string | null {
  return output.match(/^DevTools listening on (ws:\/\/\S+)$/m)?.[1] ?? null
}

/** Candidate browser binaries for a platform, most preferred first. */
export function browserBinaryCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): readonly string[] {
  if (platform === 'win32') {
    const programFiles = env['PROGRAMFILES'] ?? toWindowsPath('C:', 'Program Files')
    const localAppData = env['LOCALAPPDATA']
      ?? toWindowsPath(env['USERPROFILE'] ?? 'C:', 'AppData', 'Local')
    return [
      toWindowsPath(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      toWindowsPath(`${programFiles} (x86)`, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      toWindowsPath(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ]
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ]
  }
  return [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ]
}

/** Joins Windows path segments regardless of the host platform. */
function toWindowsPath(...segments: string[]): string {
  return segments.join('\\')
}

/** Resolves the browser binary: explicit override first, then platform candidates. */
export async function resolveBrowserBinary(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  exists: (path: string) => Promise<boolean> = fileExists,
): Promise<string> {
  const override = env['PI_LIVECRAFT_BROWSER_BIN']
  if (override) {
    if (await exists(override)) return override
    throw new BrowserLaunchError(
      `PI_LIVECRAFT_BROWSER_BIN is set but no browser exists at ${override}`,
    )
  }
  for (const candidate of browserBinaryCandidates(platform, env)) {
    if (await exists(candidate)) return candidate
  }
  throw new BrowserLaunchError(
    'No Chrome or Chromium installation found. Install one or set PI_LIVECRAFT_BROWSER_BIN.',
  )
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export interface LaunchedBrowser {
  child: ChildProcess
  /** WebSocket browser endpoint, as printed by Chrome on startup. */
  wsEndpoint: string
  /** HTTP endpoint agents attach to, for example `http://127.0.0.1:43555`. */
  httpEndpoint: string
  userDataDir: string
  /** Terminates Chrome and removes the temporary profile. */
  cleanup: () => Promise<void>
}

/** Launches an isolated headless Chrome with a dynamic remote-debugging port. */
export async function launchHeadlessChrome(options: {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  spawnProcess?: typeof spawn
  binaryExists?: (path: string) => Promise<boolean>
  stderr?: (chunk: string) => void
}): Promise<LaunchedBrowser> {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const spawnProcess = options.spawnProcess ?? spawn
  const binary = await resolveBrowserBinary(env, platform, options.binaryExists)
  const userDataDir = await mkdtemp(join(tmpdir(), 'pi-livecraft-browser-'))
  const child = spawnProcess(
    binary,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--window-size=1440,1000',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], env: process.env },
  )

  const wsEndpoint = await waitForEndpoint(child, options.stderr)
  const endpoint = new URL(wsEndpoint)
  const httpEndpoint = `http://${endpoint.hostname}:${endpoint.port}`
  let cleanedUp = false
  const cleanup = async (): Promise<void> => {
    if (cleanedUp) return
    cleanedUp = true
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM')
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  }
  child.once('exit', () => {
    void rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  return { child, wsEndpoint, httpEndpoint, userDataDir, cleanup }
}

/** Waits for Chrome to print its DevTools endpoint on stderr. */
function waitForEndpoint(
  child: ChildProcess,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = ''
    let settled = false
    const timer = setTimeout(() => {
      settle(() =>
        reject(new BrowserLaunchError('Chrome did not report its DevTools endpoint in time'))
      )
    }, endpointReadyTimeoutMs)
    const settle = (complete: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      complete()
    }
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      onChunk?.(text)
      if (settled) return
      output += text
      const endpoint = parseDevToolsEndpoint(output)
      if (endpoint) settle(() => resolve(endpoint))
    })
    child.once('error', (error) => settle(() => reject(error)))
    child.once('exit', (code) => {
      settle(() =>
        reject(new BrowserLaunchError(`Chrome exited before becoming ready (code ${code})`))
      )
    })
  })
}
