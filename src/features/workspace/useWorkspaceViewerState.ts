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
  activateGitDiff,
  activateTerminal,
  closeBrowser,
  closeFile,
  closeGitDiff,
  closeTerminal,
  defaultViewerState,
  openBrowser,
  openFile,
  openGitDiff,
  openTerminal,
  pinTab,
  readPersistedStates,
  writePersistedStates,
} from './workspace-viewer-state.ts'

export type { PaneView, WorkspaceViewerState }

/** Stable action callbacks for one workspace's viewer state. */
export interface WorkspaceViewerActions {
  handleOpenFile: (path: string) => void
  handleOpenGitDiff: (path: string, diff: string, commitHash?: string) => void
  handleActivateFile: (path: string) => void
  handleActivateGitDiff: (id: string) => void
  handleCloseFile: (path: string) => void
  handleCloseGitDiff: (id: string) => void
  handlePinTab: (id: string) => void
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
  const handleOpenGitDiff = useCallback(
    (path: string, diff: string, commitHash?: string) =>
      update((state) => openGitDiff(state, path, diff, commitHash)),
    [update],
  )
  const handleActivateFile = useCallback(
    (path: string) => update((state) => activateFile(state, path)),
    [update],
  )
  const handleActivateGitDiff = useCallback(
    (id: string) => update((state) => activateGitDiff(state, id)),
    [update],
  )
  const handlePinTab = useCallback(
    (id: string) => update((state) => pinTab(state, id)),
    [update],
  )
  const handleCloseFile = useCallback(
    (path: string) => update((state) => closeFile(state, path, browserId, terminalId)),
    [browserId, terminalId, update],
  )

  const handleCloseGitDiff = useCallback(
    (id: string) => update((state) => closeGitDiff(state, id, browserId, terminalId)),
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
    handleOpenGitDiff,
    handleActivateFile,
    handleActivateGitDiff,
    handleCloseFile,
    handleCloseGitDiff,
    handlePinTab,
    handleOpenBrowser,
    handleActivateBrowser,
    handleCloseBrowser,
    handleOpenTerminal,
    handleActivateTerminal,
    handleCloseTerminal,
  }
}
