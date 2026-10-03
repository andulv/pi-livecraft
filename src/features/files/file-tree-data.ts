import type { WorkspaceFileEntry } from '../../../shared/types.ts'

export interface DirectoryState {
  entries: WorkspaceFileEntry[]
  loading: boolean
  error: string | null
}

/** Reloads only previously loaded folders, following fresh parents so deleted trees
 * are not read. Failed reads retain their old subtree rather than implying deletion. */
export async function refreshDirectories(
  previous: Readonly<Record<string, DirectoryState>>,
  read: (path: string) => Promise<WorkspaceFileEntry[]>,
): Promise<{ directories: Record<string, DirectoryState>; error: string | null }> {
  const directories: Record<string, DirectoryState> = {}
  const errors: string[] = []
  async function visit(path: string): Promise<void> {
    let entries: WorkspaceFileEntry[]
    try {
      entries = await read(path)
      directories[path] = { entries, loading: false, error: null }
    } catch (cause) {
      errors.push(
        `${path || 'Workspace'}: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
      for (const [key, state] of Object.entries(previous)) {
        if (path === '' || key === path || key.startsWith(`${path}/`)) directories[key] = state
      }
      return
    }
    await Promise.all(
      entries
        .filter((entry) => entry.kind === 'directory' && previous[entry.path])
        .map((entry) => visit(entry.path)),
    )
  }
  await visit('')
  return { directories, error: errors.length ? errors.join('; ') : null }
}

/** Finds the nearest surviving selection without mistaking failed reads for deletion. */
export function survivingTreePath(
  path: string,
  directories: Readonly<Record<string, DirectoryState>>,
): string | null {
  const paths = new Set(
    Object.values(directories).flatMap((state) => state.entries.map((entry) => entry.path)),
  )
  while (path) {
    if (paths.has(path)) return path
    const slash = path.lastIndexOf('/')
    path = slash < 0 ? '' : path.slice(0, slash)
  }
  return null
}

/** An empty children array keeps an unloaded directory expandable in Arborist. */
export interface FileTreeNode extends WorkspaceFileEntry {
  id: string
  children?: ExplorerNode[]
}

export interface FileTreeStatusNode {
  id: string
  kind: 'loading' | 'error'
  name: string
  path: string
}

export type ExplorerNode = FileTreeNode | FileTreeStatusNode

/** Keeps unloaded directories visible while filtering files at every loaded level. */
export function buildFileTree(
  entries: readonly WorkspaceFileEntry[],
  directories: Readonly<Record<string, DirectoryState>>,
  filter: string,
): ExplorerNode[] {
  return entries
    .filter((entry) =>
      entry.kind === 'directory' || entry.name.toLocaleLowerCase().includes(filter)
    )
    .map((entry): ExplorerNode => {
      if (entry.kind === 'file') return { ...entry, id: entry.path }

      const directory = directories[entry.path]
      const children: ExplorerNode[] = directory?.loading
        ? [{ id: `${entry.path}\0loading`, kind: 'loading', name: 'Loading…', path: entry.path }]
        : directory?.error
        ? [{
          id: `${entry.path}\0error`,
          kind: 'error',
          name: `Couldn’t load files: ${directory.error} (click to retry)`,
          path: entry.path,
        }]
        : directory
        ? buildFileTree(directory.entries, directories, filter)
        : []

      return { ...entry, id: entry.path, children }
    })
}
