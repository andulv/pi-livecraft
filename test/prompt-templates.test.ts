import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadGlobalPromptTemplates, stripPromptFrontmatter } from '../server/prompt-templates.ts'

test('strips YAML frontmatter from prompt templates', () => {
  assert.equal(
    stripPromptFrontmatter(
      '---\ndescription: Test\nargument-hint: "[topic]"\n---\nReview $ARGUMENTS.',
    ),
    'Review $ARGUMENTS.',
  )
})

test('preserves a template without complete frontmatter', () => {
  const template = '---\ndescription: unfinished'
  assert.equal(stripPromptFrontmatter(template), template)
})

test('loads templates added after a Pi session starts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'livecraft-prompts-'))
  try {
    await writeFile(directory + '/review.md', '---\ndescription: Review\n---\nReview the changes.')
    assert.deepEqual(await loadGlobalPromptTemplates(directory), [
      { name: 'review', content: 'Review the changes.' },
    ])
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
