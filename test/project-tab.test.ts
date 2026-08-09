import assert from 'node:assert/strict'
import test from 'node:test'
import { projectFaviconHref, projectPageTitle } from '../src/features/workspace/project-tab.ts'

test('uses the selected project name in the browser title', () => {
  assert.equal(projectPageTitle('pi-livecraft'), 'pi-livecraft - Livecraft')
  assert.equal(projectPageTitle(), 'Pi Livecraft')
})

test('creates a project-coloured favicon only for valid project colours', () => {
  const favicon = projectFaviconHref('#3c6fa8')
  assert.match(favicon, /^data:image\/svg\+xml,/)
  assert.match(decodeURIComponent(favicon), /fill="#3c6fa8"/)
  assert.equal(projectFaviconHref('invalid'), '/favicon.svg')
})
