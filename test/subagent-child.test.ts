import { deepEqual, equal, ok } from 'node:assert/strict'
import { test } from 'node:test'
import {
  applySubagentEvent,
  createSubagentStream,
  progressText,
  subagentChildArguments,
} from '../pi-extensions/subagent-child.ts'

const baseOptions = {
  extensions: ['/ext/fff.ts', '/ext/budget-guard.ts'],
  tools: ['fffind', 'ffgrep', 'read', 'bash'],
  task: 'Explain the session store',
  images: [],
  sessionName: 'subagent/research: Explain the session store',
  systemPrompt: 'PROMPT',
  model: 'openrouter/z-ai/glm-5.3-flash',
  thinking: 'off',
}

test('child arguments persist a named session and load only the given extensions', () => {
  const args = subagentChildArguments(baseOptions)

  ok(!args.includes('--no-session'), 'the child must persist its session')
  ok(args.includes('--no-extensions'), 'global extensions must not load into the child')
  deepEqual(args.slice(args.indexOf('--name'), args.indexOf('--name') + 2), [
    '--name',
    'subagent/research: Explain the session store',
  ])
  deepEqual(args.filter((_value, index) => args[index - 1] === '--extension'), [
    '/ext/fff.ts',
    '/ext/budget-guard.ts',
  ])
  equal(args[args.indexOf('--tools') + 1], 'fffind,ffgrep,read,bash')
  deepEqual(args.slice(args.indexOf('--print')), ['--print', 'Explain the session store'])
})

test('images are passed as @path arguments before the task', () => {
  const args = subagentChildArguments({
    ...baseOptions,
    images: ['/tmp/one.png', '/tmp/two.png'],
  })

  deepEqual(args.slice(args.indexOf('--print')), [
    '--print',
    '@/tmp/one.png',
    '@/tmp/two.png',
    'Explain the session store',
  ])
})

test('an omitted model leaves model selection to the child configuration', () => {
  const args = subagentChildArguments({ ...baseOptions, model: '' })

  ok(!args.includes('--model'))
})

test('the event stream yields the session id, counters, usage, and the answer', () => {
  const stream = createSubagentStream()

  equal(
    applySubagentEvent(stream, JSON.stringify({ type: 'session', version: 3, id: 'abc-123' })),
    'session',
  )
  equal(applySubagentEvent(stream, JSON.stringify({ type: 'turn_start' })), 'turn')
  equal(
    applySubagentEvent(
      stream,
      JSON.stringify({ type: 'tool_execution_start', toolName: 'ffgrep', args: {} }),
    ),
    'tool',
  )
  applySubagentEvent(
    stream,
    JSON.stringify({
      type: 'tool_execution_end',
      toolName: 'ffgrep',
      result: { content: [{ type: 'text', text: 'server/pi-session-store.ts:50' }] },
    }),
  )
  equal(
    applySubagentEvent(
      stream,
      JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'The store scans one workspace folder.' }],
          usage: { totalTokens: 673, cost: { total: 0.000051 } },
        },
      }),
    ),
    'answer',
  )

  equal(stream.sessionId, 'abc-123')
  equal(stream.turnCount, 1)
  equal(stream.toolCount, 1)
  equal(stream.completedToolCount, 1)
  equal(stream.lastTool, 'ffgrep')
  equal(stream.totalTokens, 673)
  equal(stream.costUsd, 0.000051)
  equal(stream.output, 'The store scans one workspace folder.')
  ok(stream.evidence.includes('server/pi-session-store.ts:50'), 'tool evidence is retained')
})

test('malformed and unrelated lines are ignored', () => {
  const stream = createSubagentStream()

  equal(applySubagentEvent(stream, 'not json'), undefined)
  equal(applySubagentEvent(stream, ''), undefined)
  equal(applySubagentEvent(stream, JSON.stringify({ type: 'agent_start' })), undefined)
  equal(stream.turnCount, 0)
})

test('progress reports the tool budget and warns once the soft target is reached', () => {
  const stream = createSubagentStream()
  stream.turnCount = 1
  const budget = { effort: 'standard', softToolCalls: 12, hardToolCalls: 16 }

  equal(progressText(stream, budget), 'Researching [standard]: turn 1...')

  stream.toolCount = 12
  stream.lastTool = 'read'
  ok(progressText(stream, budget).includes('12/12 target, 16 max'))
  ok(progressText(stream, budget).includes('Target reached'))
})
