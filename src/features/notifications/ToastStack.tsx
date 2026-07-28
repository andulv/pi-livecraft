export interface Toast {
  id: string
  kind: 'notice' | 'error'
  message: string
  sessionId: string | null
  action?: {
    label: string
    cwd: string
    sessionId: string
    sessionPath?: string
  }
  dismissing?: boolean
}

/** Displays temporary notifications above the input area. */
export function ToastStack({ onAction, onDismiss, standalone = false, toasts }: {
  onAction: (toast: Toast) => void
  onDismiss: (id: string) => void
  standalone?: boolean
  toasts: Toast[]
}) {
  if (toasts.length === 0) return null

  return <div aria-label="Notifications" aria-live="polite" aria-relevant="additions removals" className={`toast-stack${standalone ? ' toast-stack-standalone' : ''}`}>
    {toasts.map((toast) => <ToastItem key={toast.id} onAction={onAction} onDismiss={onDismiss} toast={toast} />)}
  </div>
}

/** Presents a notification's content and dismiss action. */
function ToastItem({ onAction, onDismiss, toast }: { onAction: (toast: Toast) => void; onDismiss: (id: string) => void; toast: Toast }) {
  return <div className={`toast ${toast.kind}${toast.dismissing ? ' dismissing' : ''}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
    {toast.action ? <button aria-label={toast.action.label} className="toast-message toast-action" disabled={toast.dismissing} onClick={() => onAction(toast)} type="button">{toast.message}</button> : <span className="toast-message">{toast.message}</span>}
    <button aria-label="Dismiss notification" className="toast-dismiss" disabled={toast.dismissing} onClick={() => onDismiss(toast.id)} type="button">×</button>
  </div>
}
