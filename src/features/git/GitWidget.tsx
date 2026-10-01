import { useCallback, useEffect, useRef, useState } from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'
import type {
  GitCommitFiles,
  GitFileChange,
  GitFileDiff,
  GitHistoryCommit,
  GitOutgoingChanges,
  GitPushResult,
  GitResetResult,
  GitRevertResult,
  GitSnapshot,
} from '../../../shared/types.ts'
import { GitFileList, GitFileRow } from './GitFileList.tsx'
import { WidgetLayout } from '../right-sidebar/WidgetLayout.tsx'
import type { RequestCause } from '../../api.ts'

/** Local git-error target — which element to shake on failure. */
type ErrorTarget = 'pull' | 'push' | 'commit' | 'discard' | 'refresh'
type GitView = 'changes' | 'outgoing' | 'history'
type CommitFilesState =
  | { state: 'loading' }
  | { state: 'loaded'; files: GitFileChange[] }
  | { state: 'error' }

/** Owns Git-specific actions and opens selected diffs in the viewer pane. */
export function GitWidget(
  {
    snapshot,
    onCommit,
    onDiscard,
    onFileSelect,
    onCommitFiles,
    onOutgoingChanges,
    onOutgoingFileSelect,
    onOpenDiff,
    onPull,
    onPush,
    onRefresh,
    onReset,
    onRevert,
  }: {
    snapshot: GitSnapshot
    onCommit: (message: string) => Promise<void>
    onDiscard: (path?: string) => Promise<void>
    onFileSelect: (path: string, commitHash?: string) => Promise<GitFileDiff>
    onCommitFiles: (hash: string) => Promise<GitCommitFiles>
    onOutgoingChanges: () => Promise<GitOutgoingChanges>
    onOutgoingFileSelect: (path: string) => Promise<GitFileDiff>
    onOpenDiff: (
      path: string,
      diff: string,
      before: string,
      beforeAvailable: boolean,
      after: string,
      afterAvailable: boolean,
      commitHash?: string,
      pin?: boolean,
    ) => void
    onPull: () => Promise<void>
    onPush: () => Promise<GitPushResult>
    onRefresh: (cause: RequestCause) => Promise<void>
    onReset: (hash: string) => Promise<GitResetResult>
    onRevert: (hash: string) => Promise<GitRevertResult>
  },
) {
  const [message, setMessage] = useState('')
  const [activeView, setActiveView] = useState<GitView>('changes')
  const [busy, setBusy] = useState(false)
  const [exitingCommits, setExitingCommits] = useState<ReadonlySet<string>>(new Set())
  const [outgoingFiles, setOutgoingFiles] = useState<GitOutgoingChanges['files'] | null>(null)
  const [commitFiles, setCommitFiles] = useState<Record<string, CommitFilesState>>({})
  const pendingCommitFilesRef = useRef(new Set<string>())
  const [fileTreeView, setFileTreeView] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [errorTarget, setErrorTarget] = useState<ErrorTarget | null>(null)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hasChanges = snapshot.files.length > 0
  const treeStatus = hasChanges
    ? `${snapshot.files.length} file${snapshot.files.length > 1 ? 's' : ''} modified`
    : 'Clean tree'
  const divergenceStatus = snapshot.worktree && snapshot.baseBranch
    ? ` · vs ${snapshot.baseBranch} +${snapshot.baseAhead} −${snapshot.baseBehind}`
    : ''

  /** Clears any stuck error highlight after the shake animation ends. */
  useEffect(() => {
    if (!errorTarget) return
    clearTimeout(errorTimerRef.current)
    errorTimerRef.current = setTimeout(() => setErrorTarget(null), 500)
    return () => clearTimeout(errorTimerRef.current)
  }, [errorTarget])

  /** Clears the current Git error so the next action can report independently. */
  const clearError = useCallback(() => {
    setErrorMessage(null)
    setErrorTarget(null)
  }, [])

  /** Reports a failed Git action inside the widget and highlights its control when available. */
  function reportError(error: unknown, target?: ErrorTarget): void {
    setErrorMessage(error instanceof Error ? error.message : 'Git command failed.')
    setErrorTarget(target ?? null)
  }

  /** Loads a diff, then opens it as a viewer-pane preview tab. */
  async function selectFile(path: string, commitHash?: string, pin?: boolean): Promise<void> {
    clearError()
    try {
      const fileDiff = await onFileSelect(path, commitHash)
      onOpenDiff(
        path,
        fileDiff.diff,
        fileDiff.before,
        fileDiff.beforeAvailable,
        fileDiff.after,
        fileDiff.afterAvailable,
        commitHash,
        pin,
      )
    } catch (error) {
      reportError(error)
    }
  }

  /** Expanding a commit loads its files once, without blocking the initial Git snapshot. */
  function loadCommitFiles(hash: string): void {
    if (pendingCommitFilesRef.current.has(hash) || commitFiles[hash]?.state === 'loaded') return
    pendingCommitFilesRef.current.add(hash)
    setCommitFiles((current) => ({ ...current, [hash]: { state: 'loading' } }))
    void onCommitFiles(hash)
      .then(({ files }) => {
        setCommitFiles((current) => ({ ...current, [hash]: { state: 'loaded', files } }))
      })
      .catch((error) => {
        setCommitFiles((current) => ({ ...current, [hash]: { state: 'error' } }))
        reportError(error)
      })
      .finally(() => pendingCommitFilesRef.current.delete(hash))
  }

  /** Loads the aggregate changed-file list for all outgoing commits. */
  async function selectOutgoingChanges(): Promise<void> {
    clearError()
    try {
      setOutgoingFiles((await onOutgoingChanges()).files)
    } catch (error) {
      reportError(error)
    }
  }

  /** Opens one aggregate file diff in the viewer-pane preview tab. */
  async function selectOutgoingFile(path: string, pin?: boolean): Promise<void> {
    clearError()
    try {
      const fileDiff = await onOutgoingFileSelect(path)
      onOpenDiff(
        path,
        fileDiff.diff,
        fileDiff.before,
        fileDiff.beforeAvailable,
        fileDiff.after,
        fileDiff.afterAvailable,
        undefined,
        pin,
      )
    } catch (error) {
      reportError(error)
    }
  }

  /** Commits all changes with the current message, then refreshes. */
  async function commit(): Promise<void> {
    setBusy(true)
    clearError()
    try {
      await onCommit(message)
      setMessage('')
      await onRefresh('git:after-commit')
    } catch (error) {
      reportError(error, 'commit')
    } finally {
      setBusy(false)
    }
  }

  /** Pushes commits ahead of the tracked branch, fading them out before refresh. */
  async function push(): Promise<void> {
    setBusy(true)
    clearError()
    try {
      const result = await onPush()
      if (result.pushError) throw new Error(result.pushError)
      // ponytail: fade all then refresh; per-commit fade not worth the wiring
      setExitingCommits(new Set(snapshot.commits.map((c) => c.hash)))
      await new Promise((r) => setTimeout(r, 300))
      await onRefresh('git:after-push')
      setExitingCommits(new Set())
    } catch (error) {
      reportError(error, 'push')
    } finally {
      setBusy(false)
    }
  }

  /** Fast-forwards from the tracked remote, then refreshes all Git views. */
  async function pull(): Promise<void> {
    setBusy(true)
    clearError()
    try {
      await onPull()
      await onRefresh('git:after-pull')
    } catch (error) {
      reportError(error, 'pull')
    } finally {
      setBusy(false)
    }
  }

  /** Discards one file or all uncommitted changes after confirmation, then refreshes. */
  async function discard(path?: string): Promise<void> {
    const target = path ? `changes to ${path}` : 'all uncommitted changes'
    if (!window.confirm(`Discard ${target}? This will delete new files and revert modifications.`))
      return
    setBusy(true)
    clearError()
    try {
      await onDiscard(path)
      await onRefresh('git:after-discard')
    } catch (error) {
      reportError(error, 'discard')
    } finally {
      setBusy(false)
    }
  }

  /** Resets the latest commit after confirming that its changes stay local, fading its row before refresh. */
  async function resetCommit(hash: string): Promise<void> {
    if (
      !window.confirm(
        `Reset latest commit ${hash.slice(0, 7)}? Its changes will be kept in the working tree.`,
      )
    ) return
    setBusy(true)
    clearError()
    try {
      await onReset(hash)
      setExitingCommits(new Set([hash]))
      await new Promise((r) => setTimeout(r, 300))
      await onRefresh('git:after-reset')
      setExitingCommits(new Set())
    } catch (error) {
      reportError(error, 'commit')
    } finally {
      setBusy(false)
    }
  }

  /** Reverts the chosen commit after confirmation, then refreshes so the new revert commit appears. */
  async function revertCommit(hash: string): Promise<void> {
    if (!window.confirm(`Revert commit ${hash.slice(0, 7)}?`)) return
    setBusy(true)
    clearError()
    try {
      await onRevert(hash)
      await onRefresh('git:after-revert')
    } catch (error) {
      reportError(error, 'commit')
    } finally {
      setBusy(false)
    }
  }

  /** Manual Git refresh with local error handling. */
  async function handleRefresh(): Promise<void> {
    clearError()
    try {
      await onRefresh('git:manual')
    } catch (error) {
      reportError(error, 'refresh')
    }
  }

  return (
    <WidgetLayout
      footer={
        <form
          className='git-actions'
          onSubmit={(event) => {
            event.preventDefault()
            void commit()
          }}
        >
          <input
            aria-label='Commit message'
            disabled={busy}
            onChange={(event) => setMessage(event.target.value)}
            placeholder='Commit message'
            value={message}
          />
          <button
            className={`git-commit-submit${errorTarget === 'commit' ? ' shake' : ''}`}
            disabled={busy || !hasChanges || !message.trim()}
            type='submit'
          >
            Commit
          </button>
          <div className='git-action-buttons'>
            <button
              aria-label={snapshot.behind && snapshot.behind > 0
                ? `Pull ${snapshot.behind} remote commit${snapshot.behind === 1 ? '' : 's'}`
                : 'Pull from remote'}
              className={errorTarget === 'pull' ? 'shake' : ''}
              disabled={busy}
              onClick={() => void pull()}
              type='button'
            >
              Pull{snapshot.behind && snapshot.behind > 0 ? ` ${snapshot.behind}` : ''}
            </button>
            <button
              className={errorTarget === 'push' ? 'shake' : ''}
              disabled={busy || snapshot.ahead === 0}
              onClick={() => void push()}
              type='button'
            >
              Push{snapshot.ahead > 0 ? ` ${snapshot.ahead}` : ''}
            </button>
            <button
              className={`git-discard${errorTarget === 'discard' ? ' shake' : ''}`}
              disabled={busy || !hasChanges}
              onClick={() => void discard()}
              type='button'
            >
              Reset
            </button>
          </div>
        </form>
      }
      header={
        <>
          <div>
            <strong>{snapshot.branch}</strong>
            <span
              title={snapshot.baseBranch
                ? `${snapshot.baseAhead} commits ahead of ${snapshot.baseBranch}, ${snapshot.baseBehind} behind`
                : treeStatus}
            >
              {treeStatus}
              {divergenceStatus}
            </span>
          </div>
          <div className='git-header-actions'>
            <Tooltip label='Refresh'>
              <button
                aria-label='Refresh Git state'
                className={`git-refresh${errorTarget === 'refresh' ? ' shake' : ''}`}
                onClick={() => void handleRefresh()}
                type='button'
              >
                ↻
              </button>
            </Tooltip>
            <details className='git-options'>
              <summary aria-label='Git display options'>…</summary>
              <div role='menu'>
                <button
                  aria-checked={fileTreeView}
                  onClick={() => setFileTreeView((treeView) => !treeView)}
                  role='menuitemcheckbox'
                  type='button'
                >
                  {fileTreeView ? 'Show files in flat view' : 'Show files in tree view'}
                </button>
              </div>
            </details>
          </div>
        </>
      }
    >
      {errorMessage && <p className='git-error' role='alert'>{errorMessage}</p>}
      <>
        <nav aria-label='Git view' className='git-tabs'>
          {(['changes', 'outgoing', 'history'] as const).map((view) => (
            <button
              aria-pressed={activeView === view}
              className={activeView === view ? 'active' : ''}
              key={view}
              onClick={() => setActiveView(view)}
              type='button'
            >
              <span className='git-tab-label'>{gitViewLabel(view)}</span>
              {view !== 'history' && (
                <small>
                  {view === 'changes'
                    ? snapshot
                      .files
                      .length
                    : snapshot
                      .commits
                      .length}
                </small>
              )}
            </button>
          ))}
        </nav>
        {activeView === 'changes' && (
          hasChanges
            ? (
              <GitFileList
                discardDisabled={busy}
                files={snapshot.files}
                onDiscard={(path) => void discard(path)}
                onSelect={(path, pin) => void selectFile(path, undefined, pin)}
                treeView={fileTreeView}
              />
            )
            : <p className='git-empty'>No changes to commit.</p>
        )}
        {activeView === 'outgoing' && (
          snapshot.commits.length > 0
            ? (
              <section
                className={`git-commits${
                  exitingCommits.size === snapshot.commits.length ? ' exiting' : ''
                }`}
                aria-label='Unpushed commits'
              >
                <button
                  className='git-outgoing-diff'
                  aria-expanded={outgoingFiles !== null}
                  onClick={() => {
                    if (outgoingFiles) setOutgoingFiles(null)
                    else void selectOutgoingChanges()
                  }}
                  type='button'
                >
                  {outgoingFiles ? 'Show commits' : 'Show unified changes'}
                </button>
                {outgoingFiles && (
                  <GitFileList
                    files={outgoingFiles}
                    onSelect={(path, pin) => void selectOutgoingFile(path, pin)}
                    treeView={fileTreeView}
                  />
                )}
                {!outgoingFiles && snapshot.commits.map((commit, index) => {
                  const filesState = commitFiles[commit.hash]
                  return (
                    <div
                      className={`git-commit${exitingCommits.has(commit.hash) ? ' exiting' : ''}`}
                      key={commit.hash}
                    >
                      <details
                        onToggle={(event) => {
                          if (event.currentTarget.open) loadCommitFiles(commit.hash)
                        }}
                      >
                        <summary>
                          <Tooltip label={commit.subject}>
                            <code>{commit.hash.slice(0, 7)}</code>
                            <span>{commit.subject}</span>
                          </Tooltip>
                        </summary>
                        {filesState?.state === 'loaded' && filesState.files.length > 0
                          ? (
                            <ul className='git-file-list git-commit-files'>
                              {filesState.files.map((file) => (
                                <li
                                  className='git-file-item'
                                  key={file.path}
                                >
                                  {file.status === 'added' || file.status === 'modified'
                                      || file.status === 'deleted'
                                    ? (
                                      <button
                                        className='git-file-button'
                                        onClick={(event) =>
                                          void selectFile(
                                            file.path,
                                            commit.hash,
                                            event.detail === 2,
                                          )}
                                        type='button'
                                      >
                                        <GitFileRow file={file} />
                                      </button>
                                    )
                                    : <GitFileRow file={file} />}
                                </li>
                              ))}
                            </ul>
                          )
                          : (
                            <p className='git-empty'>
                              {filesState?.state === 'loaded'
                                ? 'No files modified.'
                                : filesState?.state === 'error'
                                ? 'Could not load files. Close and reopen to retry.'
                                : 'Loading files…'}
                            </p>
                          )}
                      </details>
                      <div className='git-commit-actions'>
                        <Tooltip label='Revert this commit'>
                          <button
                            aria-label={`Revert commit ${commit.hash.slice(0, 7)}`}
                            className='git-commit-action git-revert'
                            disabled={busy}
                            onClick={() => void revertCommit(commit.hash)}
                            type='button'
                          >
                            ↶
                          </button>
                        </Tooltip>
                        {index === 0 && (
                          <Tooltip label='Reset this commit'>
                            <button
                              aria-label={`Reset commit ${commit.hash.slice(0, 7)}`}
                              className='git-commit-action git-reset'
                              disabled={busy}
                              onClick={() => void resetCommit(commit.hash)}
                              type='button'
                            >
                              🗑︎
                            </button>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  )
                })}
              </section>
            )
            : <p className='git-empty'>No commits to push.</p>
        )}
        {activeView === 'history' && <GitHistoryList commits={snapshot.history} />}
      </>
    </WidgetLayout>
  )
}

function gitViewLabel(view: GitView): string {
  return { changes: 'Changes', outgoing: 'Outgoing', history: 'History' }[view]
}

/** Displays the latest commits without offering destructive actions. */
function GitHistoryList({ commits }: { commits: readonly GitHistoryCommit[] }) {
  if (commits.length === 0) return <p className='git-empty'>No commits yet.</p>

  return (
    <section aria-label='Recent commits' className='git-history'>
      <p>Latest {commits.length} commit{commits.length === 1 ? '' : 's'}</p>
      <ul>
        {commits.map((commit) => (
          <li key={commit.hash}>
            <Tooltip label={commit.subject}>
              <code>{commit.hash.slice(0, 7)}</code>
              <span>{commit.subject}</span>
            </Tooltip>
          </li>
        ))}
      </ul>
    </section>
  )
}
