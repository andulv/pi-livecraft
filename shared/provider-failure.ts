import { isObject } from './is-object.ts'
import type { JsonObject } from './types.ts'

/** Safe, user-facing details Pi records when an assistant provider request fails. */
export interface ProviderFailure {
  errorMessage: string
  model?: string
}

/**
 * Extracts a failed assistant response without exposing provider diagnostic stacks.
 * Pi persists these messages even when they contain no assistant content.
 */
export function providerFailure(message: JsonObject): ProviderFailure | undefined {
  if (message.role !== 'assistant' || message.stopReason !== 'error') return undefined

  const directError = text(message.errorMessage)
  const diagnosticError = firstDiagnosticError(message.diagnostics)
  const errorMessage = directError
    ?? diagnosticError
    ?? 'The provider request failed before any response arrived.'
  const model = text(message.model)
  return { errorMessage, ...(model ? { model } : {}) }
}

function firstDiagnosticError(diagnostics: unknown): string | undefined {
  if (!Array.isArray(diagnostics)) return undefined
  for (const diagnostic of diagnostics) {
    if (!isObject(diagnostic) || !isObject(diagnostic.error)) continue
    const message = text(diagnostic.error.message)
    if (message) return message
  }
  return undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
