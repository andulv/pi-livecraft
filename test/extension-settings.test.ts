import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ExtensionSettingsError,
  readExtensionSettings,
  updateExtensionSetting,
} from '../server/features/extension-settings/extension-settings.ts'

/** Writes the document an extension would publish on session start. */
async function publish(agentDirectory: string, document: unknown): Promise<string> {
  const path = join(agentDirectory, 'extension-settings.json')
  await writeFile(path, JSON.stringify(document, null, 2), 'utf8')
  return path
}

const publishedDocument = {
  definitions: {
    'repo-explore-ff': {
      description: 'Bounded nested Pi run.',
      settings: [
        { id: 'model', label: 'Exploration model', type: 'string', env: 'TEST_EXPLORE_MODEL' },
        {
          id: 'effort',
          label: 'Default effort',
          type: 'enum',
          options: ['quick', 'standard', 'deep'],
          defaultValue: 'standard',
        },
        {
          id: 'timeoutMs',
          label: 'Timeout override (ms)',
          type: 'number',
          minimum: 1000,
          advanced: true,
        },
      ],
    },
    'image-analysis': {
      settings: [
        { id: 'model', label: 'Vision model', type: 'string' },
        { id: 'followSymlinks', label: 'Follow symlinks', type: 'boolean', defaultValue: true },
      ],
    },
  },
  values: { 'image-analysis': { model: 'accounts/fireworks/models/qwen3p7-plus' } },
}

/** Runs one test body against a temporary Pi agent directory. */
async function withAgentDirectory(
  body: (agentDirectory: string) => Promise<void>,
): Promise<void> {
  const agentDirectory = await mkdtemp(join(tmpdir(), 'livecraft-extension-settings-'))
  const previous = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = agentDirectory
  try {
    await body(agentDirectory)
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previous
  }
}

test('reports an empty snapshot before any extension publishes settings', async () => {
  await withAgentDirectory(async (agentDirectory) => {
    const snapshot = await readExtensionSettings()
    assert.deepEqual(snapshot.groups, [])
    assert.deepEqual(snapshot.values, {})
    assert.equal(snapshot.path, join(agentDirectory, 'extension-settings.json'))
  })
})

test('reports published groups sorted by name with stored values', async () => {
  await withAgentDirectory(async () => {
    await publish(process.env.PI_CODING_AGENT_DIR!, publishedDocument)
    const snapshot = await readExtensionSettings()
    assert.deepEqual(snapshot.groups.map((group) => group.name), [
      'image-analysis',
      'repo-explore-ff',
    ])
    assert.equal(snapshot.groups[1].description, 'Bounded nested Pi run.')
    assert.deepEqual(
      snapshot.groups[1].settings.map((setting) => setting.id),
      ['model', 'effort', 'timeoutMs'],
    )
    assert.equal(snapshot.values['image-analysis'].model, 'accounts/fireworks/models/qwen3p7-plus')
    assert.deepEqual(snapshot.overrides, [])
  })
})

test('reports an environment variable that overrides a stored value', async () => {
  await withAgentDirectory(async () => {
    await publish(process.env.PI_CODING_AGENT_DIR!, publishedDocument)
    process.env.TEST_EXPLORE_MODEL = 'env/model'
    try {
      const snapshot = await readExtensionSettings()
      assert.deepEqual(snapshot.overrides, [
        { extension: 'repo-explore-ff', id: 'model', env: 'TEST_EXPLORE_MODEL' },
      ])
    } finally {
      delete process.env.TEST_EXPLORE_MODEL
    }
  })
})

test('stores a coerced value and keeps unrelated settings intact', async () => {
  await withAgentDirectory(async (agentDirectory) => {
    await publish(agentDirectory, publishedDocument)
    const snapshot = await updateExtensionSetting('repo-explore-ff', 'timeoutMs', '90000')
    assert.equal(snapshot.values['repo-explore-ff'].timeoutMs, 90_000)
    assert.equal(snapshot.values['image-analysis'].model, 'accounts/fireworks/models/qwen3p7-plus')

    const stored = JSON.parse(
      await readFile(join(agentDirectory, 'extension-settings.json'), 'utf8'),
    )
    assert.equal(stored.definitions['repo-explore-ff'].settings.length, 3)
    assert.equal(stored.values['repo-explore-ff'].timeoutMs, 90_000)
    assert.deepEqual(await readdir(agentDirectory), ['extension-settings.json'])
  })
})

test('stores enum and boolean values', async () => {
  await withAgentDirectory(async (agentDirectory) => {
    await publish(agentDirectory, publishedDocument)
    assert.equal(
      (await updateExtensionSetting('repo-explore-ff', 'effort', 'deep'))
        .values[
          'repo-explore-ff'
        ]
        .effort,
      'deep',
    )
    assert.equal(
      (await updateExtensionSetting('image-analysis', 'followSymlinks', false))
        .values[
          'image-analysis'
        ]
        .followSymlinks,
      false,
    )
  })
})

test('clears a stored value so the extension default applies again', async () => {
  await withAgentDirectory(async (agentDirectory) => {
    await publish(agentDirectory, publishedDocument)
    await updateExtensionSetting('repo-explore-ff', 'effort', 'deep')
    const cleared = await updateExtensionSetting('repo-explore-ff', 'effort', null)
    assert.equal(cleared.values['repo-explore-ff'], undefined)

    const emptied = await updateExtensionSetting('image-analysis', 'model', '   ')
    assert.equal(emptied.values['image-analysis'], undefined)

    const stored = JSON.parse(
      await readFile(join(agentDirectory, 'extension-settings.json'), 'utf8'),
    )
    assert.deepEqual(stored.values, {})
    assert.equal(stored.definitions['image-analysis'].settings.length, 2)
  })
})

test('rejects values that contradict the published definition', async () => {
  await withAgentDirectory(async (agentDirectory) => {
    await publish(agentDirectory, publishedDocument)
    await assert.rejects(
      () => updateExtensionSetting('repo-explore-ff', 'effort', 'exhaustive'),
      ExtensionSettingsError,
    )
    await assert.rejects(
      () => updateExtensionSetting('repo-explore-ff', 'timeoutMs', '10'),
      /at least 1000/,
    )
    await assert.rejects(
      () => updateExtensionSetting('repo-explore-ff', 'timeoutMs', 'soon'),
      /must be a number/,
    )
    await assert.rejects(
      () => updateExtensionSetting('image-analysis', 'followSymlinks', 'maybe'),
      /must be true or false/,
    )
    await assert.rejects(
      () => updateExtensionSetting('repo-explore-ff', 'unknown', 'x'),
      /Unknown setting/,
    )
    await assert.rejects(
      () => updateExtensionSetting('not-installed', 'model', 'x'),
      /has not published settings/,
    )
  })
})

test('reports a corrupt document instead of silently discarding configured values', async () => {
  await withAgentDirectory(async (agentDirectory) => {
    const path = await publish(agentDirectory, publishedDocument)
    await writeFile(path, '{ "definitions": broken', 'utf8')
    await assert.rejects(() => readExtensionSettings(), /not valid JSON/)
    await assert.rejects(
      () => updateExtensionSetting('repo-explore-ff', 'effort', 'deep'),
      ExtensionSettingsError,
    )
  })
})

test('ignores unexpected entries but keeps valid ones', async () => {
  await withAgentDirectory(async (agentDirectory) => {
    await publish(agentDirectory, {
      definitions: {
        'image-analysis': {
          settings: [
            { id: 'model', label: 'Vision model', type: 'string' },
            { id: 'broken', label: 'Broken', type: 'colour' },
          ],
        },
      },
      values: { 'image-analysis': { model: 'vision/model', stale: { nested: true } } },
      unexpected: 'ignored',
    })
    const snapshot = await readExtensionSettings()
    assert.deepEqual(snapshot.groups[0].settings.map((setting) => setting.id), ['model'])
    assert.deepEqual(snapshot.values['image-analysis'], { model: 'vision/model' })
  })
})
