import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampFilePaneShare,
  defaultFilePaneShare,
  maxFilePaneShare,
  minFilePaneShare,
  readFilePaneShare,
} from '../src/features/files/file-pane-width.ts'

test('bounds and restores the file pane share', () => {
  assert.equal(clampFilePaneShare(0.1), minFilePaneShare)
  assert.equal(clampFilePaneShare(0.9), maxFilePaneShare)
  assert.equal(clampFilePaneShare(0.4264), 0.426)
  assert.equal(readFilePaneShare(null), defaultFilePaneShare)
  assert.equal(readFilePaneShare('invalid'), defaultFilePaneShare)
})
