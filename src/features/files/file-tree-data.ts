import type { WorkspaceFileEntry } from '../../../shared/types.ts'

export interface DirectoryState {
  entries: WorkspaceFileEntry[]
  loading: boolean
  error: string | null
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
