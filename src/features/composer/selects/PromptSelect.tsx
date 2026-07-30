import type { PromptTemplate } from '../../../../shared/types.ts'
import { ComposerSelect } from './ComposerSelect.tsx'

/** Lets users preview and insert prompt templates Pi discovered for the active session. */
export function PromptSelect(
  {
    prompts,
    onOpenChange,
    onPreview,
    onPreviewEnd,
    onSelect,
  }: {
    prompts: PromptTemplate[]
    onOpenChange: (open: boolean) => void
    onPreview: (prompt: PromptTemplate) => void
    onPreviewEnd: () => void
    onSelect: (prompt: PromptTemplate) => void
  },
) {
  return (
    <ComposerSelect
      ariaLabel='Insert prompt template'
      disabled={prompts.length === 0}
      onOpenChange={(open) => {
        if (!open) onPreviewEnd()
        onOpenChange(open)
      }}
      onOptionPointerMove={(name) => {
        const prompt = prompts.find((item) => item.name === name)
        if (prompt) onPreview(prompt)
      }}
      onOptionsPointerLeave={onPreviewEnd}
      onValueChange={(name) => {
        const prompt = prompts.find((item) => item.name === name)
        if (prompt) onSelect(prompt)
      }}
      options={prompts.map((prompt) => ({ label: prompt.name, value: prompt.name }))}
      placeholder='Prompts'
      tone='prompt'
      value=''
    />
  )
}
