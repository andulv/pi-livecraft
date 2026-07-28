import { bashPresentation } from './bash.ts'
import { filePresentation } from './file.ts'
import { readPresentation } from './read.ts'
import { searchPresentation } from './search.ts'
import type { ToolCallPresenter } from './shared.ts'

export const toolCallPresentations: Record<string, ToolCallPresenter> = {
  bash: bashPresentation,
  edit: filePresentation,
  find: searchPresentation,
  grep: searchPresentation,
  read: readPresentation,
  write: filePresentation,
}
