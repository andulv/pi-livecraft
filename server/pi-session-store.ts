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
const HEAD_CHUNK_BYTES = 8192
const TAIL_CHUNK_BYTES = 16384

interface SessionTailScan {
  /** Whether a session_info entry was found; `name` is undefined when it cleared the title. */
  nameFound: boolean
  name: string | undefined
  hasMessage: boolean
  lastMessageAt: number | undefined
  /** Earliest message timestamp seen; meaningful only when the scan reached the head. */
  earliestMessageAt: number | undefined
  /** Whether the scan covered every byte after the head chunk (no early stop). */
  reachedHead: boolean
}

/**
 * Pi stores sessions in a deterministic subfolder named after the workspace path:
 * the leading separator is dropped and each remaining separator becomes `-`.
 * Exported so tests can place fixtures exactly where Pi would store them.
 */
export function workspaceSessionDir(cwd: string, baseDir: string): string {
  const segments = cwd.split(/[/\\]+/).filter(Boolean)
  return join(baseDir, `--${segments.join('-')}--`)
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

/** Reads session metadata without loading full histories: the header and first user
 *  message come from the head, while the latest session_info name and the last message
 *  timestamp are found by scanning backwards from the end until both are located. This
 *  mirrors Pi's own rule that the last session_info entry wins, including clears. */
async function readPiSession(path: string, updatedAt: number): Promise<RecentSession | null> {
  let canonicalPath: string
  try {
    canonicalPath = await realpath(path)
  } catch {
    return null
  }

  let size: number
  try {
    size = (await stat(canonicalPath)).size
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }

  let headContent: string
  try {
    headContent = await readChunk(canonicalPath, 0, Math.min(size, HEAD_CHUNK_BYTES))
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
  let firstMessageAt: number | undefined
  let lastMessageAt: number | undefined
  let prompt: string | undefined

  // Scan head lines (after the header) for the first user message and any early
  // session_info or message timestamps. The head is truncated when the file is larger
  // than its chunk; its trailing partial line is completed by the backwards scan.
  if (firstNewline >= 0) {
    const headLines = headContent.slice(firstNewline + 1).split('\n')
    const headPartial = size > HEAD_CHUNK_BYTES ? headLines.pop() : undefined
    for (const line of headLines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const value = parseLine(trimmed)
      if (!value) continue
      if (value.type === 'session_info') {
        name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : undefined
      }
      if (value.type !== 'message') continue
      hasMessage = true
      if (prompt === undefined && isObject(value.message) && value.message.role === 'user') {
        const content = textContent(value.message.content)
        if (content && !content.startsWith('/')) prompt = shortenPrompt(content)
      }
      if (typeof value.timestamp === 'string') {
        const timestamp = Date.parse(value.timestamp)
        if (!Number.isNaN(timestamp)) {
          // The head scan starts at the file start, so the first message seen is the
          // session's first message; the header timestamp is the fallback.
          if (firstMessageAt === undefined) firstMessageAt = timestamp
          if (lastMessageAt === undefined || timestamp > lastMessageAt) lastMessageAt = timestamp
        }
      }
    }
    if (headPartial !== undefined) {
      const tail = await scanSessionTail(canonicalPath, size, headPartial)
      // The backwards scan covers everything after the head chunk, so its session_info
      // is the latest one and replaces any name found in the head.
      if (tail.nameFound) name = tail.name
      hasMessage = hasMessage || tail.hasMessage
      if (
        tail.lastMessageAt !== undefined
        && (lastMessageAt === undefined || tail.lastMessageAt > lastMessageAt)
      ) lastMessageAt = tail.lastMessageAt
      // When the scan walked to the head boundary it saw every message the head could
      // not, so its earliest message is the session's first message whenever the head
      // scan found none (a large early line can push the first message past the head).
      if (tail.reachedHead && tail.earliestMessageAt !== undefined)
        firstMessageAt ??= tail.earliestMessageAt
    }
  }

  if (!hasMessage) return null
  const createdAt = Date.parse(header.timestamp)
  return {
    id: header.id,
    cwd,
    name: name || prompt || 'New session',
    sessionPath: canonicalPath,
    firstMessageAt: firstMessageAt ?? (Number.isNaN(createdAt) ? undefined : createdAt),
    updatedAt: lastMessageAt ?? (Number.isNaN(createdAt) ? updatedAt : createdAt),
  }
}

/** Scans a session file backwards from its end for the latest session_info entry and
 *  the latest message timestamp, stopping once both are found or the head region begins.
 *  `headPartial` completes the line that the truncated head chunk ended with. */
async function scanSessionTail(
  path: string,
  size: number,
  headPartial: string,
): Promise<SessionTailScan> {
  const scan: SessionTailScan = {
    nameFound: false,
    name: undefined,
    hasMessage: false,
    lastMessageAt: undefined,
    earliestMessageAt: undefined,
    reachedHead: false,
  }
  let pending = ''
  let end = size
  while (end > HEAD_CHUNK_BYTES && !(scan.nameFound && scan.lastMessageAt !== undefined)) {
    const start = Math.max(HEAD_CHUNK_BYTES, end - TAIL_CHUNK_BYTES)
    // The earliest chunk completes the line the truncated head ended with, so a
    // session_info entry spanning the head boundary is parsed exactly once. Its first
    // line is therefore complete; every earlier chunk carries its first fragment instead.
    const prefix = start === HEAD_CHUNK_BYTES ? headPartial : ''
    const raw = (prefix + (await readChunk(path, start, end - start)) + pending).split('\n')
    const lines = start === HEAD_CHUNK_BYTES ? raw : raw.slice(1)
    if (start > HEAD_CHUNK_BYTES) pending = raw[0] ?? ''
    for (let index = lines.length - 1; index >= 0; index--) {
      const trimmed = lines[index].trim()
      if (!trimmed || !mayCarrySessionMetadata(trimmed)) continue
      const value = parseLine(trimmed)
      if (!value) continue
      if (!scan.nameFound && value.type === 'session_info') {
        scan.nameFound = true
        scan.name = typeof value.name === 'string' && value.name.trim()
          ? value.name.trim()
          : undefined
      }
      if (value.type !== 'message') continue
      scan.hasMessage = true
      if (typeof value.timestamp === 'string') {
        const timestamp = Date.parse(value.timestamp)
        if (!Number.isNaN(timestamp)) {
          if (
            scan.lastMessageAt === undefined || timestamp > scan.lastMessageAt
          ) scan.lastMessageAt = timestamp
          if (
            scan.earliestMessageAt === undefined || timestamp < scan.earliestMessageAt
          ) scan.earliestMessageAt = timestamp
        }
      }
      if (scan.nameFound && scan.lastMessageAt !== undefined) break
    }
    end = start
  }
  scan.reachedHead = end <= HEAD_CHUNK_BYTES
  return scan
}

/** Cheap pre-filter so only lines that can carry a session name or message timestamp are parsed. */
function mayCarrySessionMetadata(line: string): boolean {
  return line.includes('session_info') || line.includes('"message"')
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
