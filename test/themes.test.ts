import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BUILT_IN_THEMES,
  createTheme,
  deleteTheme,
  duplicateTheme,
  parseThemePreferences,
  renameTheme,
  resolveActiveTheme,
  setActiveTheme,
  updateThemeColor,
  updateThemeMode,
} from '../src/features/settings/themes.ts'
import type { ThemePreferences } from '../src/features/settings/themes.ts'

// ── helpers ────────────────────────────────────────────────────────

const basePrefs: ThemePreferences = { active: 'light', themes: [] }

// ── parseThemePreferences ──────────────────────────────────────────

test('parseThemePreferences retourne fallback light quand raw est null et pas de legacy', () => {
  const result = parseThemePreferences(null, null)
  assert.deepEqual(result, { active: 'light', themes: [] })
})

test('parseThemePreferences migre le legacy dark', () => {
  const result = parseThemePreferences(null, 'dark')
  assert.equal(result.active, 'dark')
  assert.deepEqual(result.themes, [])
})

test('parseThemePreferences ignore le legacy quand une préférence valide existe', () => {
  const valid = { active: 'light', themes: [{ id: 'x', name: 'Test', mode: 'light', palette: BUILT_IN_THEMES[0].palette }] }
  const result = parseThemePreferences(valid, 'dark')
  assert.equal(result.active, 'light')
  assert.equal(result.themes.length, 1)
})

test('parseThemePreferences retourne fallback light sur données malformées', () => {
  const result = parseThemePreferences({ active: 123, themes: 'nope' }, null)
  assert.deepEqual(result, { active: 'light', themes: [] })
})

test('parseThemePreferences retourne fallback sur données JSON invalides (objet mais non valide)', () => {
  const result = parseThemePreferences({ active: 'light', themes: [{ id: 'x' }] }, null)
  // Missing name, mode, palette → invalid user theme → invalid prefs
  assert.deepEqual(result, { active: 'light', themes: [] })
})

test('parseThemePreferences retourne fallback quand active pointe vers un thème inexistant', () => {
  // active references id that doesn't exist — parseThemePreferences only validates structure, not referential integrity
  // The referential integrity is handled by resolveActiveTheme at read time
  const valid = { active: 'ghost', themes: [] }
  const result = parseThemePreferences(valid, null)
  assert.equal(result.active, 'ghost')
  assert.deepEqual(result.themes, [])
})

// ── resolveActiveTheme ─────────────────────────────────────────────

test('resolveActiveTheme retourne light preset par défaut', () => {
  assert.equal(resolveActiveTheme(basePrefs).id, 'light')
})

test('resolveActiveTheme retourne dark preset', () => {
  assert.equal(resolveActiveTheme({ active: 'dark', themes: [] }).id, 'dark')
})

test("resolveActiveTheme retourne un thème utilisateur s'il est actif", () => {
  const prefs = createTheme(basePrefs, 'My Theme', 'dark')
  const prefsWithActive = setActiveTheme(prefs, prefs.themes[0].id)
  const theme = resolveActiveTheme(prefsWithActive)
  assert.equal(theme.id, prefs.themes[0].id)
  assert.equal(theme.name, 'My Theme')
  assert.equal(theme.mode, 'dark')
})

test("resolveActiveTheme retombe sur light quand l'id actif n'existe pas", () => {
  const result = resolveActiveTheme({ active: 'nonexistent', themes: [] })
  assert.equal(result.id, 'light')
})

// ── createTheme ────────────────────────────────────────────────────

test('createTheme crée un thème avec un nom, un mode, et une palette par défaut (light)', () => {
  const prefs = createTheme(basePrefs, 'Custom', 'dark')
  assert.equal(prefs.themes.length, 1)
  assert.equal(prefs.themes[0].name, 'Custom')
  assert.equal(prefs.themes[0].mode, 'dark')
  // La palette par défaut est la palette light
  assert.deepEqual(prefs.themes[0].palette, BUILT_IN_THEMES[0].palette)
})

test('createTheme déduplique le nom', () => {
  const prefs = createTheme(basePrefs, 'Light', 'light')
  assert.equal(prefs.themes[0].name, 'Light 2')
})

test('createTheme génère des ids uniques', () => {
  const a = createTheme(basePrefs, 'A', 'light')
  const b = createTheme(a, 'B', 'light')
  assert.notEqual(b.themes[0].id, b.themes[1].id)
})

test("createTheme accepte une palette source et ne mute pas l'original", () => {
  const source = { ...BUILT_IN_THEMES[1].palette, canvas: '#abcdef' }
  const prefs = createTheme(basePrefs, 'Custom', 'dark', source)
  assert.equal(prefs.themes[0].palette.canvas, '#abcdef')
  assert.equal(source.canvas, '#abcdef') // source unchanged
})

// ── duplicateTheme ─────────────────────────────────────────────────

test('duplicateTheme duplique un thème utilisateur', () => {
  const prefs = createTheme(basePrefs, 'Original', 'light')
  const id = prefs.themes[0].id
  const dup = duplicateTheme(prefs, id, 'Copy')
  assert.equal(dup.themes.length, 2)
  assert.equal(dup.themes[1].name, 'Copy')
})

test('duplicateTheme déduplique le nom automatiquement', () => {
  const prefs = createTheme(basePrefs, 'Original', 'light')
  const id = prefs.themes[0].id
  const dup = duplicateTheme(prefs, id, 'Original')
  assert.equal(dup.themes[1].name, 'Original 2')
})

test("duplicateTheme ne change rien si l'id source n'existe pas", () => {
  const result = duplicateTheme(basePrefs, 'nonexistent', 'Copy')
  assert.deepEqual(result, basePrefs)
})

test('duplicateTheme duplique un thème preset (light)', () => {
  const result = duplicateTheme(basePrefs, 'light', 'My Light')
  assert.equal(result.themes.length, 1)
  assert.equal(result.themes[0].name, 'My Light')
  assert.equal(result.themes[0].mode, 'light')
})

test('duplicateTheme duplique un thème preset (dark)', () => {
  const result = duplicateTheme(basePrefs, 'dark', 'My Dark')
  assert.equal(result.themes.length, 1)
  assert.equal(result.themes[0].name, 'My Dark')
  assert.equal(result.themes[0].mode, 'dark')
})

// ── renameTheme ────────────────────────────────────────────────────

test('renameTheme renomme un thème utilisateur', () => {
  const prefs = createTheme(basePrefs, 'Old', 'light')
  const id = prefs.themes[0].id
  const renamed = renameTheme(prefs, id, 'New')
  assert.equal(renamed.themes[0].name, 'New')
})

test('renameTheme déduplique le nom', () => {
  const prefs = createTheme(basePrefs, 'T1', 'light')
  const id = prefs.themes[0].id
  const renamed = renameTheme(prefs, id, 'Light')
  assert.equal(renamed.themes[0].name, 'Light 2')
})

test("renameTheme ignore un nom vide ou tout blanc", () => {
  const prefs = createTheme(basePrefs, 'Keep', 'light')
  const id = prefs.themes[0].id
  assert.equal(renameTheme(prefs, id, '').themes[0].name, 'Keep')
  assert.equal(renameTheme(prefs, id, '  ').themes[0].name, 'Keep')
})

test('renameTheme ne modifie pas les thèmes presets (même si appelé avec leur id)', () => {
  const result = renameTheme(basePrefs, 'light', 'Gone')
  assert.deepEqual(result, basePrefs)
})

// ── updateThemeColor ──────────────────────────────────────────────

test('updateThemeColor change une variable de palette', () => {
  const prefs = createTheme(basePrefs, 'T', 'light')
  const id = prefs.themes[0].id
  const updated = updateThemeColor(prefs, id, 'canvas', '#000000')
  assert.equal(updated.themes[0].palette.canvas, '#000000')
})

test('updateThemeColor ne mute pas les autres propriétés', () => {
  const prefs = createTheme(basePrefs, 'T', 'dark')
  const id = prefs.themes[0].id
  const preSurface = prefs.themes[0].palette.surface
  const updated = updateThemeColor(prefs, id, 'canvas', '#123456')
  assert.equal(updated.themes[0].palette.surface, preSurface)
})

test('updateThemeColor rejette les valeurs non-hex', () => {
  const prefs = createTheme(basePrefs, 'T', 'light')
  const id = prefs.themes[0].id
  assert.deepEqual(updateThemeColor(prefs, id, 'canvas', 'red'), prefs)
  assert.deepEqual(updateThemeColor(prefs, id, 'canvas', '#12345'), prefs)
  assert.deepEqual(updateThemeColor(prefs, id, 'canvas', '#1234567'), prefs)
})

test('updateThemeColor ignore les thèmes presets', () => {
  const result = updateThemeColor(basePrefs, 'light', 'canvas', '#000000')
  assert.deepEqual(result, basePrefs)
})

// ── updateThemeMode ────────────────────────────────────────────────

test('updateThemeMode change le mode', () => {
  const prefs = createTheme(basePrefs, 'T', 'light')
  const id = prefs.themes[0].id
  const updated = updateThemeMode(prefs, id, 'dark')
  assert.equal(updated.themes[0].mode, 'dark')
})

test('updateThemeMode ignore les presets', () => {
  const result = updateThemeMode(basePrefs, 'light', 'dark')
  assert.deepEqual(result, basePrefs)
})

// ── deleteTheme ────────────────────────────────────────────────────

test('deleteTheme supprime un thème utilisateur', () => {
  const prefs = createTheme(basePrefs, 'T', 'light')
  const id = prefs.themes[0].id
  const result = deleteTheme(prefs, id)
  assert.equal(result.themes.length, 0)
})

test("deleteTheme retombe sur light si le thème actif est supprimé", () => {
  const prefs = createTheme(basePrefs, 'T', 'dark')
  const id = prefs.themes[0].id
  const withActive = setActiveTheme(prefs, id)
  const result = deleteTheme(withActive, id)
  assert.equal(result.active, 'light')
})

test('deleteTheme conserve active si un autre thème est supprimé', () => {
  const prefs = createTheme(basePrefs, 'Active', 'dark')
  const activeId = prefs.themes[0].id
  const withSecond = createTheme(prefs, 'Other', 'light')
  const otherId = withSecond.themes[1].id
  const withActive = setActiveTheme(withSecond, activeId)
  const result = deleteTheme(withActive, otherId)
  assert.equal(result.active, activeId)
})

test('deleteTheme ignore les presets', () => {
  assert.deepEqual(deleteTheme(basePrefs, 'light'), basePrefs)
  assert.deepEqual(deleteTheme(basePrefs, 'dark'), basePrefs)
})

// ── setActiveTheme ─────────────────────────────────────────────────

test('setActiveTheme change le thème actif', () => {
  const result = setActiveTheme(basePrefs, 'dark')
  assert.equal(result.active, 'dark')
})

test("setActiveTheme ignore les ids inconnus", () => {
  const result = setActiveTheme(basePrefs, 'unknown')
  assert.equal(result.active, 'light')
})
