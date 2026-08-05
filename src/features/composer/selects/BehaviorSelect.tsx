import { memo } from 'react'
import { ComposerSelect } from './ComposerSelect.tsx'

/** Toggle between Steer and Follow up modes for the next message sent to Pi. */
export const BehaviorSelect = memo(function BehaviorSelect({ behavior, onChange }: {
  behavior: 'steer' | 'followUp'
  onChange: (value: 'steer' | 'followUp') => void
}) {
  return (
    <ComposerSelect
      ariaLabel='Next message behavior'
      onValueChange={(value) => onChange(value as 'steer' | 'followUp')}
      options={[{ label: 'Steer', value: 'steer' }, { label: 'Follow up', value: 'followUp' }]}
      tone='behavior'
      value={behavior}
    />
  )
})
