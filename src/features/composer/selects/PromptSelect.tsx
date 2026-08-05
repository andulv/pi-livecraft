import { memo } from 'react'
import type { PromptTemplate } from '../../../../shared/types.ts'
import { ComposerSelect } from './ComposerSelect.tsx'

/** Lets users preview and insert prompt templates Pi discovered for the active session. */
export const PromptSelect = memo(function PromptSelect(
  {
    prompts,
    canSave,
    onOpenChange,
    onPreview,
    onPreviewEnd,
    onSave,
    onSelect,
  }: {
    prompts: PromptTemplate[]
    canSave: boolean
    onOpenChange: (open: boolean) => void
    onPreview: (prompt: PromptTemplate) => void
    onPreviewEnd: () => void
    onSave: (scope: 'global' | 'project') => void
    onSelect: (prompt: PromptTemplate) => void
  },
) {
  return (
    <ComposerSelect
      ariaLabel='Insert prompt template'
      disabled={prompts.length === 0 && !canSave}
      onOpenChange={(open) => {
        if (!open) onPreviewEnd()
        onOpenChange(open)
      }}
      onOptionPointerMove={(name) => {
        const prompt = prompts.find((item) => item.name === name)
        if (prompt) onPreview(prompt)
        else onPreviewEnd()
      }}
      onOptionsPointerLeave={onPreviewEnd}
      onValueChange={(name) => {
        if (name === 'action:save-project') onSave('project')
        else if (name === 'action:save-global') onSave('global')
        else {
          const prompt = prompts.find((item) => item.name === name)
          if (prompt) onSelect(prompt)
        }
      }}
      options={[
        ...(canSave
          ? [
            {
              description: 'Create .pi/prompts/<name>.md',
              kind: 'action' as const,
              label: 'Save for this project',
              value: 'action:save-project',
            },
            {
              description: 'Create ~/.pi/agent/prompts/<name>.md',
              kind: 'action' as const,
              label: 'Save globally',
              value: 'action:save-global',
            },
          ]
          : []),
        ...prompts.map((prompt) => ({
          description: prompt.description,
          label: prompt.name,
          value: prompt.name,
        })),
      ]}
      placeholder='Prompts'
      tone='prompt'
      value=''
    />
  )
})
