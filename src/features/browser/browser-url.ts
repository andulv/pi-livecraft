export { primaryBrowserId } from '../../../shared/browser-port.ts'
import { primaryBrowserId } from '../../../shared/browser-port.ts'

const legacyBrowserUrlStorageKey = 'pi-livecraft.browser-url'

interface BrowserUrlStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

function browserUrlStorage(): BrowserUrlStorage | undefined {
  return (globalThis as typeof globalThis & { localStorage?: BrowserUrlStorage }).localStorage
}

/** Builds a URL storage key scoped to one workspace and browser instance. */
export function browserUrlStorageKey(workspacePath: string, browserId: string): string {
  return `pi-livecraft.browser-url:${encodeURIComponent(workspacePath)}:${browserId}`
}

/** Reads one instance URL and migrates the old installation-wide value once. */
export function readBrowserUrl(
  workspacePath: string,
  browserId: string,
  storage: BrowserUrlStorage | undefined = browserUrlStorage(),
): string {
  if (!storage) return ''
  const key = browserUrlStorageKey(workspacePath, browserId)
  const stored = storage.getItem(key)
  if (stored !== null) return stored
  if (browserId !== primaryBrowserId) return ''
  const legacy = storage.getItem(legacyBrowserUrlStorageKey)
  if (legacy === null) return ''
  storage.setItem(key, legacy)
  storage.removeItem(legacyBrowserUrlStorageKey)
  return legacy
}

/** Persists the URL for one workspace and browser instance. */
export function writeBrowserUrl(
  workspacePath: string,
  browserId: string,
  url: string,
  storage: BrowserUrlStorage | undefined = browserUrlStorage(),
): void {
  storage?.setItem(browserUrlStorageKey(workspacePath, browserId), url)
}

/** Normalizes address-bar input into a navigable http(s) URL, or null when unusable. */
export function normalizeBrowserUrl(input: string): string | null {
  const value = input.trim()
  if (value === '') return null
  if (/^https?:\/\//i.test(value)) return value
  const host = value.split('/')[0] ?? ''
  // Local hosts must be checked first: "localhost:3000" otherwise reads as a scheme.
  const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)
    || /^\d{1,3}(?:\.\d{1,3}){3}(:\d+)?$/.test(host)
  if (localHost) return `http://${value}`
  // Reject other schemes (javascript:, data:) outright; only http(s) may be framed.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null
  return `https://${value}`
}
