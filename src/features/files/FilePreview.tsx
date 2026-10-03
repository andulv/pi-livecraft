import { openWorkspaceFile } from '../../api.ts'

/** Renders the active file's blob URL; the pane owns fetching and URL lifetime. */
export function MediaFilePreview({
  kind,
  path,
  url,
}: {
  kind: 'image' | 'pdf'
  path: string
  url: string
}) {
  const filename = path.split(/[\\/]/).at(-1) ?? path
  return (
    <div aria-label={`${filename} preview`} className='file-content-media'>
      {kind === 'image'
        ? <img alt={filename} src={url} />
        : (
          <iframe
            referrerPolicy='no-referrer'
            sandbox=''
            src={url}
            title={`${filename} preview`}
          />
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
 * origin: no scripts, forms, popups, navigation, or network requests. The zoom
 * level is injected as a `:root` rule — the parent cannot script into the
 * sandboxed frame, but it builds the document, so zooming needs no access.
 */
export function SandboxedMarkupPreview({ content, path, zoomPercent }: {
  content: string
  path: string
  zoomPercent: number
}) {
  const filename = path.split(/[\\/]/).at(-1) ?? path
  return (
    <iframe
      className='file-content-iframe'
      referrerPolicy='no-referrer'
      sandbox=''
      srcDoc={`<!doctype html><head>${markupPreviewPolicy}`
        + `<style>:root{zoom:${zoomPercent / 100}}</style></head>${content}`}
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
    <p className='file-content-status error' role='alert'>
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
