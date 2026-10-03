/**
 * Preview classification shared by the browser and the backend raw-file route.
 * The backend is authoritative: `GET /api/files/raw` serves only the MIME types
 * below, classified from the resolved path's final extension, never from a
 * client-provided MIME type. SVG and HTML stay on the text endpoint so they are
 * never returned as a same-origin executable document.
 */

/** Lowercase extension to MIME type for media served by `GET /api/files/raw`. */
export const rawPreviewMimeTypes: Readonly<Record<string, string>> = Object.freeze({
  avif: 'image/avif',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  pdf: 'application/pdf',
  png: 'image/png',
  webp: 'image/webp',
})

/** How the file pane renders a workspace file. */
export type WorkspaceFilePreviewKind = 'markdown' | 'html' | 'svg' | 'image' | 'pdf' | 'text'

/** Classifies a path by its lowercase final extension. */
export function classifyWorkspaceFilePreview(path: string): WorkspaceFilePreviewKind {
  const extension = path.split(/[\\/]/).at(-1)?.split('.').at(-1)?.toLowerCase() ?? ''
  if (extension === 'md' || extension === 'markdown') return 'markdown'
  if (extension === 'html' || extension === 'htm') return 'html'
  if (extension === 'svg') return 'svg'
  const mimeType = rawPreviewMimeTypes[extension]
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType !== undefined) return 'image'
  return 'text'
}
