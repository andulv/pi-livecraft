import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  configureVSCodeWorkspace,
  openVSCodeApplication,
  VSCodeSettingsError,
} from '../server/features/vscode/launcher.ts'

const branding = {
  color: '#3c6fa8',
  projectName: 'Livecraft',
  workspaceName: 'feature/vscode-launcher',
}

test('merges Livecraft branding into JSONC workspace settings and ignores the generated file', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'livecraft-vscode-'))
  await writeFile(
    join(workspace, '.vscode-settings-source'),
    '{\n  // Preserve project settings\n  "editor.tabSize": 2,\n  "workbench.colorCustomizations": {\n    "editor.background": "#101010",\n  },\n}\n',
  )
  await mkdir(join(workspace, '.vscode'))
  await rename(
    join(workspace, '.vscode-settings-source'),
    join(workspace, '.vscode', 'settings.json'),
  )

  await configureVSCodeWorkspace(workspace, branding)

  const settings = JSON.parse(await readFile(join(workspace, '.vscode', 'settings.json'), 'utf8'))
  assert.equal(settings['editor.tabSize'], 2)
  assert.equal(
    settings['window.title'],
    'Livecraft · feature/vscode-launcher${separator}${dirty}${activeEditorShort}${separator}${appName}',
  )
  assert.equal(settings['window.border'], '#3c6fa8')
  assert.deepEqual(settings['workbench.colorCustomizations'], {
    'editor.background': '#101010',
    'titleBar.activeBackground': '#3c6fa8',
    'titleBar.inactiveBackground': '#3c6fa899',
    'titleBar.border': '#3c6fa8',
    'window.activeBorder': '#3c6fa8',
    'window.inactiveBorder': '#3c6fa899',
  })
  assert.match(await readFile(join(workspace, '.gitignore'), 'utf8'), /^\.vscode\/settings\.json$/m)
})

test('rejects invalid JSONC without overwriting workspace settings', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'livecraft-vscode-'))
  await mkdir(join(workspace, '.vscode'))
  const settingsPath = join(workspace, '.vscode', 'settings.json')
  await writeFile(settingsPath, '{ invalid }')

  await assert.rejects(
    () => configureVSCodeWorkspace(workspace, branding),
    VSCodeSettingsError,
  )
  assert.equal(await readFile(settingsPath, 'utf8'), '{ invalid }')
})

test('launches a new VS Code window after configuring the worktree', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'livecraft-vscode-'))
  let call: { command: string; args: string[]; shell?: string | boolean } | undefined
  await openVSCodeApplication(
    workspace,
    branding,
    ((
      command: string,
      args: string[],
      options: Parameters<typeof spawn>[2],
    ) => {
      call = { command, args, shell: options?.shell }
      const child = new EventEmitter() as EventEmitter & { unref: () => void }
      child.unref = () => undefined
      queueMicrotask(() => child.emit('spawn'))
      return child as never
    }) as never,
  )
  assert.deepEqual(call, { command: 'code', args: ['--new-window', workspace], shell: false })
})
