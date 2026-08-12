import assert from 'node:assert/strict'
import test from 'node:test'
import { fallbackFileIcon, resolveFileIcon } from '../src/features/git/file-icon.ts'

test('prioritizes special file names over generic extensions', () => {
  assert.equal(resolveFileIcon('Dockerfile').label, 'Dockerfile')
  assert.equal(resolveFileIcon('config/README.md').label, 'Readme')
  assert.equal(resolveFileIcon('package.json').label, 'Package manifest')
  assert.equal(resolveFileIcon('nested/package-lock.json').label, 'Package lock')
})

test('resolves composed extensions before simple extensions', () => {
  assert.equal(resolveFileIcon('src/button.test.tsx').label, 'Test')
  assert.equal(resolveFileIcon('vite.config.ts').label, 'Configuration')
  assert.equal(resolveFileIcon('src/button.tsx').label, 'React TypeScript')
  assert.equal(resolveFileIcon('src/button.ts').label, 'TypeScript')
})

test('resolves known extensions from nested and mixed-case paths', () => {
  assert.equal(resolveFileIcon('src/components/App.TSX').label, 'React TypeScript')
  assert.equal(resolveFileIcon('assets/logo.SVG').label, 'SVG')
  assert.equal(resolveFileIcon('docs/guide.Md').label, 'Markdown')
})

test('falls back to generic file icon for unknown paths', () => {
  assert.deepEqual(resolveFileIcon('src/no-extension.unknown'), fallbackFileIcon)
  assert.deepEqual(resolveFileIcon('no-extension'), fallbackFileIcon)
})
