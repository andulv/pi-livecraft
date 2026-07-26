import assert from 'node:assert/strict'
import test from 'node:test'
import { externalWorkspacePath, getDesktopPlatform } from '../server/system-integration.ts'

test('detects Linux and WSL from the runtime environment', () => {
  assert.equal(getDesktopPlatform('linux', {}), 'linux')
  assert.equal(getDesktopPlatform('linux', { WSL_DISTRO_NAME: 'Ubuntu' }), 'wsl')
  assert.throws(() => getDesktopPlatform('win32', {}), /Unsupported platform: win32/)
})

test('keeps Linux workspace paths unchanged', async () => {
  assert.equal(await externalWorkspacePath('/home/user/project', 'linux'), '/home/user/project')
})

test('converts WSL workspace paths through the injected converter', async () => {
  const converted = await externalWorkspacePath('/home/user/project', 'wsl', async (path) => {
    assert.equal(path, '/home/user/project')
    return '\\\\wsl.localhost\\Ubuntu\\home\\user\\project'
  })
  assert.equal(converted, '\\\\wsl.localhost\\Ubuntu\\home\\user\\project')
})
