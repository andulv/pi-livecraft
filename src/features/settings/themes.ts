/** Editable colour variables exposed in the theme editor. Order matters for the UI. */
export const THEME_VARIABLES = [
  'canvas',
  'surface',
  'surface-raised',
  'sidebar',
  'ink',
  'muted',
  'subtle',
  'line',
  'line-strong',
  'accent',
  'accent-hover',
  'accent-soft',
  'teal',
  'teal-soft',
  'violet',
  'violet-soft',
  'success',
  'warning',
  'warning-strong',
  'danger',
  'danger-soft',
] as const

export type ThemeVariable = (typeof THEME_VARIABLES)[number]

export type ThemeMode = 'light' | 'dark'

export type ThemePalette = Record<ThemeVariable, string>

export interface ThemePreset {
  id: 'light' | 'dark'
  name: string
  mode: ThemeMode
  palette: ThemePalette
  builtIn: true
}

export interface UserTheme {
  id: string
  name: string
  mode: ThemeMode
  palette: ThemePalette
}

/** Any theme the UI can display, preset or user-created. */
export type Theme = ThemePreset | (UserTheme & { builtIn?: never })

export interface ThemePreferences {
  active: string
  themes: UserTheme[]
}

// ── Built-in palettes ──────────────────────────────────────────────

const LIGHT_PALETTE: ThemePalette = {
  canvas: '#f4f6f4',
  surface: '#ffffff',
  'surface-raised': '#fbfcfb',
  sidebar: '#e9eeea',
  ink: '#1d2924',
  muted: '#617069',
  subtle: '#87948d',
  line: '#d7dfd9',
  'line-strong': '#c5d0c8',
  accent: '#23776d',
  'accent-hover': '#185f56',
  'accent-soft': '#e0f1ed',
  teal: '#23776d',
  'teal-soft': '#e0f1ed',
  violet: '#6851a4',
  'violet-soft': '#ede9fa',
  success: '#28734b',
  warning: '#b8860b',
  'warning-strong': '#c75b00',
  danger: '#a13f37',
  'danger-soft': '#fbe9e7',
}

const DARK_PALETTE: ThemePalette = {
  canvas: '#171c1a',
  surface: '#1e2422',
  'surface-raised': '#252b29',
  sidebar: '#1a201e',
  ink: '#dde3e0',
  muted: '#94a099',
  subtle: '#707c76',
  line: '#2e3733',
  'line-strong': '#3b4540',
  accent: '#4fb9ab',
  'accent-hover': '#66c9bc',
  'accent-soft': '#162b27',
  teal: '#4fb9ab',
  'teal-soft': '#162b27',
  violet: '#9d91d4',
  'violet-soft': '#221f3a',
  success: '#59ba7c',
  warning: '#d6aa45',
  'warning-strong': '#ea8740',
  danger: '#e26e63',
  'danger-soft': '#321a16',
}

export const BUILT_IN_THEMES: [ThemePreset, ThemePreset] = [
  { id: 'light', name: 'Light', mode: 'light', palette: LIGHT_PALETTE, builtIn: true },
  { id: 'dark', name: 'Dark', mode: 'dark', palette: DARK_PALETTE, builtIn: true },
]

// ── Persistence keys ───────────────────────────────────────────────

const STORAGE_KEY = 'pi-livecraft.themes'
const LEGACY_THEME_KEY = 'pi-livecraft.theme'
type ThemeStorage = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void; removeItem: (key: string) => void }

/** Returns browser storage without requiring DOM types in the pure test build. */
function themeStorage(): ThemeStorage | undefined {
  return (globalThis as typeof globalThis & { localStorage?: ThemeStorage }).localStorage
}

// ── Validation ─────────────────────────────────────────────────────

function validateHex(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

function validatePalette(value: unknown): value is ThemePalette {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return THEME_VARIABLES.every((v) => validateHex(obj[v]))
}

function validateUserTheme(value: unknown): value is UserTheme {
  if (typeof value !== 'object' || value === null) return false
  const t = value as Record<string, unknown>
  return typeof t.id === 'string' && t.id.length > 0 &&
    typeof t.name === 'string' && t.name.trim().length > 0 &&
    (t.mode === 'light' || t.mode === 'dark') &&
    validatePalette(t.palette)
}

function validateThemePreferences(value: unknown): value is ThemePreferences {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Record<string, unknown>
  return typeof p.active === 'string' && Array.isArray(p.themes) && p.themes.every(validateUserTheme)
}

// ── Parsing & migration ────────────────────────────────────────────

/**
 * Pure parser: validates raw JSON and migrates a legacy key, returning
 * valid preferences or the light default.
 */
export function parseThemePreferences(raw: unknown, legacyValue: string | null): ThemePreferences {
  if (raw !== null && typeof raw === 'object' && validateThemePreferences(raw)) return raw
  const active = legacyValue === 'dark' ? 'dark' : 'light'
  return { active, themes: [] }
}

/** Reads preferences from localStorage, migrating the legacy key on first access. */
export function readThemePreferences(): ThemePreferences {
  try {
    const storage = themeStorage()
    if (!storage) return { active: 'light', themes: [] }
    const raw: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')
    const legacy = storage.getItem(LEGACY_THEME_KEY)
    if (legacy !== null) storage.removeItem(LEGACY_THEME_KEY)
    return parseThemePreferences(raw, legacy)
  } catch {
    return { active: 'light', themes: [] }
  }
}

/** Persists preferences to localStorage. */
export function persistThemePreferences(prefs: ThemePreferences): void {
  themeStorage()?.setItem(STORAGE_KEY, JSON.stringify(prefs))
}

// ── Domain queries ─────────────────────────────────────────────────

/** Resolves the active theme, always falling back to Light. */
export function resolveActiveTheme(prefs: ThemePreferences): Theme {
  if (prefs.active === 'dark') return BUILT_IN_THEMES[1]
  if (prefs.active === 'light') return BUILT_IN_THEMES[0]
  const user = prefs.themes.find((t) => t.id === prefs.active)
  if (user) return user
  return BUILT_IN_THEMES[0]
}

/** Every theme the user can select: presets first, then user themes. */
export function allThemes(prefs: ThemePreferences): Theme[] {
  return [...BUILT_IN_THEMES, ...prefs.themes]
}

/** Whether an id belongs to a built-in preset. */
export function isBuiltIn(id: string): boolean {
  return id === 'light' || id === 'dark'
}

// ── Mutations (all pure – return new prefs) ────────────────────────

/**
 * Creates a user theme from a source palette (defaults to Light preset).
 * The name is deduplicated against existing built-in and user themes.
 */
export function createTheme(prefs: ThemePreferences, name: string, mode: ThemeMode, sourcePalette?: ThemePalette): ThemePreferences {
  const palette = sourcePalette ? { ...sourcePalette } : { ...LIGHT_PALETTE }
  const allNames = [...BUILT_IN_THEMES, ...prefs.themes].map((t) => t.name)
  const theme: UserTheme = {
    id: crypto.randomUUID(),
    name: uniqueName(name.trim() || 'Custom', allNames),
    mode,
    palette,
  }
  return { ...prefs, themes: [...prefs.themes, theme] }
}

/** Duplicates an existing theme (preset or user) as a new user theme. */
export function duplicateTheme(prefs: ThemePreferences, sourceId: string, newName: string): ThemePreferences {
  const source = sourceId === 'light' ? BUILT_IN_THEMES[0] :
    sourceId === 'dark' ? BUILT_IN_THEMES[1] :
    prefs.themes.find((t) => t.id === sourceId)
  if (!source) return prefs
  return createTheme(prefs, newName || `${source.name} copy`, source.mode, source.palette)
}

/** Renames a user theme, deduplicating the name. Presets are immutable. */
export function renameTheme(prefs: ThemePreferences, id: string, name: string): ThemePreferences {
  const trimmed = name.trim()
  if (!trimmed || isBuiltIn(id)) return prefs
  const allNames = [...BUILT_IN_THEMES, ...prefs.themes].filter((t) => t.id !== id).map((t) => t.name)
  return {
    ...prefs,
    themes: prefs.themes.map((t) => t.id === id ? { ...t, name: uniqueName(trimmed, allNames) } : t),
  }
}

/** Updates a single palette variable on a user theme. Hex format is validated. */
export function updateThemeColor(prefs: ThemePreferences, id: string, variable: ThemeVariable, color: string): ThemePreferences {
  if (!validateHex(color) || isBuiltIn(id)) return prefs
  return {
    ...prefs,
    themes: prefs.themes.map((t) =>
      t.id === id ? { ...t, palette: { ...t.palette, [variable]: color } } : t,
    ),
  }
}

/** Updates the mode (light/dark) of a user theme. Presets are immutable. */
export function updateThemeMode(prefs: ThemePreferences, id: string, mode: ThemeMode): ThemePreferences {
  if (isBuiltIn(id)) return prefs
  return {
    ...prefs,
    themes: prefs.themes.map((t) => t.id === id ? { ...t, mode } : t),
  }
}

/**
 * Deletes a user theme. Falls back to Light if the active theme is deleted.
 * Presets are immutable.
 */
export function deleteTheme(prefs: ThemePreferences, id: string): ThemePreferences {
  if (isBuiltIn(id)) return prefs
  return {
    active: prefs.active === id ? 'light' : prefs.active,
    themes: prefs.themes.filter((t) => t.id !== id),
  }
}

/** Sets the active theme. Unknown ids are silently ignored. */
export function setActiveTheme(prefs: ThemePreferences, id: string): ThemePreferences {
  if (id === 'light' || id === 'dark' || prefs.themes.some((t) => t.id === id)) {
    return { ...prefs, active: id }
  }
  return prefs
}

// ── Runtime application ────────────────────────────────────────────

/** Applies a theme palette as CSS custom properties on a DOM element. */
export function applyThemePalette(element: { style: { setProperty: (name: string, value: string) => void } }, palette: ThemePalette): void {
  for (const variable of THEME_VARIABLES) {
    element.style.setProperty(`--${variable}`, palette[variable])
  }
}

/** Shadow values derived from the theme mode. */
export function shadowForMode(mode: ThemeMode): Record<'shadow' | 'shadow-soft', string> {
  return mode === 'dark'
    ? { shadow: '0 8px 32px color-mix(in srgb, var(--ink) 40%, transparent)', 'shadow-soft': '0 3px 12px color-mix(in srgb, var(--ink) 30%, transparent)' }
    : { shadow: '0 18px 45px color-mix(in srgb, var(--ink) 10%, transparent)', 'shadow-soft': '0 5px 18px color-mix(in srgb, var(--ink) 7%, transparent)' }
}

// ── Helpers ────────────────────────────────────────────────────────

function uniqueName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base
  let i = 2
  while (existing.includes(`${base} ${i}`)) i++
  return `${base} ${i}`
}
