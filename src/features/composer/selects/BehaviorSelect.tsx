import { memo } from 'react'
import { ComposerSelect } from './ComposerSelect.tsx'

/** Selects the next message's mode; Queue is displayed but unavailable until queueing ships. */
export const BehaviorSelect = memo(function BehaviorSelect({ behavior, onChange }: {
  behavior: 'steer' | 'followUp'
  onChange: (value: 'steer' | 'followUp') => void
}) {
  return (
    <ComposerSelect
      ariaLabel='Next message behavior'
      onValueChange={(value) => onChange(value as 'steer' | 'followUp')}
      options={[
        { label: 'Steer', value: 'steer' },
        { label: 'Queue', value: 'followUp', disabled: true },
      ]}
      tone='behavior'
      value={behavior}
    />
  )
})
