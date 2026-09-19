import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  type WorkspaceViewerState,
  activateBrowser,
  activateFile,
  activateTerminal,
  closeBrowser,
  closeFile,
  closeTerminal,
  defaultViewerState,
  fallbackView,
  openBrowser,
  openFile,
  openGitDiff,
  openTerminal,
  pinTab,
  readPersistedStates,
  writePersistedStates,
} from '../src/features/workspace/workspace-viewer-state.ts'

const BROWSER = 'main-browser'
const TERMINAL = 'main'

function state(overrides: Partial<WorkspaceViewerState> = {}): WorkspaceViewerState {
  return { ...defaultViewerState(), ...overrides }
}

// ---------------------------------------------------------------------------
// Pure transitions — openFile
// ---------------------------------------------------------------------------

describe('openFile', () => {
  test('appends a new file and activates it', () => {
    const result = openFile(defaultViewerState(), 'README.md')
    assert.deepEqual(result.openFilePaths, ['README.md'])
    assert.deepEqual(result.activeView, { kind: 'file', path: 'README.md' })
  })

  test('does not duplicate an already-open file', () => {
    const initial = state({ openFilePaths: ['a.ts', 'b.ts'] })
    const result = openFile(initial, 'a.ts')
    assert.deepEqual(result.openFilePaths, ['a.ts', 'b.ts'])
    assert.deepEqual(result.activeView, { kind: 'file', path: 'a.ts' })
  })

  test('preserves existing tab order when opening a new file', () => {
    const initial = state({ openFilePaths: ['a.ts', 'b.ts'] })
    const result = openFile(initial, 'c.ts')
    assert.deepEqual(result.openFilePaths, ['a.ts', 'b.ts', 'c.ts'])
  })
})

// ---------------------------------------------------------------------------
// Preview tabs
// ---------------------------------------------------------------------------

describe('preview tabs', () => {
  test('replaces an unpinned file preview', () => {
    const result = openFile(openFile(defaultViewerState(), 'a.ts'), 'b.ts')
    assert.deepEqual(result.openFilePaths, ['b.ts'])
    assert.equal(result.previewTabId, 'file:b.ts')
  })

  test('keeps a pinned tab while opening a preview', () => {
    const pinned = pinTab(openFile(defaultViewerState(), 'a.ts'), 'file:a.ts')
    const result = openFile(pinned, 'b.ts')
    assert.deepEqual(result.openFilePaths, ['a.ts', 'b.ts'])
    assert.equal(result.previewTabId, 'file:b.ts')
  })

  test('replaces a file preview with a Git diff preview', () => {
    const result = openGitDiff(openFile(defaultViewerState(), 'a.ts'), 'b.ts', '+new')
    assert.deepEqual(result.openFilePaths, [])
    assert.deepEqual(result.activeView, { kind: 'git-diff', id: 'git:working-tree:b.ts' })
    assert.equal(result.previewTabId, 'git:working-tree:b.ts')
  })
})

// ---------------------------------------------------------------------------
// Pure transitions — activateFile
// ---------------------------------------------------------------------------

describe('activateFile', () => {
  test('activates an open file', () => {
    const initial = state({
      openFilePaths: ['a.ts', 'b.ts'],
      activeView: { kind: 'file', path: 'a.ts' },
    })
    const result = activateFile(initial, 'b.ts')
    assert.deepEqual(result.activeView, { kind: 'file', path: 'b.ts' })
  })

  test('no-op when file is not open', () => {
    const initial = state({ openFilePaths: ['a.ts'] })
    const result = activateFile(initial, 'not-open.ts')
    assert.equal(result, initial)
  })
})

// ---------------------------------------------------------------------------
// Pure transitions — closeFile
// ---------------------------------------------------------------------------

describe('closeFile', () => {
  test('removes the file from open tabs', () => {
    const initial = state({
      openFilePaths: ['a.ts', 'b.ts'],
      activeView: { kind: 'file', path: 'a.ts' },
    })
    const result = closeFile(initial, 'b.ts', BROWSER, TERMINAL)
    assert.deepEqual(result.openFilePaths, ['a.ts'])
    assert.deepEqual(result.activeView, { kind: 'file', path: 'a.ts' })
  })

  test('falls back to last file when active file is closed', () => {
    const initial = state({
      openFilePaths: ['a.ts', 'b.ts', 'c.ts'],
      activeView: { kind: 'file', path: 'c.ts' },
    })
    const result = closeFile(initial, 'c.ts', BROWSER, TERMINAL)
    assert.deepEqual(result.openFilePaths, ['a.ts', 'b.ts'])
    assert.deepEqual(result.activeView, { kind: 'file', path: 'b.ts' })
  })

  test('falls back to browser when last file is closed and browser is open', () => {
    const initial = state({
      openFilePaths: ['a.ts'],
      activeView: { kind: 'file', path: 'a.ts' },
      browserOpen: true,
    })
    const result = closeFile(initial, 'a.ts', BROWSER, TERMINAL)
    assert.deepEqual(result.openFilePaths, [])
    assert.deepEqual(result.activeView, { kind: 'browser', browserId: BROWSER })
  })

  test('falls back to terminal when last file is closed and only terminal is open', () => {
    const initial = state({
      openFilePaths: ['a.ts'],
      activeView: { kind: 'file', path: 'a.ts' },
      terminalOpen: true,
    })
    const result = closeFile(initial, 'a.ts', BROWSER, TERMINAL)
    assert.deepEqual(result.activeView, { kind: 'terminal', terminalId: TERMINAL })
  })

  test('falls back to null when nothing remains', () => {
    const initial = state({
      openFilePaths: ['a.ts'],
      activeView: { kind: 'file', path: 'a.ts' },
    })
    const result = closeFile(initial, 'a.ts', BROWSER, TERMINAL)
    assert.equal(result.activeView, null)
  })

  test('no-op when file is not open', () => {
    const initial = state({ openFilePaths: ['a.ts'] })
    const result = closeFile(initial, 'not-open.ts', BROWSER, TERMINAL)
    assert.equal(result, initial)
  })

  test('does not change active view when closing an inactive file', () => {
    const initial = state({
      openFilePaths: ['a.ts', 'b.ts'],
      activeView: { kind: 'browser', browserId: BROWSER },
      browserOpen: true,
    })
    const result = closeFile(initial, 'a.ts', BROWSER, TERMINAL)
    assert.deepEqual(result.openFilePaths, ['b.ts'])
    assert.deepEqual(result.activeView, { kind: 'browser', browserId: BROWSER })
  })
})

// ---------------------------------------------------------------------------
// Pure transitions — browser
// ---------------------------------------------------------------------------

describe('browser transitions', () => {
  test('openBrowser sets browserOpen and activates', () => {
    const result = openBrowser(defaultViewerState(), BROWSER)
    assert.equal(result.browserOpen, true)
    assert.deepEqual(result.activeView, { kind: 'browser', browserId: BROWSER })
  })

  test('activateBrowser no-op when browser is not open', () => {
    const initial = defaultViewerState()
    assert.equal(activateBrowser(initial, BROWSER), initial)
  })

  test('closeBrowser falls back to last file', () => {
    const initial = state({
      openFilePaths: ['a.ts'],
      activeView: { kind: 'browser', browserId: BROWSER },
      browserOpen: true,
    })
    const result = closeBrowser(initial, BROWSER, TERMINAL)
    assert.equal(result.browserOpen, false)
    assert.deepEqual(result.activeView, { kind: 'file', path: 'a.ts' })
  })

  test('closeBrowser falls back to terminal', () => {
    const initial = state({
      activeView: { kind: 'browser', browserId: BROWSER },
      browserOpen: true,
      terminalOpen: true,
    })
    const result = closeBrowser(initial, BROWSER, TERMINAL)
    assert.deepEqual(result.activeView, { kind: 'terminal', terminalId: TERMINAL })
  })

  test('closeBrowser preserves non-browser active view', () => {
    const initial = state({
      openFilePaths: ['a.ts'],
      activeView: { kind: 'file', path: 'a.ts' },
      browserOpen: true,
    })
    const result = closeBrowser(initial, BROWSER, TERMINAL)
    assert.deepEqual(result.activeView, { kind: 'file', path: 'a.ts' })
  })
})

// ---------------------------------------------------------------------------
// Pure transitions — terminal
// ---------------------------------------------------------------------------

describe('terminal transitions', () => {
  test('openTerminal sets terminalOpen and activates', () => {
    const result = openTerminal(defaultViewerState(), TERMINAL)
    assert.equal(result.terminalOpen, true)
    assert.deepEqual(result.activeView, { kind: 'terminal', terminalId: TERMINAL })
  })

  test('activateTerminal no-op when terminal is not open', () => {
    const initial = defaultViewerState()
    assert.equal(activateTerminal(initial, TERMINAL), initial)
  })

  test('closeTerminal falls back to browser', () => {
    const initial = state({
      activeView: { kind: 'terminal', terminalId: TERMINAL },
      terminalOpen: true,
      browserOpen: true,
    })
    const result = closeTerminal(initial, BROWSER, TERMINAL)
    assert.equal(result.terminalOpen, false)
    assert.deepEqual(result.activeView, { kind: 'browser', browserId: BROWSER })
  })
})

// ---------------------------------------------------------------------------
// Fallback selection
// ---------------------------------------------------------------------------

describe('fallbackView', () => {
  test('prefers last file', () => {
    const result = fallbackView(['a.ts', 'b.ts'], [], true, true, BROWSER, TERMINAL)
    assert.deepEqual(result, { kind: 'file', path: 'b.ts' })
  })

  test('falls back to browser', () => {
    const result = fallbackView([], [], true, true, BROWSER, TERMINAL)
    assert.deepEqual(result, { kind: 'browser', browserId: BROWSER })
  })

  test('falls back to terminal', () => {
    const result = fallbackView([], [], false, true, BROWSER, TERMINAL)
    assert.deepEqual(result, { kind: 'terminal', terminalId: TERMINAL })
  })

  test('returns null when nothing available', () => {
    assert.equal(fallbackView([], [], false, false, BROWSER, TERMINAL), null)
  })
})

// ---------------------------------------------------------------------------
// Workspace switching — A → B → A
// ---------------------------------------------------------------------------

describe('workspace switching', () => {
  test('independent workspaces maintain distinct state', () => {
    const states: Record<string, WorkspaceViewerState> = {}

    // Workspace A: open two files, activate second
    states['/a'] = pinTab(openFile(defaultViewerState(), 'a1.ts'), 'file:a1.ts')
    states['/a'] = openFile(states['/a'], 'a2.ts')
    states['/a'] = openBrowser(states['/a'], BROWSER)

    // Workspace B: open one file and terminal
    states['/b'] = openFile(defaultViewerState(), 'b1.ts')
    states['/b'] = openTerminal(states['/b'], TERMINAL)

    // Switch A → B → A: each workspace keeps its own state
    assert.deepEqual(states['/a'].openFilePaths, ['a1.ts', 'a2.ts'])
    assert.equal(states['/a'].browserOpen, true)
    assert.deepEqual(states['/a'].activeView, { kind: 'browser', browserId: BROWSER })

    assert.deepEqual(states['/b'].openFilePaths, ['b1.ts'])
    assert.equal(states['/b'].terminalOpen, true)
    assert.deepEqual(states['/b'].activeView, { kind: 'terminal', terminalId: TERMINAL })

    // State is never copied between workspaces
    assert.equal(states['/a'].terminalOpen, false)
    assert.equal(states['/b'].browserOpen, false)
  })
})

// ---------------------------------------------------------------------------
// Persistence — round-trip
// ---------------------------------------------------------------------------

describe('persistence', () => {
  test('round-trips valid state', () => {
    const original: Record<string, WorkspaceViewerState> = {
      '/workspace/a': state({
        openFilePaths: ['a.ts', 'b.ts'],
        activeView: { kind: 'file', path: 'a.ts' },
        browserOpen: true,
        touchedAt: 1000,
      }),
      '/workspace/b': state({
        openFilePaths: ['c.ts'],
        activeView: { kind: 'terminal', terminalId: TERMINAL },
        terminalOpen: true,
        touchedAt: 2000,
      }),
    }
    const serialized = writePersistedStates(original)
    const restored = readPersistedStates(serialized)

    assert.deepEqual(restored['/workspace/a'].openFilePaths, ['a.ts', 'b.ts'])
    assert.deepEqual(restored['/workspace/a'].activeView, { kind: 'file', path: 'a.ts' })
    assert.equal(restored['/workspace/a'].browserOpen, true)

    assert.deepEqual(restored['/workspace/b'].openFilePaths, ['c.ts'])
    assert.deepEqual(restored['/workspace/b'].activeView, {
      kind: 'terminal',
      terminalId: TERMINAL,
    })
    assert.equal(restored['/workspace/b'].terminalOpen, true)
  })

  test('returns empty for null input', () => {
    assert.deepEqual(readPersistedStates(null), {})
  })

  test('returns empty for malformed JSON', () => {
    assert.deepEqual(readPersistedStates('not-json'), {})
  })

  test('returns empty for wrong version', () => {
    assert.deepEqual(readPersistedStates('{"version":99,"workspaces":{}}'), {})
  })

  test('returns empty for missing workspaces key', () => {
    assert.deepEqual(readPersistedStates('{"version":1}'), {})
  })

  test('skips entries with invalid openFilePaths', () => {
    const raw = JSON.stringify({
      version: 1,
      workspaces: {
        '/a': {
          openFilePaths: 'not-array',
          activeView: null,
          browserOpen: false,
          terminalOpen: false,
          touchedAt: 1,
        },
        '/b': {
          openFilePaths: ['valid.ts'],
          activeView: null,
          browserOpen: false,
          terminalOpen: false,
          touchedAt: 2,
        },
      },
    })
    const result = readPersistedStates(raw)
    assert.equal(result['/a'], undefined)
    assert.deepEqual(result['/b'].openFilePaths, ['valid.ts'])
  })

  test('filters out absolute and traversal paths', () => {
    const raw = JSON.stringify({
      version: 1,
      workspaces: {
        '/w': {
          openFilePaths: [
            'good.ts',
            '/absolute.ts',
            '../traversal.ts',
            './dot.ts',
            '',
            'also/good.ts',
          ],
          activeView: null,
          browserOpen: false,
          terminalOpen: false,
          touchedAt: 1,
        },
      },
    })
    const result = readPersistedStates(raw)
    assert.deepEqual(result['/w'].openFilePaths, ['good.ts', 'also/good.ts'])
  })

  test('deduplicates file paths', () => {
    const raw = JSON.stringify({
      version: 1,
      workspaces: {
        '/w': {
          openFilePaths: ['a.ts', 'b.ts', 'a.ts'],
          activeView: null,
          browserOpen: false,
          terminalOpen: false,
          touchedAt: 1,
        },
      },
    })
    const result = readPersistedStates(raw)
    assert.deepEqual(result['/w'].openFilePaths, ['a.ts', 'b.ts'])
  })

  test('repairs invalid activeView to null', () => {
    const raw = JSON.stringify({
      version: 1,
      workspaces: {
        '/w': {
          openFilePaths: ['a.ts'],
          activeView: { kind: 'file', path: 'not-open.ts' },
          browserOpen: false,
          terminalOpen: false,
          touchedAt: 1,
        },
      },
    })
    const result = readPersistedStates(raw)
    assert.equal(result['/w'].activeView, null)
  })

  test('repairs browser activeView when browserOpen is false', () => {
    const raw = JSON.stringify({
      version: 1,
      workspaces: {
        '/w': {
          openFilePaths: [],
          activeView: { kind: 'browser', browserId: BROWSER },
          browserOpen: false,
          terminalOpen: false,
          touchedAt: 1,
        },
      },
    })
    const result = readPersistedStates(raw)
    assert.equal(result['/w'].activeView, null)
  })
})

// ---------------------------------------------------------------------------
// Persistence — bounds
// ---------------------------------------------------------------------------

describe('persistence bounds', () => {
  test('evicts least-recently-touched workspaces beyond 24', () => {
    const states: Record<string, WorkspaceViewerState> = {}
    for (let i = 0; i < 30; i++) {
      states[`/workspace/${i}`] = state({ touchedAt: i })
    }
    const serialized = writePersistedStates(states)
    const restored = readPersistedStates(serialized)
    const keys = Object.keys(restored)
    assert.equal(keys.length, 24)
    // The 6 oldest (touchedAt 0–5) should be evicted
    for (let i = 0; i < 6; i++) {
      assert.equal(restored[`/workspace/${i}`], undefined, `workspace ${i} should be evicted`)
    }
    for (let i = 6; i < 30; i++) {
      assert.ok(restored[`/workspace/${i}`], `workspace ${i} should be kept`)
    }
  })

  test('caps file paths at 50 per workspace', () => {
    const paths = Array.from({ length: 60 }, (_, i) => `file${i}.ts`)
    const states: Record<string, WorkspaceViewerState> = {
      '/w': state({ openFilePaths: paths }),
    }
    const serialized = writePersistedStates(states)
    const restored = readPersistedStates(serialized)
    assert.equal(restored['/w'].openFilePaths.length, 50)
    assert.equal(restored['/w'].openFilePaths[0], 'file0.ts')
    assert.equal(restored['/w'].openFilePaths[49], 'file49.ts')
  })
})
