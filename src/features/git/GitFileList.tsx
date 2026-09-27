import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  Tree,
  type NodeApi,
  type NodeRendererProps,
  type RowRendererProps,
  type TreeApi,
} from 'react-arborist'
import type { GitFileChange } from '../../../shared/types.ts'
import { resolveFileIcon } from '../../../shared/file-icon.ts'
import { Tooltip } from '../../components/Tooltip.tsx'
import { gitFileNodes, type GitFileNode } from './git-file-nodes.ts'

interface GitFileActions {
  onSelect: (path: string, pin: boolean) => void
  onDiscard?: (path: string) => void
  discardDisabled?: boolean
  treeView: boolean
}

const GitFileActionsContext = createContext<GitFileActions | null>(null)

/** Virtualizes both changed-file views without changing their Git actions. */
export function GitFileList({ files, treeView, onSelect, onDiscard, discardDisabled }: {
  files: readonly GitFileChange[]
  treeView: boolean
  onSelect: (path: string, pin: boolean) => void
  onDiscard?: (path: string) => void
  discardDisabled?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<TreeApi<GitFileNode> | null>(null)
  const [height, setHeight] = useState(0)
  const nodes = useMemo(() => gitFileNodes(files, treeView), [files, treeView])
  const listLabel = onDiscard ? 'Git changes' : 'Outgoing Git files'
  const viewLabel = treeView ? 'tree' : 'flat'
  const label = `${listLabel} in ${viewLabel} view`

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.height)
      setHeight((current) => current === next ? current : next)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  function activateNode(node: NodeApi<GitFileNode>): void {
    if (node.data.file) {
      if (node.data.file.status !== 'renamed') onSelect(node.data.file.path, false)
    } else node.toggle()
  }

  return (
    <div
      className={`git-virtual-files${onDiscard ? '' : ' git-commit-files'}`}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.defaultPrevented) return
        const node = treeRef.current?.focusedNode
        if (!node) return
        event.preventDefault()
        activateNode(node)
      }}
      onKeyDownCapture={focusDiscardButton}
      ref={containerRef}
    >
      {height > 0 && (
        <GitFileActionsContext.Provider
          value={{ onSelect, onDiscard, discardDisabled, treeView }}
        >
          <Tree<GitFileNode>
            aria-label={label}
            data={nodes}
            disableDrag
            disableDrop
            disableEdit
            disableMultiSelection
            disableSelect={isRenamedFile}
            height={height}
            indent={13}
            onActivate={activateNode}
            openByDefault={false}
            ref={treeRef}
            renderRow={GitFileRowContainer}
            rowHeight={31}
            width='100%'
          >
            {GitFileNodeRow}
          </Tree>
        </GitFileActionsContext.Provider>
      )}
    </div>
  )
}

function isRenamedFile(node: GitFileNode): boolean {
  return node.file?.status === 'renamed'
}

function focusDiscardButton(event: ReactKeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'Tab' || event.shiftKey) return
  if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'treeitem')
    return
  const button = event.target.querySelector<HTMLButtonElement>('.git-file-discard:not(:disabled)')
  if (!button) return
  event.preventDefault()
  event.stopPropagation()
  button.focus()
}

function GitFileRowContainer({ node, attrs, innerRef, children }: RowRendererProps<GitFileNode>) {
  return (
    <div
      {...attrs}
      aria-expanded={node.isLeaf ? undefined : node.isOpen}
      onClick={(event) => {
        if (event.detail === 2 && node.data.file) return
        node.handleClick(event)
      }}
      onFocus={(event) => event.stopPropagation()}
      ref={innerRef}
      style={{ ...attrs.style, minWidth: 0 }}
    >
      {children}
    </div>
  )
}

function GitFileNodeRow({ node, style }: NodeRendererProps<GitFileNode>) {
  const actions = useContext(GitFileActionsContext)
  if (!actions) throw new Error('Git file row must be inside its list.')
  const { file, name } = node.data

  if (!file) {
    return (
      <div className='git-file-tree-row' style={style} title={name}>
        <span aria-hidden='true'>{node.isOpen ? '⌄' : '›'}</span>
        <span aria-hidden='true'>{node.isOpen ? '▾' : '▸'}</span>
        <span>{name}</span>
      </div>
    )
  }

  const pinFile = (): void => {
    if (file.status !== 'renamed') actions.onSelect(file.path, true)
  }
  const displayPath = actions.treeView ? name : file.path
  const canDiscard = Boolean(actions.onDiscard)
  const discardFile = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    actions.onDiscard?.(file.path)
  }
  const stopTreeKeys = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
  }

  return (
    <div className={`git-file-item${file.status === 'renamed' ? ' renamed' : ''}`} style={style}>
      <div className='git-file-button' onDoubleClick={pinFile}>
        <GitFileRow file={file} path={displayPath} />
      </div>
      {canDiscard && (
        <Tooltip label={`Discard changes to ${file.path}`}>
          <button
            aria-label={`Discard changes to ${file.path}`}
            className='git-file-discard'
            disabled={actions.discardDisabled}
            onClick={discardFile}
            onKeyDown={stopTreeKeys}
            type='button'
          >
            ↶
          </button>
        </Tooltip>
      )}
    </div>
  )
}

/** Displays common file metadata in Git lists. */
export function GitFileRow({ file, path = file.path }: { file: GitFileChange; path?: string }) {
  const fileIcon = resolveFileIcon(file.path)
  const statusLabel = gitStatusLabel(file.status)

  return (
    <>
      <Tooltip hint={`${fileIcon.label} file`} label={statusLabel}>
        <span
          aria-label={`${statusLabel} ${fileIcon.label} file`}
          className={`git-file-status ${file.status}`}
          role='img'
        >
          <span aria-hidden='true' className='git-file-icon' data-color={fileIcon.color}>
            {fileIcon.glyph}
          </span>
        </span>
      </Tooltip>
      <Tooltip label={file.path}>
        <span className='git-file-path'>{path}</span>
      </Tooltip>
      <span className='git-file-counts'>
        <b>+{file.additions ?? '—'}</b>
        <i>−{file.deletions ?? '—'}</i>
      </span>
    </>
  )
}

function gitStatusLabel(status: GitFileChange['status']): string {
  return { added: 'Added', deleted: 'Deleted', modified: 'Modified', renamed: 'Renamed' }[status]
}
