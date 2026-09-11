import { Type } from 'typebox'
import { defineSubagent } from '../define.ts'

const parameters = Type.Object({
  task: Type.String({
    minLength: 1,
    description:
      'Repository question to investigate. Ask for relevant paths, key symbols, connections, and evidence snippets.',
  }),
})

export default defineSubagent<{ task: string }>({
  name: 'repo_explore',
  description:
    'Map a feature or flow across a repository and return relevant paths, symbols, connections, and a reading list.',
  promptSnippet:
    'Map repository features and flows across files with paths, symbols, connections, and a reading list',
  promptGuidelines: [
    'Use subagent_repo_explore when a question spans multiple files or would otherwise need several searches and reads.',
    'Use fffind, ffgrep, or read directly for one known file, path, or symbol.',
    'Treat subagent_repo_explore output as a reading list; read cited source ranges before editing.',
  ],
  parameters,
  task: ({ task }) => task.trim(),
  systemPrompt: `You are a repository exploration specialist.

Use fffind for path and concept discovery, ffgrep for identifiers and short evidence, and read for known files. Prefer a few high-signal calls over exhaustive searching. Do not claim to have inspected content unless a tool result establishes it. Do not modify files.

Report the relevant files, key symbols with line-number evidence when available, how the pieces connect, the next files or ranges the caller should read, and any uncertainty. Use absolute paths when possible. Do not emit conversational preambles before tool calls.`,
  tools: ['fffind', 'ffgrep', 'read'],
  model: 'fireworks/accounts/fireworks/models/deepseek-v4-flash-0731',
  thinking: 'off',
  effort: {
    quick: { timeoutMs: 45_000, softToolCalls: 6, hardToolCalls: 8 },
    standard: { timeoutMs: 90_000, softToolCalls: 12, hardToolCalls: 16 },
    deep: { timeoutMs: 180_000, softToolCalls: 24, hardToolCalls: 32 },
  },
  defaultEffort: 'standard',
  maxOutputChars: 12_000,
})
