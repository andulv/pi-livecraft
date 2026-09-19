import { memo } from 'react'
import type { PromptTemplate } from '../../../../shared/types.ts'
import { ComposerSelect } from './ComposerSelect.tsx'

type ImproveOption = { label: string; value: string }

/** Groups prompt-template and draft-improvement actions behind the compact composer menu. */
export const PromptSelect = memo(function PromptSelect(
  {
    prompts,
    canImprove,
    canSave,
    improving,
    improveOptions,
    onImprove,
    onOpenChange,
    onPreview,
    onPreviewEnd,
    onSave,
    onSelect,
  }: {
    prompts: PromptTemplate[]
    canImprove: boolean
    canSave: boolean
    improving: boolean
    improveOptions: ImproveOption[]
    onImprove: (direction: string) => void
    onOpenChange: (open: boolean) => void
    onPreview: (prompt: PromptTemplate) => void
    onPreviewEnd: () => void
    onSave: (scope: 'global' | 'project') => void
    onSelect: (prompt: PromptTemplate) => void
  },
) {
  const options = [
    ...improveOptions.map((option) => ({
      description: `Improve the draft: ${option.label.toLowerCase()}`,
      disabled: !canImprove,
      label: `Improve: ${option.label}`,
      value: `improve:${option.value}`,
    })),
    ...(canSave
      ? [
        {
          description: 'Create .pi/prompts/<name>.md',
          kind: 'action' as const,
          label: 'Save prompt for this project',
          value: 'action:save-project',
        },
        {
          description: 'Create ~/.pi/agent/prompts/<name>.md',
          kind: 'action' as const,
          label: 'Save prompt globally',
          value: 'action:save-global',
        },
      ]
      : []),
    ...prompts.map((prompt) => ({
      description: prompt.description,
      label: prompt.name,
      value: `prompt:${prompt.name}`,
    })),
  ]

  return (
    <ComposerSelect
      ariaLabel='More composer actions'
      loading={improving}
      onOpenChange={(open) => {
        if (!open) onPreviewEnd()
        onOpenChange(open)
      }}
      onOptionPointerMove={(value) => {
        const name = value.startsWith('prompt:') ? value.slice('prompt:'.length) : ''
        const prompt = prompts.find((item) => item.name === name)
        if (prompt) onPreview(prompt)
        else onPreviewEnd()
      }}
      onOptionsPointerLeave={onPreviewEnd}
      onValueChange={(value) => {
        if (value.startsWith('improve:')) onImprove(value.slice('improve:'.length))
        else if (value === 'action:save-project') onSave('project')
        else if (value === 'action:save-global') onSave('global')
        else {
          const name = value.startsWith('prompt:') ? value.slice('prompt:'.length) : ''
          const prompt = prompts.find((item) => item.name === name)
          if (prompt) onSelect(prompt)
        }
      }}
      options={options}
      placeholder='More composer actions'
      tone='actions'
      value=''
    />
  )
})
