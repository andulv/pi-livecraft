import { readFile } from 'node:fs/promises'
import type { JsonObject, PromptTemplate } from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'

/**
 * Loads the bodies of prompt templates Pi reports for the active session.
 * Pi remains the source of discovery; unreadable templates are omitted so a stale path cannot fail
 * a session snapshot.
 */
export async function loadPromptTemplates(commands: JsonObject[]): Promise<PromptTemplate[]> {
  const templates = commands.flatMap((command) => {
    if (command.source !== 'prompt' || typeof command.name !== 'string') return []
    const path = promptTemplatePath(command)
    return path ? [{ name: command.name, path }] : []
  })
  const contents = await Promise.all(templates.map(async (template) => {
    try {
      return {
        name: template.name,
        content: stripPromptFrontmatter(await readFile(template.path, 'utf8')),
      }
    } catch {
      return null
    }
  }))
  return contents.filter((template): template is PromptTemplate => template !== null)
}

/** Returns the template path from both current and legacy Pi command response shapes. */
function promptTemplatePath(command: JsonObject): string | null {
  if (typeof command.path === 'string') return command.path
  return isObject(command.sourceInfo) && typeof command.sourceInfo.path === 'string'
    ? command.sourceInfo.path
    : null
}

/** Removes optional YAML frontmatter, which Pi uses for template metadata rather than prompt text. */
export function stripPromptFrontmatter(template: string): string {
  if (!template.startsWith('---\n') && !template.startsWith('---\r\n')) return template
  const firstLineEnd = template.indexOf('\n') + 1
  const closing = /^(---|\.\.\.)\r?\n/m.exec(template.slice(firstLineEnd))
  return closing ? template.slice(firstLineEnd + closing.index + closing[0].length) : template
}
