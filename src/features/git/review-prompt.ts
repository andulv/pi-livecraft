import type { GitCommit } from '../../../shared/types.ts'

const REVIEW_INSTRUCTIONS = [
  'Inspect the exact changes and the surrounding code before answering.',
  'Look for bugs, regressions, security issues, missing validation, and missing tests.',
  'Report only actionable findings with severity, file and line, explanation, and a suggested fix.',
  'If there are no findings, say so explicitly.',
]
  .join('\n')

/** Builds a draft prompt for reviewing selected changes in the current workspace. */
export function uncommittedReviewPrompt(paths: readonly string[]): string {
  return [
    'Review the following uncommitted Git changes in the current workspace.',
    '',
    'Files:',
    formatPaths(paths),
    '',
    'Use Git to inspect tracked changes and read untracked files directly when needed.',
    REVIEW_INSTRUCTIONS,
  ]
    .join('\n')
}

/** Builds a draft prompt for reviewing every file changed by a displayed commit. */
export function commitReviewPrompt(commit: GitCommit): string {
  return [
    `Review commit ${JSON.stringify(commit.hash)} (${
      JSON.stringify(commit.subject)
    }) in the current workspace.`,
    '',
    'Files changed:',
    formatPaths(commit.files.map(({ path }) => path)),
    '',
    'Inspect the complete commit with Git and read the surrounding code before answering.',
    REVIEW_INSTRUCTIONS,
  ]
    .join('\n')
}

function formatPaths(paths: readonly string[]): string {
  return paths.map((path) => `- ${JSON.stringify(path)}`).join('\n')
}
