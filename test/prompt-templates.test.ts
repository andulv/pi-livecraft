import assert from 'node:assert/strict'
import test from 'node:test'
import { stripPromptFrontmatter } from '../server/prompt-templates.ts'

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
