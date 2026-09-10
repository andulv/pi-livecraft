import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  PiSettingsError,
  readPiSettings,
  savePiSettingsDocument,
  updatePiSetting,
} from '../server/features/pi-settings/pi-settings.ts'
import { readSettingPath } from '../shared/pi-settings.ts'

/** Runs one test body against a temporary Pi agent directory and workspace. */
async function withDirectories(
  body: (agentDirectory: string, workspace: string) => Promise<void>,
): Promise<void> {
  const agentDirectory = await mkdtemp(join(tmpdir(), 'livecraft-pi-settings-agent-'))
  const workspace = await mkdtemp(join(tmpdir(), 'livecraft-pi-settings-project-'))
  const previous = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = agentDirectory
  try {
    await body(agentDirectory, workspace)
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previous
  }
}

/** Reads and parses the global settings file. */
async function readGlobal(agentDirectory: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(agentDirectory, 'settings.json'), 'utf8'))
}

test('reports an empty global scope and an unavailable project scope without a workspace', async () => {
  await withDirectories(async (agentDirectory) => {
    const snapshot = await readPiSettings()
    assert.equal(snapshot.projectAvailable, false)
    const globalScope = snapshot.scopes.find((scope) => scope.scope === 'global')
    assert.equal(globalScope?.exists, false)
    assert.equal(globalScope?.path, join(agentDirectory, 'settings.json'))
    assert.ok(snapshot.fields.length > 0)
  })
})

test('reports project scope availability and both parsed documents', async () => {
  await withDirectories(async (agentDirectory, workspace) => {
    await writeFile(
      join(agentDirectory, 'settings.json'),
      JSON.stringify({ defaultModel: 'gpt-5', theme: 'dark' }),
      'utf8',
    )
    const snapshot = await readPiSettings(workspace)
    assert.equal(snapshot.projectAvailable, true)
    const globalScope = snapshot.scopes.find((scope) => scope.scope === 'global')
    assert.equal(globalScope?.values.defaultModel, 'gpt-5')
  })
})

test('stores a curated field in the global scope', async () => {
  await withDirectories(async (agentDirectory) => {
    await updatePiSetting('global', undefined, 'defaultModel', 'gpt-5.6-terra')
    assert.equal((await readGlobal(agentDirectory)).defaultModel, 'gpt-5.6-terra')
  })
})

test('sets and prunes a nested dotted key path', async () => {
  await withDirectories(async (agentDirectory) => {
    await updatePiSetting('global', undefined, 'compaction.reserveTokens', 8192)
    let document = await readGlobal(agentDirectory)
    assert.equal(readSettingPath(document, 'compaction.reserveTokens'), 8192)

    await updatePiSetting('global', undefined, 'compaction.reserveTokens', null)
    document = await readGlobal(agentDirectory)
    // Clearing the only nested key prunes the now-empty parent object.
    assert.equal('compaction' in document, false)
  })
})

test('preserves keys the field registry does not model', async () => {
  await withDirectories(async (agentDirectory) => {
    await writeFile(
      join(agentDirectory, 'settings.json'),
      JSON.stringify({ packages: ['pi-skills'], defaultModel: 'gpt-5' }),
      'utf8',
    )
    await updatePiSetting('global', undefined, 'theme', 'light')
    const document = await readGlobal(agentDirectory)
    assert.deepEqual(document.packages, ['pi-skills'])
    assert.equal(document.theme, 'light')
  })
})

test('coerces a comma-separated string into a string array', async () => {
  await withDirectories(async (agentDirectory) => {
    await updatePiSetting('global', undefined, 'enabledModels', 'claude-*, gpt-4o')
    assert.deepEqual((await readGlobal(agentDirectory)).enabledModels, ['claude-*', 'gpt-4o'])
  })
})

test('rejects a globalOnly field in the project scope', async () => {
  await withDirectories(async (_agentDirectory, workspace) => {
    await assert.rejects(
      () => updatePiSetting('project', workspace, 'defaultProjectTrust', 'always'),
      PiSettingsError,
    )
  })
})

test('rejects an unknown field and an out-of-range number', async () => {
  await withDirectories(async () => {
    await assert.rejects(() => updatePiSetting('global', undefined, 'nope', 'x'), PiSettingsError)
    await assert.rejects(
      () => updatePiSetting('global', undefined, 'compaction.reserveTokens', -1),
      PiSettingsError,
    )
  })
})

test('reads invalid JSON on disk as a loud error', async () => {
  await withDirectories(async (agentDirectory) => {
    await writeFile(join(agentDirectory, 'settings.json'), '{ not json', 'utf8')
    await assert.rejects(() => readPiSettings(), PiSettingsError)
  })
})

test('saves a raw document verbatim and rejects invalid JSON', async () => {
  await withDirectories(async (agentDirectory) => {
    await savePiSettingsDocument(
      'global',
      undefined,
      '{\n  "defaultModel": "gpt-5",\n  "extra": 1\n}',
    )
    const document = await readGlobal(agentDirectory)
    assert.equal(document.defaultModel, 'gpt-5')
    assert.equal(document.extra, 1)

    await assert.rejects(
      () => savePiSettingsDocument('global', undefined, '{ "a": }'),
      PiSettingsError,
    )
    // The failed save left the previous document intact.
    assert.equal((await readGlobal(agentDirectory)).defaultModel, 'gpt-5')
  })
})

test('writes atomically, leaving no temporary files behind', async () => {
  await withDirectories(async (agentDirectory) => {
    await updatePiSetting('global', undefined, 'defaultModel', 'gpt-5')
    const entries = await readdir(agentDirectory)
    assert.deepEqual(entries, ['settings.json'])
  })
})
