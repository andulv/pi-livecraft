import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const vscodeSettingsPath = join('.vscode', 'settings.json')
const vscodeSettingsIgnoreRule = '.vscode/settings.json'
const colorPattern = /^#[0-9a-f]{6}$/i

type SpawnProcess = (
  command: string,
  args: string[],
  options: Parameters<typeof spawn>[2],
) => ChildProcess

export interface VSCodeWorkspaceBranding {
  color: string
  isMainWorktree: boolean
  projectName: string
  workspaceName: string
}

export class VSCodeSettingsError extends Error {}

/** Opens the current worktree in a new, visibly branded VS Code window. */
export async function openVSCodeApplication(
  workspacePath: string,
  branding: VSCodeWorkspaceBranding,
  spawnProcess: SpawnProcess = spawn,
): Promise<void> {
  if (!branding.isMainWorktree) await configureVSCodeWorkspace(workspacePath, branding)
  await launchVSCode(workspacePath, spawnProcess)
}

/** Merges Livecraft's identity settings into the worktree's VS Code settings file. */
export async function configureVSCodeWorkspace(
  workspacePath: string,
  branding: VSCodeWorkspaceBranding,
): Promise<void> {
  validateBranding(branding)
  const settingsPath = join(workspacePath, vscodeSettingsPath)
  const settings = await readSettings(settingsPath)
  const customizations = settings['workbench.colorCustomizations']
  if (customizations !== undefined && !isRecord(customizations)) {
    throw new VSCodeSettingsError('workbench.colorCustomizations must be an object')
  }

  const { color, projectName, workspaceName } = branding
  const inactiveColor = `${color}99`
  settings['window.title'] =
    `${projectName} · ${workspaceName}\${separator}\${dirty}\${activeEditorShort}\${separator}\${appName}`
  settings['window.border'] = color
  settings['workbench.colorCustomizations'] = {
    ...customizations,
    'titleBar.activeBackground': color,
    'titleBar.inactiveBackground': inactiveColor,
    'titleBar.border': color,
    'window.activeBorder': color,
    'window.inactiveBorder': inactiveColor,
  }

  await mkdir(join(workspacePath, '.vscode'), { recursive: true })
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
  await ensureSettingsIgnored(join(workspacePath, '.gitignore'))
}

/** Adds the generated settings file to the worktree's local ignore rules when needed. */
export async function ensureSettingsIgnored(gitignorePath: string): Promise<void> {
  let content = ''
  try {
    content = await readFile(gitignorePath, 'utf8')
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }
  if (content.split(/\r?\n/).some((line) => ignoresVSCodeSettings(line))) return
  await writeFile(
    gitignorePath,
    `${content}${content && !content.endsWith('\n') ? '\n' : ''}${vscodeSettingsIgnoreRule}\n`,
  )
}

function validateBranding({ color, projectName, workspaceName }: VSCodeWorkspaceBranding): void {
  if (!colorPattern.test(color)) throw new VSCodeSettingsError('Project color must be a hex color')
  for (const [label, value] of [['Project name', projectName], ['Workspace name', workspaceName]]) {
    if (
      typeof value !== 'string' || !value.trim() || value.length > 200
      || [...value].some((character) => (character.codePointAt(0) ?? 0) < 32)
    ) throw new VSCodeSettingsError(`${label} is invalid`)
  }
}

async function readSettings(settingsPath: string): Promise<Record<string, unknown>> {
  try {
    const source = await readFile(settingsPath, 'utf8')
    if (!source.trim()) return {}
    const value: unknown = JSON.parse(removeJsoncSyntax(source))
    if (!isRecord(value)) throw new VSCodeSettingsError('VS Code settings must be an object')
    return value
  } catch (error) {
    if (isMissingFile(error)) return {}
    if (error instanceof VSCodeSettingsError) throw error
    throw new VSCodeSettingsError(`Unable to read VS Code settings: ${errorMessage(error)}`)
  }
}

/** Parses VS Code JSONC while preserving all existing setting values during the merge. */
function removeJsoncSyntax(source: string): string {
  let uncommented = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]
    if (inString) {
      uncommented += character
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      uncommented += character
      continue
    }
    if (character === '/' && next === '/') {
      index = source.indexOf('\n', index)
      if (index === -1) break
      uncommented += '\n'
      continue
    }
    if (character === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2)
      if (end === -1)
        throw new VSCodeSettingsError('VS Code settings contain an unterminated comment')
      uncommented += source.slice(index, end + 2).replace(/[^\r\n]/g, '')
      index = end + 1
      continue
    }
    uncommented += character
  }

  let result = ''
  inString = false
  escaped = false
  for (let index = 0; index < uncommented.length; index += 1) {
    const character = uncommented[index]
    if (inString) {
      result += character
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      result += character
      continue
    }
    if (character === ',') {
      const following = uncommented.slice(index + 1).match(/^\s*([}\]])/)
      if (following) continue
    }
    result += character
  }
  return result
}

function ignoresVSCodeSettings(line: string): boolean {
  const pattern = line.trim()
  return pattern === '.vscode' || pattern === '.vscode/' || pattern === '/.vscode/'
    || pattern === vscodeSettingsIgnoreRule || pattern === `/${vscodeSettingsIgnoreRule}`
}

async function launchVSCode(workspacePath: string, spawnProcess: SpawnProcess): Promise<void> {
  let failure: unknown
  for (const command of ['code', 'code-insiders']) {
    try {
      await openApplication(command, workspacePath, spawnProcess)
      return
    } catch (error) {
      failure = error
    }
  }
  throw new Error(`Unable to launch VS Code: ${errorMessage(failure)}`)
}

function openApplication(
  command: string,
  workspacePath: string,
  spawnProcess: SpawnProcess,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, ['--new-window', workspacePath], {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: false,
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null
    && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
