import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampWorkspaceSidebarWidth,
  defaultWorkspaceSidebarWidth,
  maxWorkspaceSidebarWidth,
  minWorkspaceSidebarWidth,
  readWorkspaceSidebarCollapsed,
  readWorkspaceSidebarWidth,
} from '../src/features/workspace/workspace-sidebar.ts'

test('borne et restaure la largeur de la sidebar de sessions', () => {
  assert.equal(clampWorkspaceSidebarWidth(100), minWorkspaceSidebarWidth)
  assert.equal(clampWorkspaceSidebarWidth(999), maxWorkspaceSidebarWidth)
  assert.equal(clampWorkspaceSidebarWidth(320.6), 321)
  assert.equal(readWorkspaceSidebarWidth(null), defaultWorkspaceSidebarWidth)
  assert.equal(readWorkspaceSidebarWidth('invalid'), defaultWorkspaceSidebarWidth)
  assert.equal(readWorkspaceSidebarCollapsed('true'), true)
  assert.equal(readWorkspaceSidebarCollapsed('false'), false)
  assert.equal(readWorkspaceSidebarCollapsed('invalid'), false)
})
