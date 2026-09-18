/**
 * How a shub-agent run is recognized once it is only a session file.
 *
 * Ownership lives in a versioned custom entry the child writes at startup
 * (`livecraft.shub-agent`), so classification survives renaming. The display
 * name carries no ownership data; it is only readable text. Shared so the child
 * extension, the session store, and the frontend cannot drift apart.
 */

export const SHUB_MARKER_CUSTOM_TYPE = 'livecraft.shub-agent'
export const SHUB_SESSION_PREFIX = 'shub-agent/'

/** Durable ownership data appended to the child session before the prompt runs. */
export interface ShubMarkerData {
  version: 1
  ownerSessionId: string
  agent: string
}

/**
 * Builds the marker data from the child environment, or undefined when the
 * parent could not determine an owner (for example an in-memory session). A
 * missing marker is reported by the parent run instead of silently misclassifying.
 */
export function buildShubMarkerData(
  environment: { PI_SHUB_OWNER_SESSION_ID?: string; PI_SHUB_AGENT?: string },
): ShubMarkerData | undefined {
  const ownerSessionId = environment.PI_SHUB_OWNER_SESSION_ID?.trim()
  const agent = environment.PI_SHUB_AGENT?.trim()
  if (!ownerSessionId || !agent) return undefined
  return { version: 1, ownerSessionId, agent }
}

/**
 * Extracts marker data from one parsed session JSONL entry, or undefined when
 * the entry is not a valid shub-agent marker.
 */
export function shubMarkerFromEntry(value: unknown): ShubMarkerData | undefined {
  if (
    typeof value !== 'object' || value === null || (value as { type?: unknown }).type !== 'custom'
    || (value as { customType?: unknown }).customType !== SHUB_MARKER_CUSTOM_TYPE
  ) return undefined
  const data = (value as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return undefined
  const { version, ownerSessionId, agent } = data as Record<string, unknown>
  if (
    version !== 1 || typeof ownerSessionId !== 'string' || !ownerSessionId
    || typeof agent !== 'string' || !agent
  ) return undefined
  return { version: 1, ownerSessionId, agent }
}

/** Compact token count for measurement displays; e.g. 48190 becomes "48.2k". */
export function shubCompactTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(tokens >= 100_000 ? 0 : 1)}k`
  return String(Math.round(tokens))
}

/**
 * Formats the subagent efficiency measurement: total read tokens versus
 * delivered report tokens with the percentage not in the final output,
 * plus context size versus output. E.g. "67.0k read → 1.2k out (98% saved),
 * 14.6k ctx → 1.2k out (92% saved)".
 */
export function shubMeasurementLabel(
  totalTokens: number,
  outputChars: number,
  contextTokens?: number,
): string {
  const outputTokens = Math.round(outputChars / 4)
  const readPart = `${shubCompactTokens(totalTokens)} read → ${
    shubCompactTokens(outputTokens)
  } out (${savedPercent(totalTokens, outputTokens)}% saved)`
  const parts = [readPart]
  if (contextTokens !== undefined && contextTokens > 0)
    parts.push(
      `${shubCompactTokens(contextTokens)} ctx → ${shubCompactTokens(outputTokens)} out (${
        savedPercent(contextTokens, outputTokens)
      }% saved)`,
    )
  return parts.join(', ')
}

function savedPercent(total: number, delivered: number): number {
  if (total <= 0) return 0
  return Math.round((1 - delivered / total) * 100)
}

/** Builds the persisted child display name; the marker, not this name, carries ownership. */
export function shubAgentSessionName(agent: string, task: string): string {
  return `${SHUB_SESSION_PREFIX}${agent}: ${task.trim().slice(0, 120)}`
}

/** Extracts Pi's session id from its persisted `<timestamp>_<id>.jsonl` filename. */
export function sessionIdFromFilePath(path: string | undefined): string | undefined {
  if (!path) return undefined
  const fileName = path.split(/[\\/]/).pop() ?? ''
  return /_([^_]+)\.jsonl$/.exec(fileName)?.[1]
}
