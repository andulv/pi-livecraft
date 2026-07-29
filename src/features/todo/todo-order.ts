import type { TodoItem } from '../../../shared/types.ts'

/** Moves an unlinked task before or after another unlinked task. */
export function reorderTodoItems(
  todos: TodoItem[],
  movedId: string,
  targetId: string,
  placeAfter: boolean,
): TodoItem[] {
  if (movedId === targetId) return todos
  const movedTodo = todos.find(({ id }) => id === movedId)
  const targetTodo = todos.find(({ id }) => id === targetId)
  if (!movedTodo || !targetTodo || movedTodo.session || targetTodo.session) return todos

  const reordered = [...todos]
  const [removedTodo] = reordered.splice(reordered.findIndex(({ id }) => id === movedId), 1)
  const targetIndex = reordered.findIndex(({ id }) => id === targetId)
  reordered.splice(targetIndex + Number(placeAfter), 0, removedTodo)

  return reordered.every((todo, index) => todo.id === todos[index]?.id) ? todos : reordered
}

/** Returns the display order while preserving the stored order within each task group. */
export function sortTodoItemsForDisplay(todos: TodoItem[]): TodoItem[] {
  return todos
    .map((todo, index) => ({ todo, index }))
    .sort((left, right) => {
      const leftRank = left.todo.session ? Number(!left.todo.completed) : 2
      const rightRank = right.todo.session ? Number(!right.todo.completed) : 2
      return leftRank - rightRank || left.index - right.index
    })
    .map(({ todo }) => todo)
}
