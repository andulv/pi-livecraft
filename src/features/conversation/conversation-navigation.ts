/** Identifies a conversation element that a cross-feature control can reveal. */
export type ConversationNavigationTarget =
  | { kind: 'message' | 'turn'; index: number }
  | { kind: 'tool'; id: string }
