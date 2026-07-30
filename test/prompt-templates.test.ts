import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  loadPromptTemplates,
  savePromptTemplate,
  stripPromptFrontmatter,
} from '../server/prompt-templates.ts'

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

test('saves project prompts in Pi’s conventional directory without overwriting', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-livecraft-prompt-'))
  try {
    const saved = await savePromptTemplate(cwd, 'project', 'review', 'Review staged changes.\n')
    assert.equal(await readFile(join(cwd, '.pi/prompts/review.md'), 'utf8'), saved.content)
    assert.equal(saved.description, 'Review staged changes.')
    assert.deepEqual(
      await loadPromptTemplates([{
        source: 'prompt',
        name: 'review',
        description: 'Review staged changes',
        path: join(cwd, '.pi/prompts/review.md'),
      }]),
      [{ ...saved, description: 'Review staged changes' }],
    )
    await assert.rejects(
      savePromptTemplate(cwd, 'project', 'review', 'Replacement'),
      { code: 'EEXIST' },
    )
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
