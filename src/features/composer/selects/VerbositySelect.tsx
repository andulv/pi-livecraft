import { memo } from 'react'
import type { JsonObject } from '../../../../shared/types.ts'
import { ComposerSelect } from './ComposerSelect.tsx'

const verbosityOptions = [
  { label: 'Default', value: 'default', description: 'Use the model\'s own setting' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
]

/** Selects the per-session response verbosity override for models that support it. */
export const VerbositySelect = memo(function VerbositySelect({ verbosity, onCommand, onError }: {
  verbosity: string
  onCommand: (command: JsonObject) => Promise<JsonObject>
  onError: (cause: unknown) => void
}) {
  return (
    <ComposerSelect
      ariaLabel='Response verbosity'
      onValueChange={(value) =>
        void onCommand({
          type: 'prompt',
          message: `/livecraft-response-controls verbosity ${value}`,
        })
          .catch(onError)}
      options={verbosityOptions}
      tone='response'
      value={verbosity}
    />
  )
})
