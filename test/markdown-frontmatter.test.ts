import assert from 'node:assert/strict'
import test from 'node:test'
import { parseMarkdownFrontmatter } from '../src/features/conversation/markdown-frontmatter.ts'

test('extracts complete YAML front matter for table rendering', () => {
  assert.deepEqual(
    parseMarkdownFrontmatter(`---
title: Guide
draft: false
tags:
  - docs
  - ui
owner:
  team: Livecraft
notes: |
  First line
  Second line
---
# Body
`),
    {
      body: '# Body\n',
      entries: [
        { key: 'title', value: 'Guide' },
        { key: 'draft', value: 'false' },
        { key: 'tags', value: '- docs\n- ui' },
        { key: 'owner', value: 'team: Livecraft' },
        { key: 'notes', value: 'First line\nSecond line\n' },
      ],
    },
  )
})

test('leaves absent, malformed, or non-mapping front matter untouched', () => {
  assert.equal(parseMarkdownFrontmatter('# Body'), null)
  assert.equal(parseMarkdownFrontmatter('---\ninvalid: [\n---\nBody'), null)
  assert.equal(parseMarkdownFrontmatter('---\n- one\n- two\n---\nBody'), null)
})
