/**
 * React hook wrapping the pure workspace viewer-state model. Manages one
 * `Record<workspacePath, WorkspaceViewerState>` map and derives the selected
 * workspace's state from the current `workspacePath`.
 *
 * Workspace switching is a key lookup — no setState calls for viewer state,
 * no reset callback, no intermediate blank state.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type PaneView,
  type WorkspaceViewerState,
  STORAGE_KEY,
  activateBrowser,
  activateFile,
  activateTerminal,
  closeBrowser,
  closeFile,
  closeTerminal,
  defaultViewerState,
  openBrowser,
  openFile,
  openTerminal,
  readPersistedStates,
  writePersistedStates,
} from './workspace-viewer-state.ts'

export type { PaneView, WorkspaceViewerState }

/** Stable action callbacks for one workspace's viewer state. */
export interface WorkspaceViewerActions {
  handleOpenFile: (path: string) => void
  handleActivateFile: (path: string) => void
  handleCloseFile: (path: string) => void
  handleOpenBrowser: () => void
  handleActivateBrowser: () => void
  handleCloseBrowser: () => void
  handleOpenTerminal: () => void
  handleActivateTerminal: () => void
  handleCloseTerminal: () => void
}

/**
 * Owns per-workspace viewer state with localStorage persistence.
 *
 * On workspace switch, the new workspace's state is available immediately via
 * map lookup — zero additional setState calls. FileContentPane still remounts
 * via `key={workspacePath}` to dispose runtime file content and viewer
 * resources; this hook only manages the tab/view metadata.
 */
export function useWorkspaceViewerState(
  workspacePath: string,
  browserId: string,
  terminalId: string,
): WorkspaceViewerState & WorkspaceViewerActions {
  const [states, setStates] = useState<Record<string, WorkspaceViewerState>>(() =>
    readPersistedStates(window.localStorage.getItem(STORAGE_KEY))
  )

  // Persist on every change. The payload is small (≤48 KB worst case) and
  // writes happen on user actions (tab open/close), not on every render.
  const statesRef = useRef(states)
  statesRef.current = states
  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, writePersistedStates(states))
  }, [states])

  // Derive the current workspace's state from the map.
  const current = states[workspacePath] ?? defaultViewerState()

  /** Applies a pure transition to the current workspace entry in the map. */
  const update = useCallback(
    (transition: (state: WorkspaceViewerState) => WorkspaceViewerState): void => {
      setStates((prev) => {
        const entry = prev[workspacePath] ?? defaultViewerState()
        const next = transition(entry)
        if (next === entry) return prev
        return { ...prev, [workspacePath]: next }
      })
    },
    [workspacePath],
  )

  // --- File actions ---

  const handleOpenFile = useCallback(
    (path: string) => update((state) => openFile(state, path)),
    [update],
  )
  const handleActivateFile = useCallback(
    (path: string) => update((state) => activateFile(state, path)),
    [update],
  )
  const handleCloseFile = useCallback(
    (path: string) => update((state) => closeFile(state, path, browserId, terminalId)),
    [browserId, terminalId, update],
  )

  // --- Browser actions ---

  const handleOpenBrowser = useCallback(
    () => update((state) => openBrowser(state, browserId)),
    [browserId, update],
  )
  const handleActivateBrowser = useCallback(
    () => update((state) => activateBrowser(state, browserId)),
    [browserId, update],
  )
  const handleCloseBrowser = useCallback(
    () => update((state) => closeBrowser(state, browserId, terminalId)),
    [browserId, terminalId, update],
  )

  // --- Terminal actions ---

  const handleOpenTerminal = useCallback(
    () => update((state) => openTerminal(state, terminalId)),
    [terminalId, update],
  )
  const handleActivateTerminal = useCallback(
    () => update((state) => activateTerminal(state, terminalId)),
    [terminalId, update],
  )
  const handleCloseTerminal = useCallback(
    () => update((state) => closeTerminal(state, browserId, terminalId)),
    [browserId, terminalId, update],
  )

  return {
    ...current,
    handleOpenFile,
    handleActivateFile,
    handleCloseFile,
    handleOpenBrowser,
    handleActivateBrowser,
    handleCloseBrowser,
    handleOpenTerminal,
    handleActivateTerminal,
    handleCloseTerminal,
  }
}
