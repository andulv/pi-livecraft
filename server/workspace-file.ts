import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { rawPreviewMimeTypes } from '../shared/file-preview.ts'
import type { WorkspaceFile, WorkspaceFileEntry, WorkspaceFileListing } from '../shared/types.ts'

const maxWorkspaceFileSize = 2 * 1024 * 1024
const maxRawPreviewFileSize = 25 * 1024 * 1024
/** How many leading bytes are inspected before serving content as text. */
const binaryPrefixLength = 8000

export interface WorkspaceRawFile {
  path: string
  mimeType: string
  bytes: Buffer
}

export class WorkspaceFileError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** Resolves an existing file, optionally allowing a tool target outside the working directory. */
export async function resolveWorkspaceFilePath(
  workspacePath: string,
  requestedPath: string,
  allowOutsideWorkspace = false,
): Promise<string> {
  const root = await realpath(workspacePath)
  let path: string
  try {
    path = await realpath(resolve(root, requestedPath))
  } catch {
    throw new WorkspaceFileError('File does not exist', 404)
  }
  if (!allowOutsideWorkspace) {
    const pathFromRoot = relative(root, path)
    if (!pathFromRoot || pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot))
      throw new WorkspaceFileError('File must be inside the working directory', 403)
  }

  if (!(await stat(path)).isFile()) throw new WorkspaceFileError('Path must be a file', 400)
  return path
}

/** Lists direct, non-symlink children of a directory within the working directory. */
export async function listWorkspaceFiles(
  workspacePath: string,
  requestedPath: string,
): Promise<WorkspaceFileListing> {
  const root = await realpath(workspacePath)
  let path: string
  try {
    path = await realpath(resolve(root, requestedPath || '.'))
  } catch {
    throw new WorkspaceFileError('Directory does not exist', 404)
  }
  const pathFromRoot = relative(root, path)
  if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot))
    throw new WorkspaceFileError('Directory must be inside the working directory', 403)
  if (!(await stat(path)).isDirectory())
    throw new WorkspaceFileError('Path must be a directory', 400)

  const entries = (await readdir(path, { withFileTypes: true }))
    .flatMap((entry): WorkspaceFileEntry[] => {
      const kind: WorkspaceFileEntry['kind'] | null = entry.isDirectory()
        ? 'directory'
        : entry.isFile()
        ? 'file'
        : null
      return kind
        ? [{ kind, name: entry.name, path: relative(root, resolve(path, entry.name)) }]
        : []
    })
    .sort((left, right) =>
      left.kind === right.kind
        ? left.name.localeCompare(right.name)
        : left.kind === 'directory'
        ? -1
        : 1
    )
  return { path: pathFromRoot, entries }
}

/** Reads an existing text file within the working directory, refusing binary content. */
export async function readWorkspaceFile(
  workspacePath: string,
  requestedPath: string,
): Promise<WorkspaceFile> {
  const path = await resolveWorkspaceFilePath(workspacePath, requestedPath)
  const file = await stat(path)
  if (file.size > maxWorkspaceFileSize) throw new WorkspaceFileError('File exceeds 2 MiB', 413)
  const bytes = await readFile(path)
  if (bytes.subarray(0, binaryPrefixLength).includes(0))
    throw new WorkspaceFileError('File is binary and has no text preview', 415)

  return { path, content: bytes.toString('utf8') }
}

/**
 * Reads an existing media file as raw bytes for previewing. Only extensions in
 * the shared allow-list are served; SVG and HTML are deliberately absent so
 * they never become a same-origin executable document.
 */
export async function readWorkspaceRawFile(
  workspacePath: string,
  requestedPath: string,
): Promise<WorkspaceRawFile> {
  const path = await resolveWorkspaceFilePath(workspacePath, requestedPath)
  const extension = path.split(/[\\/]/).at(-1)?.split('.').at(-1)?.toLowerCase() ?? ''
  const mimeType = rawPreviewMimeTypes[extension]
  if (!mimeType) throw new WorkspaceFileError('Preview is not available for this file type', 415)
  const file = await stat(path)
  if (file.size > maxRawPreviewFileSize) throw new WorkspaceFileError('File exceeds 25 MiB', 413)
  return { path, mimeType, bytes: await readFile(path) }
}
