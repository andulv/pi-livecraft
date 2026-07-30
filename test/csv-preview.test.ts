import assert from 'node:assert/strict'
import test from 'node:test'
import {
  csvPreviewLimits,
  csvSourcePreview,
  parseCsvPreview,
} from '../src/features/conversation/csv-preview.ts'

test('parses quoted commas, escaped quotes, and multiline fields', () => {
  assert.deepEqual(
    parseCsvPreview('name,note\nAda,"hello, ""world"""\nBob,"line 1\nline 2"'),
    {
      rows: [
        ['name', 'note'],
        ['Ada', 'hello, "world"'],
        ['Bob', 'line 1\nline 2'],
      ],
      truncated: false,
    },
  )
})

test('bounds rows, columns, cells, and scanned input', () => {
  const manyRows = Array.from({ length: csvPreviewLimits.maxRows + 1 }, (_, i) => `row-${i}`)
  const manyColumns = Array.from({ length: csvPreviewLimits.maxColumns + 1 }, () => 'cell').join(
    ',',
  )
  const longCell = 'x'.repeat(csvPreviewLimits.maxCellCharacters + 1)

  assert.equal(parseCsvPreview(manyRows.join('\n')).rows.length, csvPreviewLimits.maxRows)
  assert.equal(parseCsvPreview(manyRows.join('\n')).truncated, true)
  assert.equal(parseCsvPreview(manyColumns).rows[0]?.length, csvPreviewLimits.maxColumns)
  assert.equal(parseCsvPreview(manyColumns).truncated, true)
  assert.equal(
    parseCsvPreview(longCell).rows[0]?.[0],
    `${'x'.repeat(csvPreviewLimits.maxCellCharacters)}…`,
  )
  assert.equal(parseCsvPreview(longCell).truncated, true)
  assert.equal(
    parseCsvPreview('x'.repeat(csvPreviewLimits.maxScanCharacters + 1)).truncated,
    true,
  )
})

test('bounds the expanded source without changing the copied value', () => {
  const content = 'x'.repeat(csvPreviewLimits.maxSourceCharacters + 1)
  const preview = csvSourcePreview(content)

  assert.equal(preview.text.length, csvPreviewLimits.maxSourceCharacters + 1)
  assert.equal(preview.truncated, true)
  assert.equal(preview.text.startsWith('x'.repeat(csvPreviewLimits.maxSourceCharacters)), true)
})
