import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isVisibleConversationMessage,
  providerError,
  reasoningTextForDisplay,
  supersededProviderFailures,
  userPromptText,
} from '../src/features/conversation/message-display.ts'

test('removes standard CSI SGR truecolor styling and resets', () => {
  assert.equal(
    reasoningTextForDisplay(
      'assistant',
      '\x1b[38;2;56;189;248mThinking:\x1b[39m details\x1b[0m',
    ),
    'Thinking: details',
  )
})

test('removes C1 CSI SGR sequences', () => {
  assert.equal(
    reasoningTextForDisplay('assistant', '\x9b1;38;2;56;189;248mThinking\x9b0m'),
    'Thinking',
  )
})

test('preserves Markdown, bracketed text, and non-SGR controls', () => {
  const text = '[38;2;56;189;248m **Markdown** \x1b[2J'

  assert.equal(reasoningTextForDisplay('assistant', text), text)

  const styledCustomContent = '\x1b[31mextension-owned\x1b[0m'
  assert.equal(reasoningTextForDisplay('custom', styledCustomContent), styledCustomContent)
})

test('keeps failed provider responses visible with their safe error details', () => {
  const message = {
    role: 'assistant',
    content: [],
    stopReason: 'error',
    errorMessage: 'Rate limit exceeded',
    model: 'gpt-5',
  }

  assert.equal(isVisibleConversationMessage(message), true)
  assert.deepEqual(providerError(message), {
    errorMessage: 'Rate limit exceeded',
    model: 'gpt-5',
  })
})

test('uses a diagnostic message without exposing its stack when direct error text is absent', () => {
  assert.deepEqual(
    providerError({
      role: 'assistant',
      content: [],
      stopReason: 'error',
      diagnostics: [{
        error: { message: 'Provider connection closed', stack: 'sensitive implementation details' },
      }],
    }),
    { errorMessage: 'Provider connection closed' },
  )
})

test('collapses automatic retry attempts to their final empty provider failure', () => {
  const first = { role: 'assistant', content: [], stopReason: 'error' }
  const second = { role: 'assistant', content: [], stopReason: 'error' }
  const final = { role: 'assistant', content: [], stopReason: 'error' }
  const nextTurnFailure = { role: 'assistant', content: [], stopReason: 'error' }

  const superseded = supersededProviderFailures([
    { role: 'user', content: 'First request' },
    first,
    second,
    final,
    { role: 'user', content: 'Second request' },
    nextTurnFailure,
  ])

  assert.equal(superseded.has(first), true)
  assert.equal(superseded.has(second), true)
  assert.equal(superseded.has(final), false)
  assert.equal(superseded.has(nextTurnFailure), false)
})

test('extracts user text for retrying a failed turn', () => {
  assert.equal(
    userPromptText({
      role: 'user',
      content: [{ type: 'text', text: 'First line' }, { type: 'text', text: 'Second line' }],
    }),
    'First line\nSecond line',
  )
  assert.equal(userPromptText({ role: 'assistant', content: 'No retry prompt' }), undefined)
})
