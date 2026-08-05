import { memo, type RefObject } from 'react'
import type { JsonObject } from '../../../../shared/types.ts'
import { ComposerSelect } from './ComposerSelect.tsx'
import { capitalizeLabel } from '../composer-utils.ts'

const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** Selects the thinking effort level sent to Pi, from off to max. */
export const ThinkingSelect = memo(
  function ThinkingSelect({ thinking, onCommand, onError, open, onOpenChange, triggerRef }: {
    thinking: string
    onCommand: (command: JsonObject) => Promise<JsonObject>
    onError: (cause: unknown) => void
    open: boolean
    onOpenChange: (open: boolean) => void
    triggerRef: RefObject<HTMLButtonElement | null>
  }) {
    return (
      <ComposerSelect
        ariaLabel='Thinking level'
        onOpenChange={onOpenChange}
        open={open}
        onValueChange={(value) =>
          void onCommand({ type: 'set_thinking_level', level: value }).catch(onError)}
        options={thinkingLevels.map((level) => ({ label: capitalizeLabel(level), value: level }))}
        tone='thinking'
        triggerRef={triggerRef}
        value={thinking}
      />
    )
  },
)
