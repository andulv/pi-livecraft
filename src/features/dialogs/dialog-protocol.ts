import {
  askUserQuestionProtocol,
  parseAskUserQuestionRequest,
} from '../../../shared/ask-user-question.ts'
import type { JsonObject, SessionSummary } from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'

export interface UiDialog {
  sessionId: string
  request: JsonObject
}

/** Hides a dialog that belongs to a different active session. */
export function visibleDialogForSession(
  dialog: UiDialog | null,
  sessionId: string,
): UiDialog | null {
  return dialog?.sessionId === sessionId ? dialog : null
}

/** Returns the first blocking request owned by the selected session. */
export function pendingDialogForSession(
  sessions: readonly SessionSummary[],
  sessionId: string,
): UiDialog | null {
  const session = sessions.find(({ id }) => id === sessionId)
  const request = session?.pendingUi.find((candidate) =>
    isBlockingDialog(candidate) && !isAgentSelector(candidate)
  )
  return request ? { sessionId, request } : null
}

export function isAskUserQuestionDialog(value: JsonObject): boolean {
  const payload = typeof value.prefill === 'string' ? safeJsonParse(value.prefill) : null
  return value.method === 'editor'
    && value.title === 'Pi Livecraft questionnaire'
    && isObject(payload)
    && payload.protocol === askUserQuestionProtocol
    && parseAskUserQuestionRequest(payload) !== null
}

export function isAgentSelector(
  value: JsonObject,
): value is JsonObject & { id: string; options: unknown[] } {
  return value.method === 'select'
    && value.title === 'Select an agent'
    && typeof value.id === 'string'
    && Array.isArray(value.options)
}

export function isBlockingDialog(value: JsonObject): boolean {
  return value.method === 'select' || value.method === 'confirm' || value.method === 'input'
    || value.method === 'editor'
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
