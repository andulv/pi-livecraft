import assert from 'node:assert/strict'
import test from 'node:test'
import { nextActiveSessionId } from '../src/features/workspace/sidebar-sessions.ts'
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

test('choisit la session active suivante après une fermeture', () => {
  const recentSessions = [
    {
      id: 'closed',
      cwd: '/workspace',
      name: 'Closed',
      sessionPath: '/closed.jsonl',
      updatedAt: 30,
    },
    { id: 'next', cwd: '/workspace', name: 'Next', sessionPath: '/next.jsonl', updatedAt: 20 },
    {
      id: 'previous',
      cwd: '/workspace',
      name: 'Previous',
      sessionPath: '/previous.jsonl',
      updatedAt: 10,
    },
  ]
  const sessions = recentSessions.map((session) => ({
    ...session,
    status: 'idle' as const,
    pendingUi: [],
  }))
  assert.equal(nextActiveSessionId('closed', sessions, recentSessions, '/workspace'), 'next')
  assert.equal(nextActiveSessionId('next', sessions, recentSessions, '/workspace'), 'previous')
})
