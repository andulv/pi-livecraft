import { useEffect, useState } from 'react'
import type { CommandDefinition, CommandId } from '../commands/command-registry.ts'
import { shortcutFromEvent, shortcutConflicts } from '../commands/command-registry.ts'
import { THEME_VARIABLES, type Theme, type ThemeVariable } from './themes.ts'

const themeVariableLabels: Record<ThemeVariable, string> = {
  canvas: 'Canvas',
  surface: 'Surface',
  'surface-raised': 'Raised surface',
  sidebar: 'Sidebar',
  ink: 'Text',
  muted: 'Muted text',
  subtle: 'Subtle text',
  line: 'Borders',
  'line-strong': 'Strong borders',
  accent: 'Accent',
  'accent-hover': 'Accent hover',
  'accent-soft': 'Accent soft',
  teal: 'Teal',
  'teal-soft': 'Teal soft',
  violet: 'Violet',
  'violet-soft': 'Violet soft',
  success: 'Success',
  warning: 'Warning',
  'warning-strong': 'Strong warning',
  danger: 'Danger',
  'danger-soft': 'Danger soft',
}

interface SettingsPanelProps {
  definitions: CommandDefinition[]
  shortcuts: Partial<Record<CommandId, string>>
  terminalCommand: string
  themes: Theme[]
  activeThemeId: string
  onChange: (id: CommandId, shortcut: string) => void
  onTerminalCommandChange: (value: string) => void
  onSelectTheme: (id: string) => void
  onDuplicateTheme: () => void
  onRenameTheme: (id: string, name: string) => void
  onUpdateThemeColor: (id: string, variable: ThemeVariable, color: string) => void
  onDeleteTheme: (id: string) => void
  onReset: () => void
  onClose: () => void
}

/** Configures local shortcuts, terminal behavior, and editable color themes. */
export function SettingsPanel({ definitions, shortcuts, terminalCommand, themes, activeThemeId, onChange, onTerminalCommandChange, onSelectTheme, onDuplicateTheme, onRenameTheme, onUpdateThemeColor, onDeleteTheme, onReset, onClose }: SettingsPanelProps) {
  const [capturing, setCapturing] = useState<CommandId | null>(null)
  const [themeName, setThemeName] = useState('')
  const conflicts = shortcutConflicts(shortcuts)
  const activeTheme = themes.find((theme) => theme.id === activeThemeId) ?? themes[0]
  const editableTheme = activeTheme && !activeTheme.builtIn

  useEffect(() => {
    setThemeName(activeTheme?.name ?? '')
  }, [activeTheme?.id, activeTheme?.name])

  const commitThemeName = () => {
    if (editableTheme && themeName.trim() !== activeTheme.name) onRenameTheme(activeTheme.id, themeName)
  }

  return <div className="settings-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
    <section aria-label="Settings" className="settings-panel" role="dialog">
      <header><div><span>Preferences</span><h2>Settings</h2></div><button aria-label="Close settings" onClick={onClose} type="button">×</button></header>
      <section className="settings-content">
        <section className="theme-settings">
          <h3>Color themes</h3>
          <p>Choose a theme or duplicate one to edit its colors. Typography and layout stay unchanged.</p>
          <div className="theme-toolbar">
            <select aria-label="Active color theme" onChange={(event) => onSelectTheme(event.target.value)} value={activeTheme?.id ?? ''}>
              {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}{theme.builtIn ? ' · Built-in' : ''}</option>)}
            </select>
            <button onClick={onDuplicateTheme} type="button">New custom theme</button>
          </div>
          {activeTheme && <>
            <div className="theme-name">
              <label>Name<input disabled={!editableTheme} onBlur={commitThemeName} onChange={(event) => setThemeName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitThemeName() } }} value={themeName} /></label>
              <button disabled={!editableTheme} onClick={() => onDeleteTheme(activeTheme.id)} type="button">Delete</button>
            </div>
            <div className="theme-colors">
              {THEME_VARIABLES.map((variable) => <label className="theme-color" key={variable}><span>{themeVariableLabels[variable]}</span><input aria-label={themeVariableLabels[variable]} disabled={!editableTheme} onChange={(event) => onUpdateThemeColor(activeTheme.id, variable, event.target.value)} type="color" value={activeTheme.palette[variable]} /></label>)}
            </div>
          </>}
        </section>
        <section><h3>Terminal</h3><label className="terminal-command-row"><span>External terminal command</span><input aria-label="Terminal command template" onChange={(event) => onTerminalCommandChange(event.target.value)} placeholder="wt.exe -d {cwd}" spellCheck={false} value={terminalCommand} />{!terminalCommand.includes('{cwd}') && <small className="terminal-command-error">The template must contain {'{cwd}'} where the workspace folder should be inserted.</small>}<small>Use {'{cwd}'} for the workspace folder. Example: wt.exe -d {'{cwd}'}</small></label><h3>Shortcuts</h3>{definitions.filter(({ id }) => !['open-palette', 'open-settings'].includes(id)).map((definition) => <label className={conflicts.has(definition.id) ? 'shortcut-row conflict' : 'shortcut-row'} key={definition.id}><span>{definition.label}{conflicts.has(definition.id) && <small>Conflict</small>}</span><input aria-label={`Shortcut: ${definition.label}`} onBlur={() => setCapturing(null)} onKeyDown={(event) => { event.preventDefault(); if (event.key === 'Escape') { setCapturing(null); return } const value = shortcutFromEvent(event); if (value !== event.key.toLowerCase()) { onChange(definition.id, value); setCapturing(null) } }} onFocus={() => setCapturing(definition.id)} placeholder="Unassigned" readOnly value={capturing === definition.id ? 'Press a key…' : shortcuts[definition.id] ?? ''} /></label>)}</section>
      </section>
      <footer><button onClick={onReset} type="button">Reset shortcuts</button><button className="primary" onClick={onClose} type="button">Done</button></footer>
    </section>
  </div>
}
