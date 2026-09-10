import { useEffect, useState } from 'react'
import {
  type PiSettingField,
  type PiSettingsScope,
  type PiSettingsScopeDocument,
  type PiSettingsSnapshot,
  type PiSettingValue,
  readSettingPath,
} from '../../../shared/pi-settings.ts'

interface PiSettingsProps {
  snapshot: PiSettingsSnapshot | null
  error: string | null
  onChange: (scope: PiSettingsScope, id: string, value: PiSettingValue | null) => void
  onSaveDocument: (scope: PiSettingsScope, text: string) => void
  onRetry: () => void
}

/**
 * Views and edits Pi's global and project `settings.json`. A curated field
 * registry renders common settings as typed controls; the raw-JSON editor reaches
 * every other key and preserves unmodeled keys on save. Values are shared with the
 * `pi` command line.
 */
export function PiSettings(
  { snapshot, error, onChange, onSaveDocument, onRetry }: PiSettingsProps,
) {
  const [scope, setScope] = useState<PiSettingsScope>('global')
  const [jsonMode, setJsonMode] = useState(false)

  if (error) {
    return (
      <section className='pi-settings'>
        <p className='pi-settings-error'>{error}</p>
        <button onClick={onRetry} type='button'>Try again</button>
      </section>
    )
  }
  if (!snapshot) {
    return (
      <section className='pi-settings'>
        <p>Reading Pi settings…</p>
      </section>
    )
  }

  const activeScope = scope === 'project' && !snapshot.projectAvailable ? 'global' : scope
  const document = snapshot.scopes.find((entry) => entry.scope === activeScope)
  const globalDocument = snapshot.scopes.find((entry) => entry.scope === 'global')

  return (
    <section className='pi-settings'>
      <div className='pi-settings-head'>
        <div className='pi-settings-scope' role='group' aria-label='Settings scope'>
          <button
            aria-pressed={activeScope === 'global'}
            onClick={() => setScope('global')}
            type='button'
          >
            Global
          </button>
          <button
            aria-pressed={activeScope === 'project'}
            disabled={!snapshot.projectAvailable}
            onClick={() => setScope('project')}
            title={snapshot.projectAvailable
              ? undefined
              : 'Select a workspace to edit project settings'}
            type='button'
          >
            This project
          </button>
        </div>
        <button
          className='pi-settings-mode'
          onClick={() => setJsonMode((value) => !value)}
          type='button'
        >
          {jsonMode ? 'Edit as form' : 'Edit as JSON'}
        </button>
      </div>

      {activeScope === 'project' && snapshot.projectTrusted === false && (
        <div className='pi-settings-banner'>
          <span aria-hidden='true'>⚠</span>
          <span>
            Untrusted project: Pi ignores <code>.pi/settings.json</code>{' '}
            until you trust the workspace. Edits are still saved.
          </span>
        </div>
      )}

      {jsonMode
        ? (
          <RawEditor
            document={document}
            key={`${activeScope}-${document?.raw ?? ''}`}
            onSave={(text) => onSaveDocument(activeScope, text)}
          />
        )
        : (
          <FormEditor
            document={document}
            fields={snapshot.fields}
            globalDocument={globalDocument}
            onChange={(id, value) => onChange(activeScope, id, value)}
            scope={activeScope}
          />
        )}

      {document && (
        <small className='pi-settings-path'>{document.path || 'No workspace selected'}</small>
      )}
    </section>
  )
}

interface FormEditorProps {
  fields: PiSettingField[]
  document: PiSettingsScopeDocument | undefined
  globalDocument: PiSettingsScopeDocument | undefined
  scope: PiSettingsScope
  onChange: (id: string, value: PiSettingValue | null) => void
}

function FormEditor({ fields, document, globalDocument, scope, onChange }: FormEditorProps) {
  const groups = [...new Set(fields.map((field) => field.group))]
  return (
    <>
      {groups.map((group) => (
        <div className='pi-settings-group' key={group}>
          <div className='pi-settings-group-heading'>{group}</div>
          {fields.filter((field) => field.group === group).map((field) => (
            <FieldRow
              document={document}
              field={field}
              globalDocument={globalDocument}
              key={field.id}
              onChange={onChange}
              scope={scope}
            />
          ))}
        </div>
      ))}
    </>
  )
}

interface FieldRowProps {
  field: PiSettingField
  document: PiSettingsScopeDocument | undefined
  globalDocument: PiSettingsScopeDocument | undefined
  scope: PiSettingsScope
  onChange: (id: string, value: PiSettingValue | null) => void
}

/** One curated setting: shows provenance and either a select or a text input. */
function FieldRow({ field, document, globalDocument, scope, onChange }: FieldRowProps) {
  const stored = document ? readSettingPath(document.values, field.id) : undefined
  const inheritedGlobal = scope === 'project' && globalDocument
    ? readSettingPath(globalDocument.values, field.id)
    : undefined
  const globalOnlyHere = Boolean(field.globalOnly) && scope === 'project'
  const editable = !globalOnlyHere

  const origin = describeOrigin(field, stored, inheritedGlobal, globalOnlyHere)
  const fallback = stored !== undefined
    ? formatValue(stored)
    : inheritedGlobal !== undefined
    ? formatValue(inheritedGlobal)
    : field.defaultValue !== undefined
    ? formatValue(field.defaultValue)
    : ''

  return (
    <div className='pi-setting-row'>
      <span className='pi-setting-label'>
        {field.label}
        {field.description && <small>{field.description}</small>}
        <small className={origin.className}>{origin.text}</small>
      </span>
      <span className='pi-setting-control'>
        {(field.type === 'enum' || field.type === 'boolean') && (
          <select
            aria-label={field.label}
            disabled={!editable}
            onChange={(event) => onChange(field.id, coerceChoice(field, event.target.value))}
            value={stored !== undefined ? formatValue(stored) : fallback}
          >
            {field.type === 'boolean'
              ? [['true', 'On'], ['false', 'Off']].map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))
              : (field.options ?? []).map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
          </select>
        )}
        {(field.type === 'string' || field.type === 'number' || field.type === 'string-array') && (
          <TextControl
            editable={editable}
            field={field}
            onCommit={(value) => onChange(field.id, value)}
            placeholder={placeholderFor(field, inheritedGlobal)}
            stored={stored}
          />
        )}
        {stored !== undefined && editable && (
          <button
            aria-label={`Reset ${field.label}`}
            className='pi-setting-reset'
            onClick={() => onChange(field.id, null)}
            type='button'
          >
            Reset
          </button>
        )}
      </span>
    </div>
  )
}

interface TextControlProps {
  field: PiSettingField
  stored: unknown
  editable: boolean
  placeholder: string
  onCommit: (value: PiSettingValue | null) => void
}

/** Text or number input that commits on blur or Enter. */
function TextControl({ field, stored, editable, placeholder, onCommit }: TextControlProps) {
  const initial = stored === undefined ? '' : formatValue(stored)
  const [draft, setDraft] = useState(initial)
  useEffect(() => setDraft(initial), [initial])

  const commit = () => {
    const next = draft.trim()
    if (next === (stored === undefined ? '' : formatValue(stored))) return
    if (next === '') return onCommit(null)
    onCommit(field.type === 'string-array' ? next.split(',').map((item) => item.trim()) : next)
  }

  return (
    <input
      aria-label={field.label}
      disabled={!editable}
      inputMode={field.type === 'number' ? 'numeric' : undefined}
      onBlur={commit}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        commit()
        event.currentTarget.blur()
      }}
      placeholder={placeholder}
      spellCheck={false}
      type='text'
      value={draft}
    />
  )
}

interface RawEditorProps {
  document: PiSettingsScopeDocument | undefined
  onSave: (text: string) => void
}

/** Whole-document JSON editor; rejects invalid JSON before saving. */
function RawEditor({ document, onSave }: RawEditorProps) {
  const original = document?.raw ?? '{}\n'
  const [draft, setDraft] = useState(original)
  const [parseError, setParseError] = useState<string | null>(null)

  const validate = (text: string): boolean => {
    const trimmed = text.trim()
    if (trimmed === '') return true
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setParseError('Settings must be a JSON object.')
        return false
      }
      setParseError(null)
      return true
    } catch (cause) {
      setParseError(cause instanceof Error ? cause.message : 'Invalid JSON.')
      return false
    }
  }

  return (
    <div className='pi-settings-json'>
      <p>
        Editing the whole document. Keys the form doesn't model are preserved exactly as written.
      </p>
      <textarea
        aria-label='Settings JSON'
        className={parseError ? 'invalid' : undefined}
        onChange={(event) => {
          setDraft(event.target.value)
          if (parseError) validate(event.target.value)
        }}
        spellCheck={false}
        value={draft}
      />
      {parseError && <p className='pi-settings-json-error'>Invalid JSON: {parseError}</p>}
      <div className='pi-settings-json-actions'>
        <button disabled={draft === original} onClick={() => setDraft(original)} type='button'>
          Cancel
        </button>
        <button
          className='primary'
          disabled={draft === original}
          onClick={() => {
            if (validate(draft)) onSave(draft)
          }}
          type='button'
        >
          Save
        </button>
      </div>
    </div>
  )
}

/** Formats a stored value for a control or a provenance label. */
function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

/** Coerces a select value for boolean fields, otherwise passes the enum string. */
function coerceChoice(field: PiSettingField, value: string): PiSettingValue {
  return field.type === 'boolean' ? value === 'true' : value
}

/** Placeholder text for an unset input, naming where the effective value comes from. */
function placeholderFor(field: PiSettingField, inheritedGlobal: unknown): string {
  if (inheritedGlobal !== undefined) return 'Override here…'
  if (field.defaultValue !== undefined) return `Pi default: ${formatValue(field.defaultValue)}`
  return 'Not set'
}

/** Builds the provenance line shown under a field label. */
function describeOrigin(
  field: PiSettingField,
  stored: unknown,
  inheritedGlobal: unknown,
  globalOnlyHere: boolean,
): { text: string; className: string } {
  if (globalOnlyHere) return { text: 'Global setting only', className: 'origin warn' }
  if (stored !== undefined) return { text: 'Set here', className: 'origin' }
  if (inheritedGlobal !== undefined)
    return {
      text: `Inherited from global · ${formatValue(inheritedGlobal)}`,
      className: 'origin inherited',
    }
  if (field.defaultValue !== undefined)
    return { text: `Pi default · ${formatValue(field.defaultValue)}`, className: 'origin' }
  return { text: 'Not set', className: 'origin' }
}
