/** Decodes a URI component without rejecting literal percent signs in paths. */
function decodePath(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function pathLike(value: string): string | null {
  const path = value.trim()
  if (
    path === '~' || path.startsWith('~/') || path.startsWith('/')
    || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\')
  ) return path
  return null
}

/** Reads the standard OSC 7 `file://host/path` working-directory payload. */
export function cwdFromOsc7(data: string): string | null {
  try {
    const url = new URL(data)
    if (url.protocol !== 'file:') return null
    let path = decodePath(url.pathname)
    // File URLs represent Windows drive paths as `/C:/path`.
    if (/^\/[a-zA-Z]:\//.test(path)) path = path.slice(1).replaceAll('/', '\\')
    return pathLike(path)
  } catch {
    return null
  }
}

/** Reads the `cwd` field emitted by shell-integration OSC 3008 markers. */
export function cwdFromOsc3008(data: string): string | null {
  const field = data.split(';').find((part) => part.startsWith('cwd='))
  return field ? pathLike(decodePath(field.slice(4))) : null
}

/** Accepts only path-like titles, including the common `user@host:/path` form. */
export function cwdFromTerminalTitle(title: string): string | null {
  const direct = pathLike(title)
  if (direct) return direct
  const separator = title.lastIndexOf(':')
  return separator >= 0 ? pathLike(title.slice(separator + 1)) : null
}
