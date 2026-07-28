import { spawn } from 'node:child_process'

export type DesktopPlatform = 'linux' | 'wsl'

/** Identifies the supported Linux desktop environment from the process platform and WSL markers. */
export function getDesktopPlatform(platform = process.platform, env: NodeJS.ProcessEnv = process.env): DesktopPlatform {
  if (platform !== 'linux') throw new Error(`Unsupported platform: ${platform}`)
  return env.WSL_DISTRO_NAME || env.WSL_INTEROP ? 'wsl' : 'linux'
}

/** Returns the WSL distribution running the backend when its name is available. */
export function getWslDistributionName(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.WSL_DISTRO_NAME || undefined
}

/** Opens the workspace directory using the native file browser for the current Linux environment. */
export async function openExplorer(workspacePath: string, platform = getDesktopPlatform()): Promise<void> {
  const command = platform === 'wsl' ? 'explorer.exe' : 'xdg-open'
  await openApplication(command, await externalWorkspacePath(workspacePath, platform))
}

/** Returns the path format expected by the browser or desktop integration. */
export function externalWorkspacePath(workspacePath: string, platform = getDesktopPlatform(), convertPath = convertWslPath): Promise<string> {
  return platform === 'wsl' ? convertPath(workspacePath) : Promise.resolve(workspacePath)
}

/** Converts a WSL path to the Windows format understood by Windows applications. */
function convertWslPath(workspacePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn('wslpath', ['-w', workspacePath], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let errorOutput = ''
    process.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
    process.stderr.on('data', (chunk: Buffer) => { errorOutput += chunk.toString('utf8') })
    process.once('error', reject)
    process.once('exit', (code) => {
      const windowsPath = output.trim()
      if (code === 0 && windowsPath) resolve(windowsPath)
      else reject(new Error(errorOutput.trim() || `wslpath exited with code ${code}`))
    })
  })
}

/** Detaches a desktop application so restarting the backend never closes it. */
function openApplication(command: string, workspacePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [workspacePath], { detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
