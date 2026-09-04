/** Keyboard outcomes that need handling outside xterm's default key mapping. */
export type TerminalKeyAction = 'copy' | 'interrupt' | 'passthrough'

/** Minimal event shape needed by the platform-independent terminal key policy. */
export interface TerminalKeyInput {
  altKey: boolean
  ctrlKey: boolean
  key: string
  metaKey: boolean
  shiftKey: boolean
}

/**
 * Preserves terminal copy conventions while making Ctrl+C interruption explicit.
 * Ctrl+C copies an active selection; Ctrl+Shift+C and Cmd+C are always copy.
 */
export function terminalKeyAction(
  event: TerminalKeyInput,
  hasSelection: boolean,
): TerminalKeyAction {
  if (event.key.toLowerCase() !== 'c') return 'passthrough'
  if (event.metaKey || (event.ctrlKey && (event.shiftKey || hasSelection))) return 'copy'
  if (event.ctrlKey && !event.altKey) return 'interrupt'
  return 'passthrough'
}
