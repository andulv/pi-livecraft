import { spawn } from 'node:child_process'

const defaultTerminalTemplate = 'wt.exe -d {cwd}'
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

/**
 * Launches a terminal application detached from the backend process.
 * Falls back to `wt.exe -d {cwd}` when no template is configured.
 */
export function openTerminalApplication(workspacePath: string, template?: string | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const raw = template && template.trim() ? template : defaultTerminalTemplate
    let parsed: { command: string; args: string[] }
    try {
      parsed = parseTerminalTemplate(raw, workspacePath)
    } catch (error) {
      reject(error)
      return
    }

    const process = spawn(parsed.command, parsed.args, { detached: true, stdio: 'ignore' })
    process.once('error', reject)
    process.once('spawn', () => {
      process.unref()
      resolve()
    })
  })
}
