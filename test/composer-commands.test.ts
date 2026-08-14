import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ensureLocalCommands,
  isCommandDraft,
  isCompactCommandDraft,
  isNameCommandDraft,
  nameCommandArgument,
} from '../src/features/composer/composer-utils.ts'

test('detects only slash commands exposed by Pi', () => {
  const commands = [{ name: 'agent' }, { name: 'session-name' }]
  assert.equal(isCommandDraft('/agent frontend', commands), true)
  assert.equal(isCommandDraft('  /SESSION-NAME demo', commands), true)
  assert.equal(isCommandDraft('/unknown', commands), false)
  assert.equal(isCommandDraft('agent', commands), false)
})

test('detects /compact with no arguments', () => {
  assert.equal(isCompactCommandDraft('/compact'), true)
  assert.equal(isCompactCommandDraft('  /compact  '), true)
})

test('rejects /compact with trailing arguments', () => {
  assert.equal(isCompactCommandDraft('/compact foo'), false)
  assert.equal(isCompactCommandDraft('/compact '), true) // selectSlashCommand appends a space
})

test('rejects unrelated input', () => {
  assert.equal(isCompactCommandDraft(''), false)
  assert.equal(isCompactCommandDraft('/agent'), false)
  assert.equal(isCompactCommandDraft('compact'), false)
})

test('detects /name with or without an argument', () => {
  assert.equal(isNameCommandDraft('/name'), true)
  assert.equal(isNameCommandDraft('/NAME feature work'), true)
  assert.equal(isNameCommandDraft('  /name feature work  '), true)
  assert.equal(isNameCommandDraft('/namespace'), false)
  assert.equal(isNameCommandDraft('name feature work'), false)
  assert.equal(isNameCommandDraft(''), false)
})

test('extracts the /name argument', () => {
  assert.equal(nameCommandArgument('/name Feature work'), 'Feature work')
  assert.equal(nameCommandArgument('  /name   spaced   name  '), 'spaced   name')
  assert.equal(nameCommandArgument('/name'), '')
})

test('prepends local commands when absent', () => {
  const result = ensureLocalCommands([{ name: 'agent' }])
  assert.deepEqual(result.map((command) => command.name), ['compact', 'name', 'agent'])
})

test('does not duplicate local commands Pi already exposes', () => {
  const result = ensureLocalCommands([{ name: 'compact' }, { name: 'name' }, { name: 'agent' }])
  assert.deepEqual(result.map((command) => command.name), ['compact', 'name', 'agent'])
})

test('handles empty command list', () => {
  const result = ensureLocalCommands([])
  assert.deepEqual(result.map((command) => command.name), ['compact', 'name'])
})
