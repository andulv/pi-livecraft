import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cwdFromOsc3008,
  cwdFromOsc7,
  cwdFromTerminalTitle,
} from '../src/features/terminal/terminal-cwd.ts'
import { terminalKeyAction, type TerminalKeyInput } from '../src/features/terminal/terminal-key.ts'

test('terminal Ctrl+C interrupts unless copy semantics take precedence', () => {
  const key = (overrides: Partial<TerminalKeyInput> = {}): TerminalKeyInput => ({
    altKey: false,
    ctrlKey: false,
    key: 'c',
    metaKey: false,
    shiftKey: false,
    ...overrides,
  })

  assert.equal(terminalKeyAction(key({ ctrlKey: true }), false), 'interrupt')
  assert.equal(terminalKeyAction(key({ ctrlKey: true }), true), 'copy')
  assert.equal(terminalKeyAction(key({ ctrlKey: true, shiftKey: true }), false), 'copy')
  assert.equal(terminalKeyAction(key({ metaKey: true }), false), 'copy')
  assert.equal(terminalKeyAction(key({ altKey: true, ctrlKey: true }), false), 'passthrough')
  assert.equal(terminalKeyAction(key({ ctrlKey: true, key: 'x' }), false), 'passthrough')
})

test('terminal metadata resolves only path-like working directories', () => {
  assert.equal(cwdFromOsc7('file://workstation/home/anders/my%20repo'), '/home/anders/my repo')
  assert.equal(cwdFromOsc7('https://example.test/repo'), null)
  assert.equal(cwdFromOsc3008('start=id;type=shell;cwd=%2Ftmp%2Fdemo'), '/tmp/demo')
  assert.equal(cwdFromOsc3008('start=id;type=command'), null)
  assert.equal(cwdFromTerminalTitle('/home/anders/repo'), '/home/anders/repo')
  assert.equal(cwdFromTerminalTitle('anders@host:/home/anders/repo'), '/home/anders/repo')
  assert.equal(cwdFromTerminalTitle('vim: README.md'), null)
})

test('output messages are validated from the terminal socket', async () => {
  const { parseTerminalOutputMessage } = await import('../src/api.ts')
  const b64 = Buffer.from('hello world').toString('base64')
  assert.deepEqual(parseTerminalOutputMessage({ type: 'output', id: 41, data: b64 }), {
    id: 41,
    data: b64,
  })
  // The regression: the raw JSON reached atob instead of the extracted field.
  assert.deepEqual(parseTerminalOutputMessage({ type: 'output', id: 7, data: 'x' }), {
    id: 7,
    data: 'x',
  })
  assert.equal(parseTerminalOutputMessage({ type: 'output', data: 'x' }), null)
  assert.equal(parseTerminalOutputMessage({ type: 'output', id: -1, data: 'x' }), null)
  assert.equal(parseTerminalOutputMessage({ type: 'status', state: 'live' }), null)
  assert.equal(parseTerminalOutputMessage('{broken'), null)
  assert.equal(parseTerminalOutputMessage(null), null)
})
