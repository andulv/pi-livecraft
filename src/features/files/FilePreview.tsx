import { useEffect, useState } from 'react'
import { getWorkspaceFileRaw, openWorkspaceFile } from '../../api.ts'

interface MediaState {
  url: string | null
  error: string | null
  loading: boolean
}

/**
 * Previews one image or PDF by fetching it as a blob URL through the API
 * boundary. The URL is revoked and the fetch aborted when the path, workspace,
 * or component goes away.
 */
export function MediaFilePreview({
  kind,
  path,
  workspacePath,
}: {
  kind: 'image' | 'pdf'
  path: string
  workspacePath: string
}) {
  const [state, setState] = useState<MediaState>({ url: null, error: null, loading: true })

  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | null = null
    setState({ url: null, error: null, loading: true })
    getWorkspaceFileRaw(workspacePath, path, controller.signal)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        setState({ url: objectUrl, error: null, loading: false })
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setState({
          url: null,
          error: cause instanceof Error ? cause.message : String(cause),
          loading: false,
        })
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path, workspacePath])

  const filename = path.split(/[\\/]/).at(-1) ?? path
  return (
    <div aria-label={`${filename} preview`} className='file-content-media'>
      {state.loading && <p className='file-content-status'>Loading file…</p>}
      {state.error && (
        <FilePreviewError message={state.error} path={path} workspacePath={workspacePath} />
      )}
      {state.url && (
        kind === 'image'
          ? <img alt={filename} src={state.url} />
          : (
            <iframe
              referrerPolicy='no-referrer'
              sandbox=''
              src={state.url}
              title={`${filename} preview`}
            />
          )
      )}
    </div>
  )
}

/**
 * Restrictive CSP prepended to previewed HTML and SVG. The iframe's empty
 * sandbox is the hard boundary (opaque origin, no scripts); this additionally
 * blocks network requests and forms.
 */
const markupPreviewPolicy =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; '
  + 'img-src data: blob:; font-src data:; style-src \'unsafe-inline\'; '
  + 'form-action \'none\'; base-uri \'none\'">'

/**
 * Renders previewed HTML or SVG text in a sandboxed document with an opaque
 * origin: no scripts, forms, popups, navigation, or network requests.
 */
export function SandboxedMarkupPreview({ content, path }: { content: string; path: string }) {
  const filename = path.split(/[\\/]/).at(-1) ?? path
  return (
    <iframe
      className='file-content-iframe'
      referrerPolicy='no-referrer'
      sandbox=''
      srcDoc={`<!doctype html><head>${markupPreviewPolicy}</head>${content}`}
      title={`${filename} preview`}
    />
  )
}

/** A preview failure with the existing open-in-default-application action. */
export function FilePreviewError({
  message,
  path,
  workspacePath,
}: {
  message: string
  path: string
  workspacePath: string
}) {
  return (
    <p className='file-content-status error'>
      {message}
      <button
        className='file-open-external'
        onClick={() => void openWorkspaceFile(workspacePath, path)}
        type='button'
      >
        Open externally
      </button>
    </p>
  )
}
