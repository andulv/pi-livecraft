import { Type } from 'typebox'
import { agentPackageEntry, defineSubagent } from '../define.ts'

const parameters = Type.Object({
  task: Type.String({
    minLength: 1,
    description:
      'Prompt to subagent: Repository question to investigate. Specific numbered claims or questions produce the best results — e.g. "Verify these 4 claims: 1. X calls Y at... 2. Z no longer references..."-  Ask for paths, line numbers, and concrete evidence or summaries.',
  }),
})

export default defineSubagent<{ task: string }>({
  name: 'repo_explore',
  promptSnippet:
    'Use repo_explore to investigate, analyze, research, find/search, summarize code, documentation, plans, text, images: find usages, explain code, summarize code or features, verify claims against source, trace flows across files, find gaps between components, map symbols/paths, etc. Your own context is a scarce and valuable resource. repo_explore is at your disposal and powered by a competent model with high capacity. Use it to keep your own context lean and focused on the assigned task instead of filled with search results and research details.',
  // promptGuidelines: [
  //   'Subagent repo_explore is powered by competent model with high capacity. Use its services to keep your context trimmed, lean and focused on the important bits and not filled up with search results and research.',
  // ],
  description:
    'Investigate, analyze, research, find/search, summarize. Most effective with specific numbered questions or claims to verify. For open exploration, prefer a focused scope ("how does X reach Y") over broad surveys ("investigate everything about X").',
  parameters,
  task: ({ task }) => task.trim(),
  systemPrompt:
    `You are a repository exploration specialist. Use fffind for path and concept discovery, ffgrep for identifiers and short evidence, and read for known files. Prefer one larger read over several offset reads of the same file; each call counts against the budget". Do not claim to have inspected content unless a tool result establishes it. Do not modify files.

Output style: Short. Concise. Condensed. Efficient. Output will be consumed by agent/llm so no need for narration, pleasantries or filler. Respect other LLM's. They depend on you and the information you provide and they respect you. Be aware that your output fills their context, consumes their focus and our shared resources so use it judiciously and with respect. Structure output by the caller's questions/claims, not by reading order (if the caller lists 5 claims, return 5 numbered sections with verdicts). If the question is open-ended, lead with a findings table, then evidence.
Report the relevant files, key symbols with line-number evidence when available, how the pieces connect, the next files or ranges the caller should read, and any uncertainty. Use absolute paths when possible. Do not emit conversational preambles before tool calls.`,
  tools: ['fffind', 'ffgrep', 'read'],
  extensions: [agentPackageEntry('@ff-labs/pi-fff', 'src/index.ts')],
  providerArgs: ['--fff-mode', 'tools-only'],
  providerEnv: { PI_FFF_MODE: 'tools-only', PI_FFF_MULTIGREP: '0' },
  models: [
    'fireworks/accounts/fireworks/models/deepseek-v4p1-flash',
    'fireworks/accounts/fireworks/models/glm-5p3-flash',
    'openai-codex/gpt-6-luna',
  ],
  modelSelection: 'random',
  thinking: 'off',
  effort: {
    quick: { timeoutMs: 45_000, softToolCalls: 6, hardToolCalls: 8 },
    standard: { timeoutMs: 90_000, softToolCalls: 12, hardToolCalls: 16 },
    deep: { timeoutMs: 180_000, softToolCalls: 24, hardToolCalls: 32 },
    max: { timeoutMs: 360_000, softToolCalls: 40, hardToolCalls: 54 },
  },
  defaultEffort: 'standard',
  maxOutputChars: 12_000,
})
