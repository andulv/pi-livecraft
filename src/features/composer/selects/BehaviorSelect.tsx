import { ComposerSelect } from './ComposerSelect.tsx'

export function BehaviorSelect({ behavior, onChange }: {
  behavior: 'steer' | 'followUp'
  onChange: (value: 'steer' | 'followUp') => void
}) {
  return (
    <ComposerSelect
      ariaLabel="Next message behavior"
      onValueChange={(value) => onChange(value as 'steer' | 'followUp')}
      options={[{ label: 'Steer', value: 'steer' }, { label: 'Follow up', value: 'followUp' }]}
      tone="behavior"
      value={behavior}
    />
  )
}
