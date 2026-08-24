import { useEffect, useMemo, useState } from 'react'
import { listWorkspaceFiles } from '../../api.ts'
import type { WorkspaceFileEntry } from '../../../shared/types.ts'

interface DirectoryState {
  entries: WorkspaceFileEntry[]
  loading: boolean
  error: string | null
}

export function FileExplorer({
  workspacePath,
  onOpenFile,
}: {
  workspacePath: string
  onOpenFile: (path: string) => void
}) {
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>({})
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set(['']))
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    setExpandedPaths(new Set(['']))
    setFilter('')
    setDirectories({ '': { entries: [], loading: true, error: null } })
    void listWorkspaceFiles(workspacePath, '')
      .then((listing) => {
        if (!cancelled)
          setDirectories({ '': { entries: listing.entries, loading: false, error: null } })
      })
      .catch((cause) => {
        if (!cancelled) {
          setDirectories({
            '': {
              entries: [],
              loading: false,
              error: cause instanceof Error ? cause.message : String(cause),
            },
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [workspacePath])

  const normalizedFilter = filter.trim().toLocaleLowerCase()
  const root = directories['']

  async function loadDirectory(path: string): Promise<void> {
    setDirectories((current) => ({
      ...current,
      [path]: { entries: current[path]?.entries ?? [], loading: true, error: null },
    }))
    try {
      const listing = await listWorkspaceFiles(workspacePath, path)
      setDirectories((current) => ({
        ...current,
        [path]: { entries: listing.entries, loading: false, error: null },
      }))
    } catch (cause) {
      setDirectories((current) => ({
        ...current,
        [path]: {
          entries: current[path]?.entries ?? [],
          loading: false,
          error: cause instanceof Error ? cause.message : String(cause),
        },
      }))
    }
  }

  function toggleDirectory(path: string): void {
    setExpandedPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
    if (!directories[path]) void loadDirectory(path)
  }

  const visibleEntries = useMemo(
    () =>
      root?.entries.filter((entry) =>
        entry.kind === 'directory' || entry.name.toLocaleLowerCase().includes(normalizedFilter)
      ) ?? [],
    [normalizedFilter, root?.entries],
  )

  return (
    <section aria-label='Files' className='file-explorer'>
      <label className='file-filter'>
        <span className='sr-only'>Filter files</span>
        <input
          onChange={(event) => setFilter(event.target.value)}
          placeholder='Filter files'
          type='search'
          value={filter}
        />
      </label>
      <div aria-live='polite' className='file-tree' role='tree'>
        {root?.loading && <p className='file-tree-status'>Loading files…</p>}
        {root?.error && <p className='file-tree-status error'>Couldn’t load files: {root.error}</p>}
        {!root?.loading && !root?.error && visibleEntries.length === 0 && (
          <p className='file-tree-status'>No matching files.</p>
        )}
        {visibleEntries.map((entry) => (
          <FileTreeEntry
            directories={directories}
            entry={entry}
            expandedPaths={expandedPaths}
            filter={normalizedFilter}
            key={entry.path}
            level={1}
            onOpenFile={onOpenFile}
            onToggleDirectory={toggleDirectory}
          />
        ))}
      </div>
    </section>
  )
}

function FileTreeEntry({
  directories,
  entry,
  expandedPaths,
  filter,
  level,
  onOpenFile,
  onToggleDirectory,
}: {
  directories: Record<string, DirectoryState>
  entry: WorkspaceFileEntry
  expandedPaths: ReadonlySet<string>
  filter: string
  level: number
  onOpenFile: (path: string) => void
  onToggleDirectory: (path: string) => void
}) {
  const expanded = entry.kind === 'directory' && expandedPaths.has(entry.path)
  const children = directories[entry.path]
  const visibleChildren =
    children?.entries.filter((child) =>
      child.kind === 'directory' || child.name.toLocaleLowerCase().includes(filter)
    ) ?? []

  return (
    <div
      className='file-tree-entry'
      role='treeitem'
      aria-expanded={entry.kind === 'directory'
        ? expanded
        : undefined}
      aria-level={level}
    >
      <button
        className={`file-tree-row ${entry.kind}`}
        onClick={() =>
          entry.kind === 'directory' ? onToggleDirectory(entry.path) : onOpenFile(entry.path)}
        type='button'
      >
        <span aria-hidden='true' className='file-tree-chevron'>
          {entry.kind === 'directory' ? (expanded ? '⌄' : '›') : ''}
        </span>
        <span aria-hidden='true' className={`file-tree-icon ${entry.kind}`}>
          {entry.kind === 'directory' ? (expanded ? '▾' : '▸') : fileIcon(entry.name)}
        </span>
        <span title={entry.name}>{entry.name}</span>
      </button>
      {expanded && (
        <div className='file-tree-children' role='group'>
          {children?.loading && <p className='file-tree-status'>Loading…</p>}
          {children?.error && <p className='file-tree-status error'>{children.error}</p>}
          {visibleChildren.map((child) => (
            <FileTreeEntry
              directories={directories}
              entry={child}
              expandedPaths={expandedPaths}
              filter={filter}
              key={child.path}
              level={level + 1}
              onOpenFile={onOpenFile}
              onToggleDirectory={onToggleDirectory}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function fileIcon(name: string): string {
  const extension = name.split('.').at(-1)?.toLowerCase()
  if (extension === 'md' || extension === 'mdx') return 'M'
  if (extension === 'json' || extension === 'yaml' || extension === 'yml') return '{}'
  if (extension === 'xml' || extension === 'html') return '<>'
  if (extension === 'ts' || extension === 'tsx' || extension === 'js' || extension === 'jsx')
    return '◇'
  return '·'
}
