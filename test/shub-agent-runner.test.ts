import { deepEqual, equal, ok, rejects } from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyShubEvent,
  createShubStream,
  progressText,
  runShubChild,
  shubChildArguments,
} from '../pi-extensions/shub-agents/runner.ts'

const baseOptions = {
  extensions: ['/ext/fff.ts', '/ext/budget-guard.ts'],
  tools: ['fffind', 'ffgrep', 'read', 'bash'],
  task: 'Explain the session store',
  images: [],
  ownerSessionId: 'owner-id',
  agentName: 'research',
  sessionName: 'shub-agent/research: Explain the session store',
  systemPrompt: 'PROMPT',
  model: 'openrouter/z-ai/glm-5.3-flash',
  thinking: 'off',
}

test('child arguments persist a named session and load only the given extensions', () => {
  const args = shubChildArguments(baseOptions)

  ok(!args.includes('--no-session'), 'the child must persist its session')
  ok(args.includes('--no-extensions'), 'global extensions must not load into the child')
  ok(args.includes('--no-context-files'), 'context files are opt-in per profile')
  deepEqual(args.slice(args.indexOf('--name'), args.indexOf('--name') + 2), [
    '--name',
    'shub-agent/research: Explain the session store',
  ])
  deepEqual(args.filter((_value, index) => args[index - 1] === '--extension'), [
    '/ext/fff.ts',
    '/ext/budget-guard.ts',
  ])
  equal(args[args.indexOf('--tools') + 1], 'fffind,ffgrep,read,bash')
  deepEqual(args.slice(args.indexOf('--print')), ['--print', 'Explain the session store'])
})

test('projectContext opts the child back into context files and host args are kept', () => {
  const args = shubChildArguments({
    ...baseOptions,
    projectContext: true,
    providerArgs: ['--fff-mode', 'tools-only'],
  })

  ok(!args.includes('--no-context-files'))
  deepEqual(args.slice(args.indexOf('--fff-mode'), args.indexOf('--fff-mode') + 2), [
    '--fff-mode',
    'tools-only',
  ])
})

test('images are passed as @path arguments before the task', () => {
  const args = shubChildArguments({
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
  const args = shubChildArguments({ ...baseOptions, model: '' })

  ok(!args.includes('--model'))
})

test('the event stream yields the session id, counters, usage, and the answer', () => {
  const stream = createShubStream()

  equal(
    applyShubEvent(stream, JSON.stringify({ type: 'session', version: 3, id: 'abc-123' })),
    'session',
  )
  equal(applyShubEvent(stream, JSON.stringify({ type: 'turn_start' })), 'turn')
  equal(
    applyShubEvent(
      stream,
      JSON.stringify({ type: 'tool_execution_start', toolName: 'ffgrep', args: {} }),
    ),
    'tool',
  )
  applyShubEvent(
    stream,
    JSON.stringify({
      type: 'tool_execution_end',
      toolName: 'ffgrep',
      result: { content: [{ type: 'text', text: 'server/pi-session-store.ts:50' }] },
    }),
  )
  equal(
    applyShubEvent(
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

test('usage sums completed turns without counting cumulative streaming updates twice', () => {
  const stream = createShubStream()
  for (const totalTokens of [673, 2000]) {
    const usage = { totalTokens, cost: { total: 0.125 } }
    applyShubEvent(stream, JSON.stringify({ type: 'message_update', usage }))
    applyShubEvent(
      stream,
      JSON.stringify({
        type: 'message_end',
        message: { role: 'assistant', content: [], usage },
      }),
    )
  }
  equal(stream.totalTokens, 2673)
  equal(stream.costUsd, 0.25)
})

test('accumulated assistant output stays bounded', () => {
  const stream = createShubStream()
  for (let index = 0; index < 30; index++) {
    applyShubEvent(
      stream,
      JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'x'.repeat(10_000) }],
        },
      }),
    )
  }
  ok(stream.output.length <= 100_000, 'output must be tail-capped')
  ok(stream.output.endsWith('x'), 'the tail (the final report) is preserved')
})

test('an already cancelled call never attempts to spawn a child', async () => {
  await rejects(
    runShubChild({
      ...baseOptions,
      piExecutable: '/nonexistent-pi-shub-agent',
      cwd: process.cwd(),
      effort: 'quick',
      softToolCalls: 6,
      hardToolCalls: 8,
      timeoutMs: 1000,
      maxOutputChars: 1000,
      signal: AbortSignal.abort(),
    }),
    /cancelled/,
  )
})

test('malformed and unrelated lines are ignored', () => {
  const stream = createShubStream()

  equal(applyShubEvent(stream, 'not json'), undefined)
  equal(applyShubEvent(stream, ''), undefined)
  equal(applyShubEvent(stream, JSON.stringify({ type: 'agent_start' })), undefined)
  equal(stream.turnCount, 0)
})

test('progress reports the agent, tool budget, and soft-target warning', () => {
  const stream = createShubStream()
  stream.turnCount = 1
  const budget = { agentName: 'research', effort: 'standard', softToolCalls: 12, hardToolCalls: 16 }

  equal(progressText(stream, budget), 'research [standard]: turn 1...')

  stream.toolCount = 12
  stream.lastTool = 'read'
  ok(progressText(stream, budget).includes('research [standard]: read (12/12 target, 16 max)'))
  ok(progressText(stream, budget).includes('Target reached'))
})
