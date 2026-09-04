import { memo } from 'react'
import type { JsonObject } from '../../../../shared/types.ts'
import { ComposerSelect } from './ComposerSelect.tsx'

const summaryOptions = [
  { label: 'Default', value: 'default' },
  { label: 'Auto', value: 'auto' },
  { label: 'None', value: 'none' },
  { label: 'Concise', value: 'concise' },
  { label: 'Detailed', value: 'detailed' },
]

/** Selects the per-session reasoning-summary override for models that support it. */
export const SummarySelect = memo(function SummarySelect({ summary, onCommand, onError }: {
  summary: string
  onCommand: (command: JsonObject) => Promise<JsonObject>
  onError: (cause: unknown) => void
}) {
  return (
    <ComposerSelect
      ariaLabel='Reasoning summary'
      onValueChange={(value) =>
        void onCommand({ type: 'prompt', message: `/livecraft-response-controls summary ${value}` })
          .catch(onError)}
      options={summaryOptions}
      tone='response'
      triggerLabel='Reasoning'
      value={summary}
    />
  )
})
