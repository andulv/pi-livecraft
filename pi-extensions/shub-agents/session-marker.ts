/**
 * Durable ownership for a shub-agent child run.
 *
 * Loaded only into the child Pi process started by the shub-agents extension.
 * During startup, before the prompt runs, this appends a versioned custom entry
 * carrying the owner session id and agent name. That marker — not the display
 * name — is how the session store and frontend classify the run, so it survives
 * renaming. The parent reports a missing marker instead of letting the session
 * silently appear as an ordinary session.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { buildShubMarkerData, SHUB_MARKER_CUSTOM_TYPE } from '../../shared/shub-agent-session.ts'

export default function shubSessionMarker(pi: ExtensionAPI): void {
  pi.on('session_start', async () => {
    const data = buildShubMarkerData(process.env)
    if (data) await pi.appendEntry(SHUB_MARKER_CUSTOM_TYPE, data)
  })
}
