import assert from 'node:assert/strict'
import test from 'node:test'
import { applyToolCallUpdate, applyToolExecutionUpdate, assistantTurnParts, conversationMessageEntries, formatToolCallTooltip, formatToolData, interruptToolCallGeneration, isToolCallPending, parseEditDiff, readContentDisplay, sameAssistantMessage, sameMessage, toolCallInUpdate, toolCallPresentation, toolCallsInMessage, toolContentText, toolDataLength, toolEditChanges, toolExecutionUpdateInEvent, toolFilePath, toolResultInMessage, toolTextPreview, truncateToolText, fileUrl } from '../src/features/conversation/tool-calls.ts'

test('extracts tool calls and their resolved result from Pi messages', () => {
  const calls = toolCallsInMessage({
    role: 'assistant',
    content: [
      { type: 'text', text: 'Je regarde.' },
      { type: 'toolCall', id: 'call_1', name: 'read', arguments: { path: 'src/App.tsx' } },
    ],
  })
  const result = toolResultInMessage({
    role: 'toolResult',
    toolCallId: 'call_1',
    toolName: 'read',
    content: [{ type: 'text', text: 'import App' }],
    isError: false,
  })

  assert.deepEqual(calls, [{ id: 'call_1', name: 'read', args: { path: 'src/App.tsx' } }])
  assert.deepEqual(result, {
    toolCallId: 'call_1',
    toolName: 'read',
    content: [{ type: 'text', text: 'import App' }],
    isError: false,
    details: undefined,
  })
  assert.equal(toolContentText(result?.content), 'import App')
})

test('keeps each streamed assistant message before its tool calls', () => {
  const turns = [
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'Inspecting' }, { type: 'toolCall', id: 'call_1', name: 'read', arguments: { path: 'one' } }] },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'Checking' }, { type: 'toolCall', id: 'call_2', name: 'read', arguments: { path: 'two' } }] },
  ]

  assert.deepEqual(turns.flatMap((message) => assistantTurnParts(message).map((part) => part.kind)), ['message', 'tool', 'message', 'tool'])
})

test('reconciles completed messages without collapsing distinct live turns', () => {
  const completed = { role: 'assistant', timestamp: 10, content: [{ type: 'text', text: 'done' }] }
  const different = { role: 'assistant', timestamp: 10, content: [{ type: 'text', text: 'still working' }] }
  const live = [
    { id: 'completed-1', message: completed },
    { id: 'different', message: different },
    { id: 'completed-2', message: completed },
  ]

  assert.equal(sameAssistantMessage(completed, different), false)
  assert.deepEqual(conversationMessageEntries([completed], live).map(({ key, source }) => ({ key, source })), [
    { key: 'completed-1', source: 'history' },
    { key: 'different', source: 'live' },
    { key: 'completed-2', source: 'live' },
  ])
})

test('preserves streamed identities when messages move into history', () => {
  const first = { role: 'assistant', timestamp: 10, content: [{ type: 'text', text: 'first' }] }
  const second = { role: 'assistant', timestamp: 11, content: [{ type: 'text', text: 'second' }] }
  const live = [{ id: 'live-1', message: first }, { id: 'live-2', message: second }]

  assert.deepEqual(conversationMessageEntries([first], live).map(({ key, source }) => ({ key, source })), [
    { key: 'live-1', source: 'history' },
    { key: 'live-2', source: 'live' },
  ])
  assert.deepEqual(conversationMessageEntries([first, second], live).map(({ key, source }) => ({ key, source })), [
    { key: 'live-1', source: 'history' },
    { key: 'live-2', source: 'history' },
  ])
})

test('tracks raw tool arguments from generation start to completion', () => {
  const partialCall = { type: 'toolCall', id: 'call_1', name: 'read', arguments: { path: 'src/App' } }
  const start = toolCallInUpdate({
    type: 'message_update',
    assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1, partial: { content: [{ type: 'text' }, partialCall] } },
  })
  const delta = toolCallInUpdate({
    type: 'message_update',
    assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 1, delta: '{"path":"src/App', partial: { content: [{ type: 'text' }, partialCall] } },
  })
  const end = toolCallInUpdate({
    type: 'message_update',
    assistantMessageEvent: {
      type: 'toolcall_end',
      contentIndex: 1,
      toolCall: { type: 'toolCall', id: 'call_1', name: 'read', arguments: { path: 'src/App.tsx' } },
    },
  })

  assert.deepEqual(start, { call: { id: 'call_1', name: 'read', args: { path: 'src/App' } }, contentIndex: 1, delta: '', phase: 'start' })
  assert.deepEqual(delta, { call: { id: 'call_1', name: 'read', args: { path: 'src/App' } }, contentIndex: 1, delta: '{"path":"src/App', phase: 'delta' })
  assert.deepEqual(end, { call: { id: 'call_1', name: 'read', args: { path: 'src/App.tsx' } }, contentIndex: 1, delta: '', phase: 'end' })
  assert.equal(toolCallInUpdate({ type: 'message_update', assistantMessageEvent: { type: 'text_delta' } }), null)
})

test('accumulates arguments and preserves interrupted generations', () => {
  const start = { call: { id: '', name: 'write', args: {} }, contentIndex: 0, delta: '', phase: 'start' as const }
  const delta = { call: { id: 'call_1', name: 'write', args: { path: 'note' } }, contentIndex: 0, delta: '{"path":"note', phase: 'delta' as const }
  const executions = applyToolCallUpdate(applyToolCallUpdate([], start, 'draft_1'), delta, 'unused')

  assert.deepEqual(executions, [{
    id: 'call_1',
    name: 'write',
    args: { path: 'note' },
    contentIndex: 0,
    status: 'generating',
  }])
  assert.equal(interruptToolCallGeneration(executions)[0]?.status, 'interrupted')

  const completed = applyToolCallUpdate(executions, {
    call: { id: 'call_1', name: 'write', args: { path: 'note.md' } },
    contentIndex: 0,
    delta: '',
    phase: 'end',
  }, 'unused')
  assert.equal(completed[0]?.status, 'running')
  assert.deepEqual(completed[0]?.args, { path: 'note.md' })
})

test('preserves partial arguments through multiple deltas', () => {
  const start = { call: { id: '', name: 'read', args: {} }, contentIndex: 0, delta: '', phase: 'start' as const }
  const first = applyToolCallUpdate(applyToolCallUpdate([], start, 'draft_1'), {
    call: { id: 'call_1', name: 'read', args: { path: 'src/App' } },
    contentIndex: 0,
    delta: '{"path":"src/App',
    phase: 'delta',
  }, 'unused')
  const second = applyToolCallUpdate(first, {
    call: { id: 'call_1', name: 'read', args: { path: 'src/App.tsx' } },
    contentIndex: 0,
    delta: '.tsx"}',
    phase: 'delta',
  }, 'unused')

  assert.equal(second[0]?.status, 'generating')
  assert.deepEqual(second[0]?.args, { path: 'src/App.tsx' })
})

test('marks a tool call as pending until its result arrives', () => {
  assert.equal(isToolCallPending(undefined), true)
  assert.equal(isToolCallPending({ toolCallId: 'call_1', toolName: 'read', content: '', isError: false }), false)
})

test('ignores non-tool content and formats tool arguments safely', () => {
  assert.deepEqual(toolCallsInMessage({ role: 'assistant', content: [{ type: 'text', text: 'Bonjour' }] }), [])
  assert.equal(toolResultInMessage({ role: 'user', content: 'Bonjour' }), null)
  assert.equal(formatToolData({ command: 'pwd' }), '{\n  "command": "pwd"\n}')
})

test('extracts valid edit replacements without accepting malformed entries', () => {
  assert.deepEqual(toolEditChanges({
    edits: [
      { oldText: 'before', newText: 'after' },
      { oldText: '', newText: 'inserted' },
      { oldText: 'missing replacement' },
    ],
  }), [
    { oldText: 'before', newText: 'after' },
    { oldText: '', newText: 'inserted' },
  ])
  assert.deepEqual(toolEditChanges({ edits: 'not an array' }), [])
})

test('measures serialized arguments and adds input and output sizes below the full tool title', () => {
  assert.equal(toolDataLength({ command: 'pwd' }), 17)
  assert.equal(formatToolCallTooltip('pwd', 17), 'pwd\nCall: 17 characters')
  assert.equal(formatToolCallTooltip('pwd', 17, 0), 'pwd\nCall: 17 characters · Result: 0 characters')
})

test('truncates text only after 140 characters', () => {
  const limit = 'a'.repeat(140)
  assert.deepEqual(truncateToolText(limit), { text: limit, truncated: false })
  assert.deepEqual(truncateToolText(`${limit}b`), { text: `${limit}…`, truncated: true })
})

test('previews four lines and reports the remaining output', () => {
  assert.deepEqual(toolTextPreview('one\ntwo\nthree\nfour\nfive\nsix'), {
    text: 'one\ntwo\nthree\nfour…',
    remainingLineCount: 2,
  })
  assert.deepEqual(toolTextPreview('one\ntwo\nthree\nfour\n'), {
    text: 'one\ntwo\nthree\nfour\n',
    remainingLineCount: 0,
  })
})

test('builds browser file URLs from Linux, Windows, and WSL paths', () => {
  assert.equal(fileUrl('/home/ada/index.html'), 'file:///home/ada/index.html')
  assert.equal(fileUrl('C:\\Users\\Ada Lovelace\\index.html'), 'file:///C:/Users/Ada%20Lovelace/index.html')
  assert.equal(fileUrl('\\\\wsl.localhost\\Ubuntu\\home\\ada\\index.html'), 'file://wsl.localhost/Ubuntu/home/ada/index.html')
})

test('detects Markdown, HTML and supported code formats read from the repository', () => {
  assert.deepEqual(readContentDisplay({ path: 'docs/guide.md' }), { kind: 'markdown' })
  assert.deepEqual(readContentDisplay({ path: 'src/App.tsx' }), { kind: 'code', language: 'typescript' })
  assert.deepEqual(readContentDisplay({ path: 'public/preview.html' }), { kind: 'html' })
  assert.deepEqual(readContentDisplay({ path: 'dist/favicon.svg' }), { kind: 'svg' })
  assert.deepEqual(readContentDisplay({ path: 'src/Program.cs' }), { kind: 'code', language: 'csharp' })
  assert.deepEqual(readContentDisplay({ path: 'notes.txt' }), { kind: 'text' })
  assert.deepEqual(readContentDisplay({}), { kind: 'text' })
})

test('extracts a usable file path from read and write calls', () => {
  assert.equal(toolFilePath({ path: 'src/App.tsx' }), 'src/App.tsx')
  assert.equal(toolFilePath({ path: '' }), null)
  assert.equal(toolFilePath({}), null)
})

test('uses the Bash presentation while preserving the generic fallback', () => {
  const command = 'a'.repeat(81)
  assert.deepEqual(toolCallPresentation({ id: 'call_1', name: 'bash', args: { command, timeout: 30 } }), {
    headerDetail: { text: `${'a'.repeat(80)}…`, title: command },
    pendingDetail: 'timeout: 30s',
  })
  assert.deepEqual(toolCallPresentation({ id: 'call_2', name: 'bash', args: { timeout: 30 } }), {})
})

test('displays search patterns and their optional paths', () => {
  const root = '/workspace/repository'

  assert.deepEqual(toolCallPresentation({ id: 'call_1', name: 'find', args: { pattern: 'tool call', path: `${root}/src` } }, root), {
    headerDetail: { text: 'tool call · src', title: 'tool call · src' },
  })
  assert.deepEqual(toolCallPresentation({ id: 'call_2', name: 'grep', args: { pattern: 'toolCallPresentation' } }, root), {
    headerDetail: { text: 'toolCallPresentation', title: 'toolCallPresentation' },
  })
  assert.deepEqual(toolCallPresentation({ id: 'call_3', name: 'find', args: { path: 'src' } }, root), {})
})

test('displays file tool paths relative to the repository and truncates them', () => {
  const root = '/workspace/repository'
  const path = `${root}/src/${'a'.repeat(80)}`

  for (const name of ['read', 'edit', 'write']) {
    assert.deepEqual(toolCallPresentation({ id: 'call_1', name, args: { path } }, root), {
      headerDetail: { text: `src/${'a'.repeat(76)}…`, title: `src/${'a'.repeat(80)}` },
    })
  }
  assert.deepEqual(toolCallPresentation({ id: 'call_2', name: 'read', args: { path: '/tmp/file.txt' } }, root), {
    headerDetail: { text: '/tmp/file.txt', title: '/tmp/file.txt' },
  })
  assert.deepEqual(toolCallPresentation({ id: 'call_3', name: 'read', args: {} }, root), {})
})

test('keeps the read range visible beside a truncated path', () => {
  const root = '/workspace/repository'
  const path = `${root}/src/${'a'.repeat(80)}`

  assert.deepEqual(toolCallPresentation({ id: 'call_1', name: 'read', args: { path, offset: 41, limit: 20 } }, root), {
    headerDetail: { text: `src/${'a'.repeat(76)}…`, title: `src/${'a'.repeat(80)}`, suffix: '[41:60]' },
  })
  assert.deepEqual(toolCallPresentation({ id: 'call_2', name: 'read', args: { path: 'src/App.tsx', limit: 60 } }, root), {
    headerDetail: { text: 'src/App.tsx', title: 'src/App.tsx', suffix: '[1:60]' },
  })
  assert.deepEqual(toolCallPresentation({ id: 'call_3', name: 'read', args: { path: 'src/App.tsx', offset: 0 } }, root), {
    headerDetail: { text: 'src/App.tsx', title: 'src/App.tsx' },
  })
})

test('parses Pi edit diff lines with added, removed, and context line numbers', () => {
  const diff = [
    ' 2   unchanged context',
    '-3   removed line',
    '+3   added line',
    ' 4   after change',
    '      ...',
  ].join('\n')
  const parsed = parseEditDiff(diff)
  assert.deepEqual(parsed, [
    { content: '  unchanged context', kind: 'context', lineNumber: 2 },
    { content: '  removed line', kind: 'removed', lineNumber: 3 },
    { content: '  added line', kind: 'added', lineNumber: 3 },
    { content: '  after change', kind: 'context', lineNumber: 4 },
    { content: '      ...', kind: 'context', lineNumber: null },
  ])
})

test('parses diff with only insertions and only deletions', () => {
  const onlyAdded = parseEditDiff('+10 new file content')
  assert.deepEqual(onlyAdded[0], { content: 'new file content', kind: 'added', lineNumber: 10 })

  const onlyRemoved = parseEditDiff('-3 deprecated code')
  assert.deepEqual(onlyRemoved[0], { content: 'deprecated code', kind: 'removed', lineNumber: 3 })
})

test('carries details from Pi tool result messages in history', () => {
  const result = toolResultInMessage({
    role: 'toolResult',
    toolCallId: 'edit_1',
    toolName: 'edit',
    content: 'Successfully replaced 1 block(s).',
    isError: false,
    details: { diff: '+1 added', firstChangedLine: 1 },
  })
  assert.deepEqual(result, {
    toolCallId: 'edit_1',
    toolName: 'edit',
    content: 'Successfully replaced 1 block(s).',
    isError: false,
    details: { diff: '+1 added', firstChangedLine: 1 },
  })
})

test('extracts validated tool_execution_update events and rejects malformed ones', () => {
  assert.equal(toolExecutionUpdateInEvent({ type: 'other' }), null)
  assert.equal(toolExecutionUpdateInEvent({ type: 'tool_execution_update' }), null)
  assert.equal(toolExecutionUpdateInEvent({ type: 'tool_execution_update', toolCallId: 'call_1', toolName: 'bash', partialResult: null }), null)

  const update = toolExecutionUpdateInEvent({
    type: 'tool_execution_update',
    toolCallId: 'call_1',
    toolName: 'bash',
    partialResult: { content: [{ type: 'text', text: 'line 1' }], details: { truncation: null } },
  })
  assert.equal(update?.toolCallId, 'call_1')
  assert.equal(update?.toolName, 'bash')
  assert.equal(toolContentText(update?.partialResult.content), 'line 1')
  assert.deepEqual(update?.partialResult.details, { truncation: null })
  assert.equal(toolExecutionUpdateInEvent({
    type: 'tool_execution_update', toolCallId: 'call_1', toolName: 'bash', partialResult: 'not an object',
  }), null)
})

test('replaces partial results for matching running executions', () => {
  const execution: import('../src/features/conversation/tool-calls.ts').ToolExecution = {
    id: 'call_1', name: 'bash', args: { command: 'ls' }, status: 'running',
  }
  const executions = [{ ...execution }]

  const first = applyToolExecutionUpdate(executions, {
    toolCallId: 'call_1', toolName: 'bash', partialResult: { toolCallId: 'call_1', toolName: 'bash', content: 'a', isError: false },
  })
  assert.equal(toolContentText(first[0]?.partialResult?.content), 'a')

  const second = applyToolExecutionUpdate(first, {
    toolCallId: 'call_1', toolName: 'bash', partialResult: { toolCallId: 'call_1', toolName: 'bash', content: 'ab', isError: false },
  })
  assert.equal(toolContentText(second[0]?.partialResult?.content), 'ab')
})

test('matches identical user messages by text content', () => {
  assert.equal(sameMessage({ role: 'user', content: 'Bonjour' }, { role: 'user', content: 'Bonjour' }), true)
  assert.equal(sameMessage({ role: 'user', content: 'Bonjour' }, { role: 'user', content: 'Salut' }), false)
  assert.equal(sameMessage({ role: 'user', content: 'Bonjour' }, { role: 'assistant', content: 'Bonjour' }), false)
  assert.equal(sameMessage({ role: 'user' }, { role: 'user' }), false)
})

test('matches user messages when Pi returns content as an array', () => {
  assert.equal(sameMessage(
    { role: 'user', content: 'Salut' },
    { role: 'user', content: [{ type: 'text', text: 'Salut' }, { type: 'image', data: '...', mimeType: 'image/png' }] },
  ), true)
})

test('reconciles an optimistic user message with its history counterpart', () => {
  const history = [
    { role: 'user', timestamp: 100, content: 'Bonjour' },
    { role: 'assistant', timestamp: 101, content: 'Réponse' },
  ]
  const live = [{ id: 'opt-1', message: { role: 'user', content: 'Bonjour' } }]
  const entries = conversationMessageEntries(history, live)
  assert.deepEqual(entries.map(({ key, source }) => ({ key, source })), [
    { key: 'opt-1', source: 'history' },
    { key: 'history-101-1', source: 'history' },
  ])
})

test('keeps an unmatched optimistic user message as a live entry', () => {
  const history = [{ role: 'assistant', content: 'Précédent' }]
  const live = [{ id: 'opt-1', message: { role: 'user', content: 'En attente' } }]
  const entries = conversationMessageEntries(history, live)
  assert.deepEqual(entries.map(({ key, source }) => ({ key, source })), [
    { key: 'history--0', source: 'history' },
    { key: 'opt-1', source: 'live' },
  ])
})

test('does not touch executions that are not running', () => {
  const settled: import('../src/features/conversation/tool-calls.ts').ToolExecution = {
    id: 'call_1', name: 'bash', args: {}, result: { toolCallId: 'call_1', toolName: 'bash', content: 'done', isError: false }, status: 'running',
  }
  const updated = applyToolExecutionUpdate([settled], {
    toolCallId: 'call_1', toolName: 'bash', partialResult: { toolCallId: 'call_1', toolName: 'bash', content: 'partial', isError: false },
  })
  assert.equal(toolContentText(updated[0]?.result?.content), 'done')
  assert.equal(updated[0]?.partialResult, undefined)
})
