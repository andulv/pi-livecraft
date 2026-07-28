import { spawn } from 'node:child_process'
import { getDesktopPlatform, getWslDistributionName, type DesktopPlatform } from '../../system-integration.ts'

const maxTemplateLength = 2000

export class TerminalTemplateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TerminalTemplateError'
  }
}

/**
 * Tokenizes a command template respecting double-quote grouping and backslash escapes.
 * Spaces outside quotes separate tokens; quotes are removed from the result.
 */
export function tokenizeTemplate(template: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuote = false

  for (let i = 0; i < template.length; i += 1) {
    const ch = template[i]

    if (ch === '\\' && i + 1 < template.length) {
      current += template[i + 1]
      i += 1
      continue
    }

    if (ch === '"') {
      inQuote = !inQuote
      continue
    }

    if (ch === ' ' && !inQuote) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += ch
  }

  if (inQuote) throw new TerminalTemplateError('Unclosed double quote in terminal command')
  if (current.length > 0) tokens.push(current)

  return tokens
}

/**
 * Parses and validates a terminal command template.
 * Replaces every `{cwd}` placeholder with the resolved workspace path.
 */
export function parseTerminalTemplate(raw: string, cwd: string): { command: string; args: string[] } {
  if (!raw || !raw.trim()) throw new TerminalTemplateError('Terminal command is empty')
  if (raw.length > maxTemplateLength) throw new TerminalTemplateError(`Terminal command exceeds ${maxTemplateLength} characters`)
  if (raw.includes('\0')) throw new TerminalTemplateError('Terminal command contains invalid characters')

  const tokens = tokenizeTemplate(raw.trim())
  if (tokens.length === 0) throw new TerminalTemplateError('Terminal command produced no tokens')

  if (!raw.includes('{cwd}')) throw new TerminalTemplateError('Terminal command must contain {cwd}')

  const replaced = tokens.map((t) => t.replace(/\{cwd\}/g, cwd))
  const [command, ...args] = replaced
  if (!command) throw new TerminalTemplateError('Terminal command has no executable')

  return { command, args }
}

/** Returns the platform-specific terminal invocation used when no custom template is set. */
export function defaultTerminalInvocation(workspacePath: string, platform = getDesktopPlatform(), env: NodeJS.ProcessEnv = process.env): { command: string; args: string[]; cwd?: string } {
  const wslDistribution = getWslDistributionName(env)
  return platform === 'wsl'
    ? { command: 'wsl.exe', args: [...(wslDistribution ? ['-d', wslDistribution] : []), '--cd', workspacePath] }
    : { command: 'x-terminal-emulator', args: [], cwd: workspacePath }
}

/**
 * Launches a terminal application detached from the backend process.
 * An empty template selects the platform default; custom templates still require `{cwd}`.
 */
export function openTerminalApplication(workspacePath: string, template?: string | null, platform?: DesktopPlatform): Promise<void> {
  return new Promise((resolve, reject) => {
    let invocation: { command: string; args: string[]; cwd?: string }
    try {
      invocation = template && template.trim()
        ? { ...parseTerminalTemplate(template, workspacePath) }
        : defaultTerminalInvocation(workspacePath, platform ?? getDesktopPlatform())
    } catch (error) {
      reject(error)
      return
    }

    const child = spawn(invocation.command, invocation.args, { cwd: invocation.cwd, detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
