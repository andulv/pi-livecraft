import { useEffect, useRef, useState } from 'react'
import { getWorkspaceFile } from '../../api.ts'

interface FileState {
  content: string
  error: string | null
  loading: boolean
}

export function FileContentPane({
  activePath,
  onActivate,
  onClose,
  openPaths,
  workspacePath,
}: {
  activePath: string | null
  onActivate: (path: string) => void
  onClose: (path: string) => void
  openPaths: readonly string[]
  workspacePath: string
}) {
  const [files, setFiles] = useState<Record<string, FileState>>({})
  const filesRef = useRef(files)
  filesRef.current = files

  useEffect(() => {
    setFiles({})
  }, [workspacePath])

  useEffect(() => {
    if (!activePath || filesRef.current[activePath]) return
    let cancelled = false
    setFiles((current) => ({
      ...current,
      [activePath]: { content: '', error: null, loading: true },
    }))
    void getWorkspaceFile(workspacePath, activePath)
      .then((file) => {
        if (!cancelled)
          setFiles((current) => ({
            ...current,
            [activePath]: { content: file.content, error: null, loading: false },
          }))
      })
      .catch((cause) => {
        if (!cancelled)
          setFiles((current) => ({
            ...current,
            [activePath]: {
              content: '',
              error: cause instanceof Error ? cause.message : String(cause),
              loading: false,
            },
          }))
      })
    return () => {
      cancelled = true
    }
  }, [activePath, workspacePath])

  const activeFile = activePath ? files[activePath] : undefined
  return (
    <aside aria-label='File contents' className='file-content-pane'>
      <div className='file-tabs' role='tablist' aria-label='Open files'>
        {openPaths.map((path) => (
          <div className={`file-tab${path === activePath ? ' active' : ''}`} key={path}>
            <button
              aria-selected={path === activePath}
              onClick={() =>
                onActivate(path)}
              role='tab'
              title={path}
              type='button'
            >
              {path
                .split(/[\\/]/)
                .at(-1)}
            </button>
            <button
              aria-label={`Close ${
                path
                  .split(/[\\/]/)
                  .at(-1)
              }`}
              className='file-tab-close'
              onClick={() =>
                onClose(path)}
              type='button'
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {activePath
        ? (
          <div className='file-content'>
            <div className='file-content-header'>
              <span title={activePath}>{activePath}</span>
              <small>Read-only preview</small>
            </div>
            {activeFile?.loading && <p className='file-content-status'>Loading file…</p>}
            {activeFile?.error && <p className='file-content-status error'>{activeFile.error}</p>}
            {activeFile && !activeFile.loading && !activeFile.error && (
              <textarea
                aria-label={activePath}
                readOnly
                spellCheck={false}
                value={activeFile.content}
              />
            )}
          </div>
        )
        : <p className='file-content-empty'>Open a file from the explorer to preview it.</p>}
    </aside>
  )
}
