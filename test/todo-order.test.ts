import assert from 'node:assert/strict'
import test from 'node:test'
import { reorderTodoItems, sortTodoItemsForDisplay } from '../src/features/todo/todo-order.ts'

const todos = [
  { id: 'first', text: 'Première tâche', completed: false },
  { id: 'completed', text: 'Tâche terminée', completed: true },
  { id: 'last', text: 'Dernière tâche', completed: false },
]

test('reorders unlinked todos before or after a drop target', () => {
  assert.deepEqual(reorderTodoItems(todos, 'last', 'first', false).map(({ id }) => id), [
    'last',
    'first',
    'completed',
  ])
  assert.deepEqual(reorderTodoItems(todos, 'first', 'last', true).map(({ id }) => id), [
    'completed',
    'last',
    'first',
  ])
  assert.equal(reorderTodoItems(todos, 'missing', 'first', false), todos)
})

test('displays linked todos first, completed before in-progress', () => {
  const linkedOpen = {
    id: 'linked-open',
    text: 'Session en cours',
    completed: false,
    session: { id: 'session-open', name: 'Open', sessionPath: '/open' },
  }
  const linkedCompleted = {
    id: 'linked-completed',
    text: 'Session terminée',
    completed: true,
    session: { id: 'session-done', name: 'Done', sessionPath: '/done' },
  }
  const sorted = sortTodoItemsForDisplay([
    todos[0],
    linkedOpen,
    linkedCompleted,
  ])
  assert.deepEqual(sorted.map(({ id }) => id), [
    'linked-completed',
    'linked-open',
    'first',
  ])
})

test('does not move linked todos', () => {
  const linked = {
    id: 'linked',
    text: 'Liée',
    completed: false,
    session: { id: 'session', name: 'Session', sessionPath: '/session' },
  }
  assert.equal(reorderTodoItems([linked, todos[0]], 'linked', 'first', false)[0], linked)
  assert.equal(reorderTodoItems([linked, todos[0]], 'first', 'linked', false)[1], todos[0])
})
