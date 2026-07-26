import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTerminalTemplate, tokenizeTemplate, TerminalTemplateError } from '../server/features/terminal/launcher.ts'

test('tokenizes a simple command', () => {
  assert.deepEqual(tokenizeTemplate('wt.exe -d {cwd}'), ['wt.exe', '-d', '{cwd}'])
})

test('strips double quotes around a token', () => {
  assert.deepEqual(tokenizeTemplate('cmd "arg with spaces"'), ['cmd', 'arg with spaces'])
})

test('handles backslash escapes', () => {
  assert.deepEqual(tokenizeTemplate('cmd arg\\ with\\ spaces'), ['cmd', 'arg with spaces'])
})

test('collapses multiple spaces outside quotes', () => {
  assert.deepEqual(tokenizeTemplate('cmd   -d    {cwd}'), ['cmd', '-d', '{cwd}'])
})

test('replaces {cwd} with the workspace path', () => {
  const result = parseTerminalTemplate('wt.exe -d {cwd}', '/home/user')
  assert.deepEqual(result, { command: 'wt.exe', args: ['-d', '/home/user'] })
})

test('replaces {cwd} inside a longer token', () => {
  const result = parseTerminalTemplate('cmd --path={cwd}/src', '/home/user')
  assert.deepEqual(result, { command: 'cmd', args: ['--path=/home/user/src'] })
})

test('replaces {cwd} inside a quoted token', () => {
  const result = parseTerminalTemplate('wezterm start --cwd "{cwd}"', '/home/user')
  assert.deepEqual(result, { command: 'wezterm', args: ['start', '--cwd', '/home/user'] })
})

test('replaces multiple {cwd} occurrences', () => {
  const result = parseTerminalTemplate('cmd {cwd} {cwd}/out', '/tmp')
  assert.deepEqual(result, { command: 'cmd', args: ['/tmp', '/tmp/out'] })
})

test('rejects a template without {cwd}', () => {
  assert.throws(() => parseTerminalTemplate('wt.exe -d .', '/home/user'), TerminalTemplateError)
})

test('rejects an empty template', () => {
  assert.throws(() => parseTerminalTemplate('', '/home/user'), TerminalTemplateError)
})

test('rejects a whitespace-only template', () => {
  assert.throws(() => parseTerminalTemplate('   ', '/home/user'), TerminalTemplateError)
})

test('rejects unclosed double quotes', () => {
  assert.throws(() => tokenizeTemplate('cmd "unclosed'), TerminalTemplateError)
})

test('rejects a template exceeding the length limit', () => {
  const long = `wt.exe -d {cwd} ${'x'.repeat(2000)}`
  assert.throws(() => parseTerminalTemplate(long, '/home/user'), TerminalTemplateError)
})

test('rejects a template with NUL characters', () => {
  assert.throws(() => parseTerminalTemplate('wt.exe\0 -d {cwd}', '/home/user'), TerminalTemplateError)
})
