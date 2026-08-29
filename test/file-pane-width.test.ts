import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampFilePaneWidth,
  defaultFilePaneWidth,
  maxFilePaneWidth,
  minFilePaneWidth,
  readFilePaneWidth,
} from '../src/features/files/file-pane-width.ts'

test('bounds and restores the file pane width', () => {
  assert.equal(clampFilePaneWidth(100), minFilePaneWidth)
  assert.equal(clampFilePaneWidth(9999), maxFilePaneWidth)
  assert.equal(clampFilePaneWidth(320.6), 321)
  assert.equal(readFilePaneWidth(null), defaultFilePaneWidth)
  assert.equal(readFilePaneWidth('invalid'), defaultFilePaneWidth)
})
