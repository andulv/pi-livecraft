import { useState } from 'react'
import {
  LIVECRAFT_PREFIX,
  type LivecraftPreference,
  livecraftPreferences,
} from './livecraft-preferences.ts'

interface LivecraftSettingsProps {
  terminalCommand: string
  onTerminalCommandChange: (value: string) => void
}

/**
 * Preferences and remembered layout state Pi Livecraft stores in this browser.
 * The terminal command is owned by `App.tsx` and edited live; every other value
 * is stored state the user can reset. Resetting clears the `localStorage` key;
 * some values only fully apply after a reload.
 */
export function LivecraftSettings(
  { terminalCommand, onTerminalCommandChange }: LivecraftSettingsProps,
) {
  // A monotonic tick re-reads localStorage after each reset so disabled state stays accurate.
  const [, setTick] = useState(0)
  const refresh = () => setTick((value) => value + 1)

  const present = (key: string): boolean => {
    try {
      return window.localStorage.getItem(key) !== null
    } catch {
      return false
    }
  }
  const clear = (key: string) => {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // A blocked storage write cannot prevent the rest of the UI from working.
    }
    refresh()
  }

  const preferences = livecraftPreferences.filter((entry) => entry.section === 'preferences')
  const layout = livecraftPreferences.filter((entry) => entry.section === 'layout')

  const resetAll = () => {
    if (!window.confirm('Reset all Pi Livecraft settings stored in this browser?')) return
    try {
      const keys = Object.keys(window.localStorage).filter((key) =>
        key.startsWith(LIVECRAFT_PREFIX)
      )
      for (const key of keys) window.localStorage.removeItem(key)
    } catch {
      // Ignore storage failures; nothing else depends on the clear succeeding here.
    }
    refresh()
  }

  return (
    <section className='livecraft-settings'>
      <p>
        Preferences stored in this browser. They don't affect the <code>pi</code> command line.
      </p>

      <div className='pi-settings-group'>
        <div className='pi-settings-group-heading'>Preferences</div>
        <label className='terminal-command-row'>
          <span>External terminal command</span>
          <input
            aria-label='Terminal command template'
            onChange={(event) => onTerminalCommandChange(event.target.value)}
            placeholder='Platform default'
            spellCheck={false}
            value={terminalCommand}
          />
          {terminalCommand && !terminalCommand.includes('{cwd}') && (
            <small className='terminal-command-error'>
              The template must contain {'{cwd}'} where the workspace folder should be inserted.
            </small>
          )}
          <small>
            Leave empty for the platform default, or use {'{cwd}'} for the workspace folder.
          </small>
        </label>
        {preferences.map((entry) => (
          <ResetRow
            entry={entry}
            key={entry.key}
            onReset={clear}
            present={present(entry.key)}
          />
        ))}
      </div>

      <details className='livecraft-details'>
        <summary>Layout &amp; state ({layout.length} remembered values)</summary>
        <div className='livecraft-details-body'>
          {layout.map((entry) => (
            <ResetRow
              entry={entry}
              key={entry.key}
              onReset={clear}
              present={present(entry.key)}
            />
          ))}
        </div>
      </details>

      <div className='livecraft-danger'>
        <button className='livecraft-danger-btn' onClick={resetAll} type='button'>
          Reset all Livecraft settings…
        </button>
      </div>
    </section>
  )
}

interface ResetRowProps {
  entry: LivecraftPreference
  present: boolean
  onReset: (key: string) => void
}

function ResetRow({ entry, present, onReset }: ResetRowProps) {
  return (
    <div className='pi-setting-row'>
      <span className='pi-setting-label'>
        {entry.label}
        {entry.description && <small>{entry.description}</small>}
        {!present && <small className='origin'>Not set</small>}
      </span>
      <span className='pi-setting-control'>
        <button
          aria-label={`Reset ${entry.label}`}
          className='pi-setting-reset'
          disabled={!present}
          onClick={() => onReset(entry.key)}
          type='button'
        >
          Reset
        </button>
      </span>
    </div>
  )
}
