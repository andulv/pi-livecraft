import { parse, stringify } from 'yaml'

export interface MarkdownFrontmatter {
  body: string
  entries: { key: string; value: string }[]
}

/** Extracts a complete leading YAML front matter block without altering invalid Markdown. */
export function parseMarkdownFrontmatter(markdown: string): MarkdownFrontmatter | null {
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(
    markdown,
  )
  if (!match) return null

  try {
    const parsed: unknown = parse(match[1] ?? '')
    if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) return null

    return {
      body: markdown.slice(match[0].length),
      entries: Object.entries(parsed ?? {}).map(([key, value]) => ({
        key,
        value: typeof value === 'string' ? value : stringify(value).trimEnd(),
      })),
    }
  } catch {
    return null
  }
}
