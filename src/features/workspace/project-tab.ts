const defaultFaviconHref = '/favicon.svg'
const projectColorPattern = /^#[0-9a-f]{6}$/i

/** Returns the concise browser title for a selected project. */
export function projectPageTitle(projectName?: string): string {
  return projectName ? `${projectName} - Livecraft` : 'Pi Livecraft'
}

/** Creates a project-coloured version of the existing SVG favicon. */
export function projectFaviconHref(projectColor?: string): string {
  if (!projectColor || !projectColorPattern.test(projectColor)) return defaultFaviconHref
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="61" y="3" rx="17" fill="${projectColor}" opacity=".55"/><rect width="64" height="61" rx="17" fill="${projectColor}"/><path d="M17 20h30M23 20v25M41 20v25" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" stroke-width="7"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
