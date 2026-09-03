import assert from 'node:assert/strict'
import test from 'node:test'
import {
  latestResponseControlsState,
  parseResponseControlsArgs,
  responseControlsReport,
  supportsResponseControls,
} from '../shared/response-controls.ts'

function model(overrides: Record<string, unknown> = {}) {
  return { id: 'gpt-5.6-sol', provider: 'openai', api: 'openai-responses', ...overrides }
}

test('gates response controls to Responses APIs on direct OpenAI providers', () => {
  assert.equal(supportsResponseControls(model()), true)
  assert.equal(
    supportsResponseControls(model({ provider: 'openai-codex', api: 'openai-codex-responses' })),
    true,
  )
  assert.equal(
    supportsResponseControls(
      model({ provider: 'azure-openai-responses', api: 'azure-openai-responses' }),
    ),
    true,
  )
  assert.equal(supportsResponseControls(model({ provider: 'openrouter' })), false)
  assert.equal(supportsResponseControls(model({ api: 'openai-completions' })), false)
  assert.equal(supportsResponseControls(model({ id: 'gpt-4o' })), false)
  assert.equal(supportsResponseControls(undefined), false)
  assert.equal(supportsResponseControls('gpt-5.6-sol'), false)
})

test('reads the newest state entry on the active branch only', () => {
  const entries = [
    {
      type: 'custom',
      id: 'a',
      parentId: null,
      customType: 'pi-livecraft.response-controls',
      data: { verbosity: 'low' },
    },
    { type: 'message', id: 'b', parentId: 'a', message: { role: 'user', content: 'Hi' } },
    {
      type: 'custom',
      id: 'c',
      parentId: 'b',
      customType: 'pi-livecraft.response-controls',
      data: { summary: 'concise', verbosity: 'ultra' },
    },
    {
      type: 'custom',
      id: 'abandoned',
      parentId: 'b',
      customType: 'pi-livecraft.response-controls',
      data: { verbosity: 'high' },
    },
    { type: 'message', id: 'd', parentId: 'c', message: { role: 'assistant', content: [] } },
  ]

  assert.deepEqual(latestResponseControlsState(entries, 'd'), { summary: 'concise' })
  assert.deepEqual(latestResponseControlsState(entries, 'b'), { verbosity: 'low' })
  assert.deepEqual(latestResponseControlsState(entries, 'abandoned'), { verbosity: 'high' })
  assert.deepEqual(latestResponseControlsState(entries, undefined), {})
  assert.deepEqual(latestResponseControlsState([], 'd'), {})
})

test('drops unknown fields and values from state entries', () => {
  const entries = [
    {
      type: 'custom',
      id: 'a',
      parentId: null,
      customType: 'pi-livecraft.response-controls',
      data: { verbosity: 'loud', summary: 'auto', temperature: 0 },
    },
  ]
  assert.deepEqual(latestResponseControlsState(entries, 'a'), { summary: 'auto' })

  const malformed = [{
    type: 'custom',
    id: 'a',
    parentId: null,
    customType: 'pi-livecraft.response-controls',
  }]
  assert.deepEqual(latestResponseControlsState(malformed, 'a'), {})
})

test('reports support only when the extension is registered and the model qualifies', () => {
  const entries = [
    {
      type: 'custom',
      id: 'a',
      parentId: null,
      customType: 'pi-livecraft.response-controls',
      data: { verbosity: 'low' },
    },
  ]
  assert.deepEqual(responseControlsReport(entries, 'a', model(), true), {
    supported: true,
    verbosity: 'low',
  })
  assert.deepEqual(responseControlsReport(entries, 'a', model(), false), { supported: false })
  assert.deepEqual(responseControlsReport(entries, 'a', model({ provider: 'openrouter' }), true), {
    supported: false,
  })
})

test('parses command arguments and reports unknown input', () => {
  assert.deepEqual(parseResponseControlsArgs(''), {})
  assert.deepEqual(parseResponseControlsArgs('verbosity low'), { verbosity: 'low' })
  assert.deepEqual(parseResponseControlsArgs('verbosity default'), { verbosity: 'default' })
  assert.deepEqual(parseResponseControlsArgs('  summary   concise '), { summary: 'concise' })
  assert.deepEqual(parseResponseControlsArgs('summary default'), { summary: 'default' })
  assert.deepEqual(parseResponseControlsArgs('verbosity loud'), { invalid: 'verbosity loud' })
  assert.deepEqual(parseResponseControlsArgs('temperature 0'), { invalid: 'temperature' })
  assert.deepEqual(parseResponseControlsArgs('verbosity'), { invalid: 'verbosity' })
})
