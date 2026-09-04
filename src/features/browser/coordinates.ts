import type { BrowserMouseButton } from '../../../shared/types.ts'

/** Maps DOM pointer button numbers to CDP mouse button names. */
export function browserMouseButton(button: number): BrowserMouseButton {
  if (button === 1) return 'middle'
  if (button === 2) return 'right'
  if (button === 3) return 'back'
  if (button === 4) return 'forward'
  return 'left'
}

/** Maps a pane pointer position to page coordinates inside the captured frame. */
export function mapPointerToPage(
  point: { clientX: number; clientY: number },
  frame: {
    rect: { left: number; top: number; width: number; height: number }
    naturalWidth: number
    naturalHeight: number
  },
): { x: number; y: number } {
  if (frame.naturalWidth === 0 || frame.naturalHeight === 0 || frame.rect.width === 0) {
    return { x: 0, y: 0 }
  }
  const x = ((point.clientX - frame.rect.left) / frame.rect.width) * frame.naturalWidth
  const y = ((point.clientY - frame.rect.top) / frame.rect.height) * frame.naturalHeight
  return {
    x: Math.min(frame.naturalWidth, Math.max(0, x)),
    y: Math.min(frame.naturalHeight, Math.max(0, y)),
  }
}

/** CDP modifier bitmask from a keyboard or pointer event's modifier state. */
export function cdpModifiers(modifiers: {
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}): number {
  return (modifiers.altKey ? 1 : 0) | (modifiers.ctrlKey ? 2 : 0) | (modifiers.metaKey ? 4 : 0)
    | (modifiers.shiftKey ? 8 : 0)
}
