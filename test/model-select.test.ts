import assert from 'node:assert/strict'
import test from 'node:test'
import {
  baseModelKey,
  buildListPriceIndex,
  groupModelOptions,
  modelCostLabel,
  providerDisplayName,
  toModelOption,
  type ModelOption,
} from '../src/features/composer/selects/model-select-utils.ts'
import {
  readPinnedModels,
  writePinnedModels,
} from '../src/features/composer/selects/model-favorites.ts'

test('providerDisplayName maps known providers and title-cases the rest', () => {
  assert.equal(providerDisplayName('openai-codex'), 'OpenAI Codex')
  assert.equal(providerDisplayName('zai'), 'Z.AI')
  assert.equal(providerDisplayName('github-copilot'), 'GitHub Copilot')
  assert.equal(providerDisplayName('custom-foo'), 'Custom Foo')
  assert.equal(providerDisplayName('new.provider'), 'New Provider')
})

test('toModelOption flags all-zero cost as subscription and falls back to id for name', () => {
  assert.deepEqual(
    toModelOption({
      id: 'glm-5.2',
      name: 'GLM-5.2',
      provider: 'zai',
      cost: { input: 0, output: 0 },
    }),
    {
      key: 'zai/glm-5.2',
      id: 'glm-5.2',
      provider: 'zai',
      name: 'GLM-5.2',
      cost: { input: 0, output: 0 },
      subscription: true,
    },
  )
  assert.equal(
    toModelOption({
      id: 'claude',
      name: 'Claude',
      provider: 'anthropic',
      cost: { input: 3, output: 15 },
    })
      ?.subscription,
    false,
  )
  // Missing name falls back to id; missing cost leaves cost null and not a subscription.
  assert.equal(toModelOption({ id: 'x', provider: 'openai' })?.name, 'x')
  assert.equal(toModelOption({ id: 'x', provider: 'openai' })?.subscription, false)
  // Entries without an id or provider are dropped.
  assert.equal(toModelOption({ name: 'nope' }), undefined)
})

test('modelCostLabel renders paid, plan-covered, subscription, or nothing', () => {
  assert.deepEqual(
    modelCostLabel({
      key: 'a',
      id: 'a',
      provider: 'p',
      name: 'A',
      cost: { input: 3, output: 15 },
      subscription: false,
    }),
    { kind: 'paid', text: '$3.00 in · $15.00 out' },
  )
  // A subscription provider with real list prices marks its per-token price as plan-covered.
  assert.deepEqual(
    modelCostLabel({
      key: 'o/gpt-5.2',
      id: 'gpt-5.2',
      provider: 'openai-codex',
      name: 'GPT-5.2',
      cost: { input: 1.25, output: 10 },
      subscription: false,
    }),
    { kind: 'covered', text: '$1.25 in · $10.00 out' },
  )
  assert.deepEqual(
    modelCostLabel({
      key: 'b',
      id: 'b',
      provider: 'p',
      name: 'B',
      cost: { input: 0, output: 0 },
      subscription: true,
    }),
    { kind: 'subscription' },
  )
  assert.equal(
    modelCostLabel({
      key: 'c',
      id: 'c',
      provider: 'p',
      name: 'C',
      cost: null,
      subscription: false,
    }),
    null,
  )
})

test('subscription models reuse a priced sibling provider as their struck-through list price', () => {
  const glm = (id: string): ModelOption =>
    toModelOption({ id, name: id, provider: 'zai', cost: { input: 0, output: 0 } })!
  const fireworks = toModelOption({
    id: 'accounts/fireworks/models/glm-5p2',
    name: 'GLM-5.2',
    provider: 'fireworks',
    cost: { input: 1.4, output: 4.4 },
  })!

  assert.equal(baseModelKey('accounts/fireworks/models/glm-5p2'), 'glm-5.2')
  const index = buildListPriceIndex([glm('glm-5.2'), glm('glm-5.3'), fireworks])
  // The sibling's price becomes the covered list price; models without one stay plain.
  assert.deepEqual(modelCostLabel(glm('glm-5.2'), index), {
    kind: 'covered',
    text: '$1.40 in · $4.40 out',
  })
  assert.deepEqual(modelCostLabel(glm('glm-5.3'), index), { kind: 'subscription' })
})

test('groupModelOptions puts pinned favorites first and drops them from provider groups', () => {
  const models = [
    toModelOption({
      id: 'claude',
      name: 'Claude',
      provider: 'anthropic',
      cost: { input: 3, output: 15 },
    })!,
    toModelOption({
      id: 'glm-5.2',
      name: 'GLM-5.2',
      provider: 'zai',
      cost: { input: 0, output: 0 },
    })!,
    toModelOption({
      id: 'sonnet',
      name: 'Sonnet',
      provider: 'anthropic',
      cost: { input: 3, output: 15 },
    })!,
  ]
  const pinned = new Set(['zai/glm-5.2'])

  assert.deepEqual(
    groupModelOptions(models, pinned).map((group) => ({
      label: group.label,
      models: group.models.map((model) => model.key),
    })),
    [
      { label: 'Favorites', models: ['zai/glm-5.2'] },
      { label: 'Anthropic', models: ['anthropic/claude', 'anthropic/sonnet'] },
    ],
  )
})

test('favorites keep pin order and ignore keys for unavailable models', () => {
  const models = [
    toModelOption({ id: 'a', provider: 'anthropic' })!,
    toModelOption({ id: 'b', provider: 'openai' })!,
  ]
  const pinned = new Set(['openai/b', 'anthropic/a', 'anthropic/missing'])
  const [favorites, ...rest] = groupModelOptions(models, pinned)
  assert.equal(favorites.label, 'Favorites')
  assert.deepEqual(favorites.models.map((model) => model.key), ['openai/b', 'anthropic/a'])
  // The stale pin left no empty provider group behind.
  assert.equal(rest.length, 0)
})

test('readPinnedModels tolerates missing, malformed, and non-string entries', () => {
  assert.deepEqual(readPinnedModels(mockStorage()), [])
  assert.deepEqual(readPinnedModels(mockStorage('not json')), [])
  assert.deepEqual(readPinnedModels(mockStorage('{"a":1}')), [])
  assert.deepEqual(readPinnedModels(mockStorage('[1, "zai/glm", "zai/glm", ""]')), ['zai/glm'])
})

test('writePinnedModels round-trips through readPinnedModels', () => {
  const storage = mockStorage()
  writePinnedModels(['anthropic/claude', 'zai/glm-5.2'], storage)
  assert.deepEqual(readPinnedModels(storage), ['anthropic/claude', 'zai/glm-5.2'])
})

test('writePinnedModels swallows storage failures', () => {
  const failing = {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota')
    },
  } as unknown as Storage
  writePinnedModels(['a/b'], failing) // must not throw
  assert.deepEqual(readPinnedModels(failing), [])
})

function mockStorage(initial = ''): Storage {
  let value = initial
  return {
    get length() {
      return value ? 1 : 0
    },
    clear() {
      value = ''
    },
    getItem: () => value,
    key: () => null,
    removeItem() {
      value = ''
    },
    setItem: (_key: string, next: string) => {
      value = next
    },
  } as Storage
}
