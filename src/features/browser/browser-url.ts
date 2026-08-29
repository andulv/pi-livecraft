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
