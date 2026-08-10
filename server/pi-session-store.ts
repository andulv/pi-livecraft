import { readdir, open, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { RecentSession } from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'

const sessionDirectory = resolvePiSessionDirectory(process.env, homedir())

/** Resolves Pi's session storage using its configured profile before the default profile. */
export function resolvePiSessionDirectory(
  environment: { PI_CODING_AGENT_SESSION_DIR?: string; PI_CODING_AGENT_DIR?: string },
  homeDirectory: string,
): string {
  return environment.PI_CODING_AGENT_SESSION_DIR
    ?? (environment.PI_CODING_AGENT_DIR
      ? join(environment.PI_CODING_AGENT_DIR, 'sessions')
      : join(homeDirectory, '.pi', 'agent', 'sessions'))
}

interface PiSessionHeader {
  type: 'session'
  id: string
  timestamp: string
  cwd: string
}

const MAX_SESSIONS = 30

/** Pi stores sessions in a deterministic subfolder named after the canonical workspace path. */
function workspaceSessionDir(cwd: string, baseDir: string): string {
  const encoded = '--' + cwd.replace(/[/\\]/g, '-') + '--'
  return join(baseDir, encoded)
}

/** Reads the metadata for the most recent sessions in a single workspace folder. */
export async function listRecentPiSessions(
  cwd: string,
  directory = sessionDirectory,
): Promise<RecentSession[]> {
  const sessionDir = workspaceSessionDir(cwd, directory)
  let entries
  try {
    entries = await readdir(sessionDir, { withFileTypes: true })
  } catch {
    return []
  }
  const paths = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => join(sessionDir, entry.name))

  const withMtime = await Promise.all(
    paths.map(async (path) => ({ path, mtime: (await stat(path)).mtimeMs })),
  )
  const candidates = withMtime
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, MAX_SESSIONS * 2)

  const sessions = await Promise.all(
    candidates.map(({ path, mtime }) => readPiSession(path, mtime)),
  )

  return sessions
    .filter((session): session is RecentSession => session?.cwd === cwd)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_SESSIONS)
}

/** Verifies that a file belongs to the Pi session directory before loading its metadata. */
export async function loadPiSession(path: string): Promise<RecentSession> {
  const [canonicalPath, canonicalDirectory] = await Promise.all([
    realpath(path),
    realpath(sessionDirectory),
  ])
  const relativePath = relative(canonicalDirectory, canonicalPath)
  if (!relativePath || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))
    throw new Error('Pi session file must be stored in the Pi session directory')
  const session = await readPiSession(canonicalPath, (await stat(canonicalPath)).mtimeMs)
  if (!session) throw new Error('Invalid Pi session file')
  return session
}

/** Loads known sessions by their file paths, skipping anything no longer on disk. */
export async function resolvePiSessions(paths: readonly string[]): Promise<RecentSession[]> {
  const sessions = await Promise.all(
    paths.map((path) => loadPiSession(path).catch(() => null)),
  )
  return sessions.filter((session): session is RecentSession => session !== null)
}

/** Reads the first and last ~8 KB of a session file to extract metadata without scanning the middle. */
async function readPiSession(path: string, updatedAt: number): Promise<RecentSession | null> {
  let canonicalPath: string
  try {
    canonicalPath = await realpath(path)
  } catch {
    return null
  }

  let headContent: string
  let tailContent: string | undefined
  try {
    const { size } = await stat(canonicalPath)
    if (size <= 16384) {
      headContent = await readChunk(canonicalPath, 0, size)
    } else {
      headContent = await readChunk(canonicalPath, 0, 8192)
      tailContent = await readChunk(canonicalPath, Math.max(0, size - 8192), 8192)
    }
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }

  // First complete line is the header
  const firstNewline = headContent.indexOf('\n')
  const headerLine = firstNewline >= 0
    ? headContent.slice(0, firstNewline).trim()
    : headContent.trim()
  const header = parseHeader(headerLine || undefined)
  if (!header) return null

  let cwd: string
  try {
    cwd = await realpath(header.cwd)
  } catch {
    return null
  }

  let name: string | undefined
  let hasMessage = false
  let lastMessageAt: number | undefined
  let prompt: string | undefined

  // Scan head lines (after the header) for first user message and session_info
  if (firstNewline >= 0) {
    for (const line of headContent.slice(firstNewline + 1).split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const value = parseLine(trimmed)
      if (!value) continue
      if (value.type === 'session_info' && typeof value.name === 'string' && value.name.trim()) {
        name = value.name.trim()
      }
      if (value.type !== 'message') continue
      hasMessage = true
      if (prompt === undefined && isObject(value.message) && value.message.role === 'user') {
        const content = textContent(value.message.content)
        if (content && !content.startsWith('/')) prompt = shortenPrompt(content)
      }
      if (typeof value.timestamp === 'string') {
        const timestamp = Date.parse(value.timestamp)
        if (!Number.isNaN(timestamp) && (lastMessageAt === undefined || timestamp > lastMessageAt))
          lastMessageAt = timestamp
      }
    }
  }

  // Scan tail lines for the latest session_info and latest message
  if (tailContent) {
    // Drop the first fragment if it's a partial continuation from before the tail chunk
    const startAtNewline = tailContent[0] !== '\n' && firstNewline < headContent.length - 1
    const body = startAtNewline ? tailContent.slice(tailContent.indexOf('\n') + 1) : tailContent
    for (const line of body.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const value = parseLine(trimmed)
      if (!value) continue
      if (value.type === 'session_info' && typeof value.name === 'string' && value.name.trim()) {
        name = value.name.trim()
      }
      if (value.type !== 'message') continue
      hasMessage = true
      if (typeof value.timestamp === 'string') {
        const timestamp = Date.parse(value.timestamp)
        if (!Number.isNaN(timestamp) && (lastMessageAt === undefined || timestamp > lastMessageAt))
          lastMessageAt = timestamp
      }
    }
  }

  if (!hasMessage) return null
  const createdAt = Date.parse(header.timestamp)
  return {
    id: header.id,
    cwd,
    name: name || prompt || 'New session',
    sessionPath: canonicalPath,
    updatedAt: lastMessageAt ?? (Number.isNaN(createdAt) ? updatedAt : createdAt),
  }
}

/** Reads a byte range from a file without streaming the full content. */
async function readChunk(path: string, start: number, length: number): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, start)
    return buffer.toString('utf8', 0, bytesRead)
  } finally {
    await handle.close()
  }
}

function parseHeader(line: string | undefined): PiSessionHeader | null {
  const value = parseLine(line)
  if (
    !value || value.type !== 'session' || typeof value.id !== 'string'
    || typeof value.timestamp !== 'string' || typeof value.cwd !== 'string'
  ) return null
  return { type: 'session', id: value.id, timestamp: value.timestamp, cwd: value.cwd }
}

function parseLine(line: string | undefined): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line ?? '')
    return isObject(value) ? value : null
  } catch {
    return null
  }
}

function textContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content.trim() || undefined
  if (!Array.isArray(content)) return undefined
  const text = content
    .filter((part): part is Record<string, unknown> =>
      isObject(part) && part.type === 'text' && typeof part.text === 'string'
    )
    .map((part) => part.text)
    .join(' ')
    .trim()
  return text || undefined
}

function shortenPrompt(prompt: string): string {
  const words = prompt.split(/\s+/)
  return words.length > 8 ? `${words.slice(0, 8).join(' ')}…` : prompt
}
function isNotFound(error: unknown): boolean {
  return isObject(error) && error.code === 'ENOENT'
}
