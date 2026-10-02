import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { isObject } from '../shared/is-object.ts'
import { sessionDirectory, workspaceSessionDir } from './pi-session-directory.ts'

export interface MovedPiSession {
  /** New absolute path of the relocated session file. */
  sessionPath: string
  /** Canonical working directory the session now belongs to. */
  cwd: string
}

/**
 * Relocates a Pi session file to the folder of another workspace and rewrites its header
 * `cwd`, so the backend scan lists it under the target worktree. Pi keys a session on its
 * `cwd` (the header plus the deterministic folder name); there is no RPC to change it, so the
 * relocation happens at the storage layer. The caller must first stop any live Pi process
 * that owns the file, because Pi appends to it while running.
 */
export async function movePiSession(
  sessionPath: string,
  targetCwd: string,
  baseDir = sessionDirectory,
): Promise<MovedPiSession> {
  const canonicalTarget = await realpath(targetCwd)
  if (!(await stat(canonicalTarget)).isDirectory())
    throw new Error('Target worktree must be a directory')

  const source = await realpath(sessionPath)
  const content = await readFile(source, 'utf8')
  const firstNewline = content.indexOf('\n')
  const headerLine = firstNewline >= 0 ? content.slice(0, firstNewline) : content
  const header: unknown = JSON.parse(headerLine)
  if (!isObject(header) || header.type !== 'session' || typeof header.cwd !== 'string')
    throw new Error('Session file has no valid header')

  if (await sameLocation(header.cwd, canonicalTarget))
    throw new Error('Session already belongs to this worktree')

  const targetDir = workspaceSessionDir(canonicalTarget, baseDir)
  const targetPath = join(targetDir, basename(source))
  if (await exists(targetPath))
    throw new Error('A session file with this name already exists in the target worktree')

  const rewrittenHeader = JSON.stringify({ ...header, cwd: canonicalTarget })
  const rewritten = firstNewline >= 0
    ? rewrittenHeader + content.slice(firstNewline)
    : rewrittenHeader
  await mkdir(targetDir, { recursive: true })
  const temporaryPath = `${targetPath}.moving`
  await writeFile(temporaryPath, rewritten)
  await rename(temporaryPath, targetPath)
  await unlink(source)
  return { sessionPath: targetPath, cwd: canonicalTarget }
}

/** Whether a stored cwd resolves to the same directory as an already-canonical target. */
async function sameLocation(storedCwd: string, canonicalTarget: string): Promise<boolean> {
  try {
    return (await realpath(storedCwd)) === canonicalTarget
  } catch {
    return storedCwd === canonicalTarget
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
