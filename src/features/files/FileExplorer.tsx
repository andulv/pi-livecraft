import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  Tree,
  type NodeApi,
  type NodeRendererProps,
  type RowRendererProps,
  type TreeApi,
} from 'react-arborist'
import { listWorkspaceFiles } from '../../api.ts'
import {
  buildFileTree,
  refreshDirectories,
  survivingTreePath,
  type DirectoryState,
  type ExplorerNode,
} from './file-tree-data.ts'

const PinFileContext = createContext<(path: string) => void>(() => {})

export function FileExplorer({
  workspacePath,
  onOpenFile,
  onPinFile,
}: {
  workspacePath: string
  onOpenFile: (path: string) => void
  onPinFile: (path: string) => void
}) {
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>({})
  const [filter, setFilter] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const selectionAfterRefresh = useRef<string | null>(null)
  const [treeHeight, setTreeHeight] = useState(0)
  const treeContainerRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<TreeApi<ExplorerNode> | null>(null)
  const pendingDirectories = useRef(new Set<string>())
  const workspaceRef = useRef(workspacePath)
  workspaceRef.current = workspacePath

  useEffect(() => {
    const container = treeContainerRef.current
    if (!container) return
    const observer = new ResizeObserver(([entry]) => {
      const height = Math.round(entry.contentRect.height)
      // A hidden Files panel must not unmount its tree and lose Arborist state.
      if (height > 0) setTreeHeight((current) => current === height ? current : height)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    pendingDirectories.current.clear()
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

  async function loadDirectory(path: string): Promise<void> {
    const requestKey = `${workspacePath}\0${path}`
    if (pendingDirectories.current.has(requestKey)) return
    pendingDirectories.current.add(requestKey)
    setDirectories((current) => ({
      ...current,
      [path]: { entries: current[path]?.entries ?? [], loading: true, error: null },
    }))
    try {
      const listing = await listWorkspaceFiles(workspacePath, path)
      if (workspaceRef.current !== workspacePath) return
      setDirectories((current) => ({
        ...current,
        [path]: { entries: listing.entries, loading: false, error: null },
      }))
    } catch (cause) {
      if (workspaceRef.current !== workspacePath) return
      setDirectories((current) => ({
        ...current,
        [path]: {
          entries: current[path]?.entries ?? [],
          loading: false,
          error: cause instanceof Error ? cause.message : String(cause),
        },
      }))
    } finally {
      pendingDirectories.current.delete(requestKey)
    }
  }

  async function refresh(): Promise<void> {
    if (refreshing || Object.values(directories).some((directory) => directory.loading)) return
    setRefreshing(true)
    setRefreshError(null)
    const selectedPath = treeRef.current?.selectedIds.values().next().value ?? null
    const result = await refreshDirectories(
      directories,
      async (path) => (await listWorkspaceFiles(workspacePath, path)).entries,
    )
    if (workspaceRef.current !== workspacePath) return
    selectionAfterRefresh.current = selectedPath
    setDirectories(result.directories)
    setRefreshError(result.error)
    setRefreshing(false)
  }

  useEffect(() => {
    const tree = treeRef.current
    if (!tree || refreshing) return
    for (const path of Object.keys(tree.openState)) {
      if (tree.openState[path] && !directories[path]) tree.close(path)
    }
    const previousSelection = selectionAfterRefresh.current
    selectionAfterRefresh.current = null
    if (!previousSelection) return
    const selection = survivingTreePath(previousSelection, directories)
    if (selection === previousSelection) return
    tree.setSelection({
      ids: selection ? [selection] : [],
      anchor: selection,
      mostRecent: selection,
    })
    if (selection) tree.focus(selection, { scroll: false })
  }, [directories, refreshing])

  function activateNode(node: NodeApi<ExplorerNode>): void {
    if (node.data.kind === 'directory') node.toggle()
    else if (node.data.kind === 'file') onOpenFile(node.data.path)
    else if (node.data.kind === 'error') void loadDirectory(node.data.path)
  }

  function loadOnExpand(path: string): void {
    const directory = directories[path]
    if (treeRef.current?.isOpen(path) && (!directory || directory.error))
      void loadDirectory(path)
  }

  const normalizedFilter = filter.trim().toLocaleLowerCase()
  const root = directories['']
  const nodes = useMemo(
    () => buildFileTree(root?.entries ?? [], directories, normalizedFilter),
    [directories, normalizedFilter, root?.entries],
  )

  return (
    <section aria-label='Files' className='file-explorer'>
      <div className='file-explorer-toolbar'>
        <input
          aria-label='Filter files'
          onChange={(event) => setFilter(event.target.value)}
          placeholder='Filter files'
          type='search'
          value={filter}
        />
        <button
          aria-label='Refresh files'
          className='file-refresh'
          disabled={refreshing || Object.values(directories).some((directory) => directory.loading)}
          onClick={() => void refresh()}
          title='Refresh files from disk'
          type='button'
        >
          ↻
        </button>
      </div>
      {refreshError && (
        <p className='file-tree-status error' role='alert'>
          Couldn’t refresh files: {refreshError}
        </p>
      )}
      <div
        aria-busy={refreshing}
        inert={refreshing}
        className='file-tree'
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.defaultPrevented) return
          const node = treeRef.current?.focusedNode
          if (!node) return
          event.preventDefault()
          if (node.data.kind === 'directory') node.toggle()
          else if (node.data.kind === 'file') onOpenFile(node.data.path)
          else if (node.data.kind === 'error') void loadDirectory(node.data.path)
        }}
        ref={treeContainerRef}
      >
        {root?.loading && <p className='file-tree-status'>Loading files…</p>}
        {root?.error && <p className='file-tree-status error'>Couldn’t load files: {root.error}</p>}
        {!root?.loading && !root?.error && nodes.length === 0 && (
          <p className='file-tree-status'>No matching files.</p>
        )}
        {!root?.loading && !root?.error && treeHeight > 0 && (
          <PinFileContext.Provider value={onPinFile}>
            <Tree<ExplorerNode>
              aria-label='Workspace files'
              data={nodes}
              disableDrag
              disableDrop
              disableEdit
              disableMultiSelection
              disableSelect={isStatusNode}
              height={treeHeight}
              indent={13}
              onActivate={activateNode}
              onToggle={loadOnExpand}
              openByDefault={false}
              ref={treeRef}
              renderRow={FileTreeRowContainer}
              rowHeight={27}
              width='100%'
            >
              {FileTreeRow}
            </Tree>
          </PinFileContext.Provider>
        )}
      </div>
    </section>
  )
}

function isStatusNode(node: ExplorerNode): boolean {
  return node.kind === 'loading' || node.kind === 'error'
}

function FileTreeRowContainer({ node, attrs, innerRef, children }: RowRendererProps<ExplorerNode>) {
  return (
    <div
      {...attrs}
      aria-expanded={node.isLeaf ? undefined : node.isOpen}
      onClick={node.handleClick}
      onFocus={(event) => event.stopPropagation()}
      ref={innerRef}
      style={{ ...attrs.style, minWidth: 0 }}
    >
      {children}
    </div>
  )
}

function FileTreeRow({ node, style }: NodeRendererProps<ExplorerNode>) {
  const onPinFile = useContext(PinFileContext)
  const { kind, name, path } = node.data
  const directory = kind === 'directory'

  return (
    <div
      className={`file-tree-row ${kind}`}
      onDoubleClick={() => {
        if (kind === 'file') onPinFile(path)
      }}
      style={style}
      title={name}
    >
      <span aria-hidden='true' className='file-tree-chevron'>
        {directory ? (node.isOpen ? '⌄' : '›') : ''}
      </span>
      <span aria-hidden='true' className={`file-tree-icon ${kind}`}>
        {directory ? (node.isOpen ? '▾' : '▸') : kind === 'file' ? fileIcon(name) : ''}
      </span>
      <span>{name}</span>
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
