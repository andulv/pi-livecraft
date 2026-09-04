import { useEffect, useState } from 'react'
import type {
  ExtensionSettingDefinition,
  ExtensionSettingsSnapshot,
  ExtensionSettingValue,
} from '../../../shared/extension-settings.ts'

interface ExtensionSettingsProps {
  snapshot: ExtensionSettingsSnapshot | null
  error: string | null
  onChange: (extension: string, id: string, value: ExtensionSettingValue | null) => void
  onRetry: () => void
}

/**
 * Renders settings that installed Pi extensions published themselves, so a new
 * extension appears here without any change to this component. Values are stored
 * in Pi's own configuration and are shared with the `pi` command line.
 */
export function ExtensionSettings(
  { snapshot, error, onChange, onRetry }: ExtensionSettingsProps,
) {
  if (error) {
    return (
      <section className='extension-settings'>
        <p className='extension-settings-error'>{error}</p>
        <button onClick={onRetry} type='button'>Try again</button>
      </section>
    )
  }
  if (!snapshot) {
    return (
      <section className='extension-settings'>
        <p>Reading extension settings…</p>
      </section>
    )
  }
  if (snapshot.groups.length === 0) {
    return (
      <section className='extension-settings'>
        <p>
          No Pi extension has published settings yet. Open a Pi session so its extensions can
          publish them, then read the settings again.
        </p>
        <button onClick={onRetry} type='button'>Read again</button>
        <small className='extension-settings-path'>{snapshot.path}</small>
      </section>
    )
  }

  return (
    <section className='extension-settings'>
      <p>
        These values are stored in Pi's own configuration, so they also apply to the <code>pi</code>
        {' '}
        command line and to sessions started elsewhere.
      </p>
      {snapshot.groups.map((group) => {
        const primary = group.settings.filter((definition) => !definition.advanced)
        const advanced = group.settings.filter((definition) => definition.advanced)
        return (
          <div className='extension-settings-group' key={group.name}>
            <h3>{group.name}</h3>
            {group.description && <p>{group.description}</p>}
            {primary.map((definition) => (
              <SettingRow
                definition={definition}
                extension={group.name}
                key={definition.id}
                snapshot={snapshot}
                onChange={onChange}
              />
            ))}
            {advanced.length > 0 && (
              <details className='extension-settings-advanced'>
                <summary>Advanced</summary>
                {advanced.map((definition) => (
                  <SettingRow
                    definition={definition}
                    extension={group.name}
                    key={definition.id}
                    snapshot={snapshot}
                    onChange={onChange}
                  />
                ))}
              </details>
            )}
          </div>
        )
      })}
      <small className='extension-settings-path'>{snapshot.path}</small>
    </section>
  )
}

interface SettingRowProps {
  definition: ExtensionSettingDefinition
  extension: string
  snapshot: ExtensionSettingsSnapshot
  onChange: (extension: string, id: string, value: ExtensionSettingValue | null) => void
}

/** One published setting: an enum or boolean choice commits immediately, text commits on blur. */
function SettingRow({ definition, extension, snapshot, onChange }: SettingRowProps) {
  const stored = snapshot.values[extension]?.[definition.id]
  const override = snapshot.overrides.find((entry) =>
    entry.extension === extension && entry.id === definition.id
  )
  const [draft, setDraft] = useState(stored === undefined ? '' : String(stored))

  useEffect(() => {
    setDraft(stored === undefined ? '' : String(stored))
  }, [stored])

  const commitDraft = () => {
    const next = draft.trim()
    if (next === (stored === undefined ? '' : String(stored))) return
    onChange(extension, definition.id, next === '' ? null : next)
  }

  const fallback = definition.defaultValue === undefined ? '' : String(definition.defaultValue)
  const editable = !override

  return (
    <div className='extension-setting-row'>
      <span className='extension-setting-label'>
        {definition.label}
        {override && <small className='extension-setting-badge'>Overridden by {override.env}
        </small>}
        {definition.description && <small>{definition.description}</small>}
        {definition.effect === 'reload-required' && <small>Applies after a Pi reload.</small>}
      </span>
      <span className='extension-setting-control'>
        {definition.type === 'enum' && (
          <select
            aria-label={definition.label}
            disabled={!editable}
            onChange={(event) => onChange(extension, definition.id, event.target.value)}
            value={stored === undefined ? fallback : String(stored)}
          >
            {(definition.options ?? []).map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        )}
        {definition.type === 'boolean' && (
          <select
            aria-label={definition.label}
            disabled={!editable}
            onChange={(event) => onChange(extension, definition.id, event.target.value === 'true')}
            value={stored === undefined ? fallback : String(stored)}
          >
            <option value='true'>On</option>
            <option value='false'>Off</option>
          </select>
        )}
        {(definition.type === 'string' || definition.type === 'number') && (
          <input
            aria-label={definition.label}
            disabled={!editable}
            inputMode={definition.type === 'number' ? 'numeric' : undefined}
            onBlur={commitDraft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              commitDraft()
              event.currentTarget.blur()
            }}
            placeholder={fallback === '' ? 'Extension default' : `Default: ${fallback}`}
            spellCheck={false}
            type='text'
            value={draft}
          />
        )}
        {stored !== undefined && editable && (
          <button
            aria-label={`Reset ${definition.label} to its default`}
            onClick={() => onChange(extension, definition.id, null)}
            type='button'
          >
            Reset
          </button>
        )}
      </span>
    </div>
  )
}
