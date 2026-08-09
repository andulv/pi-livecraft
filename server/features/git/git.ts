import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type {
  GitCommit,
  GitFileChange,
  GitFileDiff,
  GitProject,
  GitResetResult,
  GitRevertResult,
  GitSnapshot,
  GitWorkspace,
} from '../../../shared/types.ts'

interface GitCommandResult {
  exitCode: number
  stderr: string
  stdout: string
}

/** Aggregates Git state, file statistics, and the number of commits waiting to be pushed. */
export async function getGitSnapshot(cwd: string): Promise<GitSnapshot> {
  const repository = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], [0, 128])
  if (repository.exitCode !== 0 || repository.stdout.trim() !== 'true')
    return {
      repository: false,
      root: null,
      branch: null,
      worktree: false,
      files: [],
      ahead: 0,
      baseBranch: null,
      baseAhead: 0,
      baseBehind: 0,
      commits: [],
    }

  const [root, status, unstaged, staged, branch, upstream] = await Promise.all([
    runGit(cwd, ['rev-parse', '--show-toplevel']),
    runGit(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    runGit(cwd, ['diff', '--numstat', '-z']),
    runGit(cwd, ['diff', '--cached', '--numstat', '-z']),
    runGit(cwd, ['branch', '--show-current']),
    runGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], [0, 128]),
  ])

  const changes = parseGitStatus(status.stdout)
  const counts = mergeNumstats(unstaged.stdout, staged.stdout)
  await Promise.all(
    changes.filter((change) => change.status === 'added' && !counts.has(change.path)).map(
      async (change) => {
        const result = await runGit(cwd, [
          'diff',
          '--no-index',
          '--numstat',
          '-z',
          '--',
          '/dev/null',
          change.path,
        ], [0, 1])
        const [count] = parseNumstat(result.stdout)
        if (count)
          counts.set(change.path, {
            additions: count.additions,
            deletions: count.deletions,
          })
      },
    ),
  )

  // With an upstream, list commits ahead of it. Without one (a worktree or branch with no
  // remote tracking), fall back to commits on HEAD that are not on any remote, so local work in a
  // remote-less checkout is still listed instead of appearing empty.
  const head = await runGit(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'], [0, 1])
  const commits = head.exitCode === 0
    ? await unpushedCommits(
      cwd,
      upstream.exitCode === 0 ? ['@{upstream}..HEAD'] : ['HEAD', '--not', '--remotes'],
    )
    : []

  let worktree = false
  try {
    const [gitDir, commonDir] = await Promise.all([
      runGit(cwd, ['rev-parse', '--absolute-git-dir']),
      runGit(cwd, ['rev-parse', '--git-common-dir']),
    ])
    worktree = isLinkedWorktree(gitDir.stdout, commonDir.stdout, cwd)
  } catch {
    // Older Git or an unusual layout — report as the main checkout.
  }

  const branchName = branch.stdout.trim() || 'HEAD'
  let baseBranch: string | null = null
  let baseAhead = 0
  let baseBehind = 0
  if (worktree) {
    const worktreeList = await runGit(cwd, ['worktree', 'list', '--porcelain'])
    baseBranch = mainWorktreeBranch(worktreeList.stdout)
    if (baseBranch && baseBranch !== branchName) {
      const divergence = await runGit(
        cwd,
        ['rev-list', '--left-right', '--count', `${baseBranch}...HEAD`],
        [0, 128],
      )
      if (divergence.exitCode === 0) {
        const counts = parseBranchDivergence(divergence.stdout)
        baseAhead = counts.ahead
        baseBehind = counts.behind
      }
    }
  }

  return {
    repository: true,
    root: root.stdout.trim() || null,
    branch: branchName,
    worktree,
    files: changes.map((change) => {
      const count = counts.get(change.path)
      return { ...change, additions: count?.additions ?? null, deletions: count?.deletions ?? null }
    }),
    ahead: commits.length,
    baseBranch,
    baseAhead,
    baseBehind,
    commits,
  }
}

/** Returns the branch checked out in Git's primary worktree, which is listed first. */
export function mainWorktreeBranch(output: string): string | null {
  const firstWorktree = output.split(/\r?\n\r?\n/, 1)[0] ?? ''
  const branch = firstWorktree.split(/\r?\n/).find((line) => line.startsWith('branch refs/heads/'))
  return branch?.slice('branch refs/heads/'.length) || null
}

/** Parses `<base-only> <head-only>` from `git rev-list --left-right --count`. */
export function parseBranchDivergence(output: string): { ahead: number; behind: number } {
  const [behind, ahead] = output.trim().split(/\s+/).map(Number)
  return {
    ahead: Number.isFinite(ahead) ? ahead : 0,
    behind: Number.isFinite(behind) ? behind : 0,
  }
}

/** True when the working directory is a linked worktree rather than the repository's main checkout. */
export function isLinkedWorktree(
  absoluteGitDir: string,
  commonDirRaw: string,
  cwd: string,
): boolean {
  return resolve(absoluteGitDir.trim()) !== resolve(cwd, commonDirRaw.trim())
}

/** Lists the main checkout and linked worktrees belonging to the repository at cwd. */
export async function getGitProject(cwd: string): Promise<GitProject | null> {
  const repository = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], [0, 128])
  if (repository.exitCode !== 0 || repository.stdout.trim() !== 'true') return null

  const root = await runGit(cwd, ['rev-parse', '--show-toplevel'])
  const listing = await runGit(cwd, ['worktree', 'list', '--porcelain'])
  const parsed = parseGitWorktrees(listing.stdout, root.stdout.trim())
  // `git worktree list` includes prunable worktrees whose directory is already gone; drop them so
  // callers never receive a workspace path that cannot be opened.
  const checked = await Promise.all(
    parsed.map(async (workspace) => {
      try {
        return (await stat(workspace.path)).isDirectory() ? workspace : null
      } catch {
        return null
      }
    }),
  )
  return {
    root: root.stdout.trim(),
    workspaces: checked.filter((workspace): workspace is GitWorkspace => workspace !== null),
  }
}

/** Parses Git's stable worktree porcelain output without depending on display formatting. */
export function parseGitWorktrees(output: string, mainPath: string): GitProject['workspaces'] {
  const workspaces: GitProject['workspaces'] = []
  for (const block of output.trim().split('\n\n')) {
    const fields = new Map(
      block.split('\n').flatMap((line) => {
        const separator = line.indexOf(' ')
        return separator > 0 ? [[line.slice(0, separator), line.slice(separator + 1)]] : []
      }),
    )
    const path = fields.get('worktree')
    if (!path) continue
    const branch = fields.get('branch')
    workspaces.push({
      path,
      branch: branch?.startsWith('refs/heads/') ? branch.slice('refs/heads/'.length) : null,
      main: resolve(path) === resolve(mainPath),
    })
  }
  return workspaces
}

/** Returns the unified diff for a modified or added file in the tree or an unpushed commit. */
export async function getGitFileDiff(
  cwd: string,
  path: string,
  commitHash?: string,
): Promise<GitFileDiff> {
  const snapshot = await getGitSnapshot(cwd)
  if (commitHash) {
    const commit = snapshot.commits.find(({ hash }) => hash === commitHash)
    const file = commit?.files.find((change) => change.path === path)
    if (!file || (file.status !== 'added' && file.status !== 'modified'))
      throw new Error('This file cannot be displayed.')
    const result = await runGit(cwd, [
      'diff-tree',
      '--no-commit-id',
      '--root',
      '--first-parent',
      '-m',
      '-p',
      commitHash,
      '--',
      path,
    ])
    return { path, diff: result.stdout }
  }

  const file = snapshot.files.find((change) => change.path === path)
  if (!file || (file.status !== 'added' && file.status !== 'modified'))
    throw new Error('This file cannot be displayed.')

  const trackedDiff = await runGit(cwd, ['diff', 'HEAD', '--', path], [0, 128])
  if (trackedDiff.stdout) return { path, diff: trackedDiff.stdout }

  const untrackedDiff = await runGit(cwd, ['diff', '--no-index', '--', '/dev/null', path], [0, 1])
  return { path, diff: untrackedDiff.stdout }
}

/** Lists the commits in `revisions` (e.g. `@{upstream}..HEAD`) and each commit's files. */
async function unpushedCommits(cwd: string, revisions: string[]): Promise<GitCommit[]> {
  const result = await runGit(cwd, ['log', '--format=%H%x00%s%x00', ...revisions])
  const fields = result.stdout.split('\0')
  const commits: GitCommit[] = []

  for (let index = 0; index < fields.length - 1; index += 2) {
    const hash = fields[index].trim()
    const subject = fields[index + 1]
    if (!hash) continue
    commits.push({ hash, subject, files: [] })
  }

  await Promise.all(commits.map(async (commit) => {
    const [status, stats] = await Promise.all([
      runGit(cwd, [
        'diff-tree',
        '--no-commit-id',
        '--name-status',
        '-r',
        '-m',
        '--first-parent',
        '-z',
        commit.hash,
      ]),
      runGit(cwd, [
        'diff-tree',
        '--no-commit-id',
        '--numstat',
        '-r',
        '-m',
        '--first-parent',
        '-z',
        commit.hash,
      ]),
    ])
    const counts = mergeNumstats(stats.stdout)
    commit.files = parseGitNameStatus(status.stdout).map((change) => {
      const count = counts.get(change.path)
      return { ...change, additions: count?.additions ?? null, deletions: count?.deletions ?? null }
    })
  }))

  return commits
}

/** Resets only the latest local commit while preserving its changes. */
export async function resetGitCommit(cwd: string, hash: string): Promise<GitResetResult> {
  const snapshot = await getGitSnapshot(cwd)
  if (!snapshot.repository) throw new Error('The current directory is not a Git repository.')
  if (snapshot.files.length > 0)
    throw new Error('The repository must be clean before resetting a commit.')
  if (snapshot.commits[0]?.hash !== hash)
    throw new Error('Only the latest unpushed commit can be reset.')

  await runGit(cwd, ['reset', `${hash}^`])
  return { hash }
}

/** Reverts a displayed local commit by creating its inverse without rewriting history. */
export async function revertGitCommit(cwd: string, hash: string): Promise<GitRevertResult> {
  const snapshot = await getGitSnapshot(cwd)
  if (!snapshot.repository) throw new Error('The current directory is not a Git repository.')
  if (snapshot.files.length > 0)
    throw new Error('The repository must be clean before reverting a commit.')
  if (!snapshot.commits.some((commit) => commit.hash === hash))
    throw new Error('This commit cannot be reverted.')

  await runGit(cwd, ['revert', '--no-edit', hash])
  return { hash }
}

/** Commits all current changes with the given message. */
export async function commitChanges(cwd: string, message: string): Promise<void> {
  const snapshot = await getGitSnapshot(cwd)
  if (!snapshot.repository) throw new Error('The current directory is not a Git repository.')
  if (snapshot.files.length === 0) throw new Error('There are no changes to commit.')
  if (!message.trim()) throw new Error('A commit message is required.')
  await runGit(cwd, ['add', '-A'])
  await runGit(cwd, ['commit', '-m', message.trim()])
}

/** Pushes commits ahead of the tracked branch. */
export async function pushCommits(cwd: string): Promise<{ pushed: boolean; pushError?: string }> {
  const snapshot = await getGitSnapshot(cwd)
  if (!snapshot.repository) throw new Error('The current directory is not a Git repository.')
  if (snapshot.ahead === 0) throw new Error('There are no commits to push.')
  const push = await runGit(cwd, ['push'], [0, 1])
  return push.exitCode === 0
    ? { pushed: true }
    : { pushed: false, pushError: gitError(push) }
}

/** Discards changes for one file, including a staged or untracked file. */
export async function discardFileChanges(cwd: string, path: string): Promise<void> {
  const snapshot = await getGitSnapshot(cwd)
  if (!snapshot.repository) throw new Error('The current directory is not a Git repository.')
  const file = snapshot.files.find((change) => change.path === path)
  if (!file) throw new Error('This file has no changes to discard.')

  if (file.status === 'added') {
    await runGit(cwd, ['rm', '-f', '--cached', '--', path], [0, 1, 128])
    await runGit(cwd, ['clean', '-fd', '--', path])
    return
  }

  const status = await runGit(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const paths = pathsForGitStatus(status.stdout, path)
  await runGit(cwd, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...paths])
}

/** Discards all uncommitted changes, including untracked files (but keeps ignored files). */
export async function discardChanges(cwd: string): Promise<void> {
  const snapshot = await getGitSnapshot(cwd)
  if (!snapshot.repository) throw new Error('The current directory is not a Git repository.')
  if (snapshot.files.length === 0) throw new Error('There are no changes to discard.')
  // On a branch with commits, restore index + working tree to HEAD.
  // On an unborn branch (no commits), remove everything from the index.
  const branch = await runGit(cwd, ['rev-parse', '--verify', 'HEAD'], [0, 1])
  if (branch.exitCode === 0) {
    await runGit(cwd, ['reset', '--hard', 'HEAD'])
  } else {
    await runGit(cwd, ['rm', '-rf', '--cached', '.'])
  }
  // Remove untracked files (including those in .gitignore'd dirs but not ignored files).
  await runGit(cwd, ['clean', '-fd'])
}

/** Returns every path involved in a status entry, preserving a rename source path. */
function pathsForGitStatus(output: string, targetPath: string): string[] {
  const fields = output.split('\0')
  for (let index = 0; index < fields.length - 1; index += 1) {
    const field = fields[index]
    if (!field) continue
    const code = field.slice(0, 2)
    const path = field.slice(3)
    if (code.includes('R') || code.includes('C')) {
      const oldPath = fields[++index]
      if (path === targetPath) return oldPath ? [path, oldPath] : [path]
      continue
    }
    if (path === targetPath) return [path]
  }
  throw new Error('This file has no changes to discard.')
}

export function parseGitStatus(output: string): Omit<GitFileChange, 'additions' | 'deletions'>[] {
  const fields = output.split('\0')
  const changes: Omit<GitFileChange, 'additions' | 'deletions'>[] = []
  for (let index = 0; index < fields.length - 1; index += 1) {
    const field = fields[index]
    if (!field) continue
    const code = field.slice(0, 2)
    const path = field.slice(3)
    if (code.includes('R') || code.includes('C')) index += 1
    changes.push({ path, status: statusFor(code) })
  }
  return changes
}

/** Parses git diff --name-status -z output into file change records, tracking renames. */
export function parseGitNameStatus(
  output: string,
): Omit<GitFileChange, 'additions' | 'deletions'>[] {
  const fields = output.split('\0')
  const changes: Omit<GitFileChange, 'additions' | 'deletions'>[] = []

  for (let index = 0; index < fields.length - 1; index += 1) {
    const code = fields[index]
    const path = fields[++index]
    if (!code || !path) continue
    if (code.startsWith('R') || code.startsWith('C')) {
      const newPath = fields[++index]
      if (newPath) changes.push({ path: newPath, status: statusFor(code) })
      continue
    }
    changes.push({ path, status: statusFor(code) })
  }

  return changes
}

/** Merges multiple git diff --numstat -z outputs into combined additions and deletions per file. */
export function mergeNumstats(
  ...outputs: string[]
): Map<string, Pick<GitFileChange, 'additions' | 'deletions'>> {
  const counts = new Map<string, Pick<GitFileChange, 'additions' | 'deletions'>>()
  for (const output of outputs) {
    for (const count of parseNumstat(output)) {
      const current = counts.get(count.path)
      counts.set(count.path, {
        additions: current
                ?.additions !== null && current?.additions !== undefined && count
              .additions !== null
          ? current.additions + count.additions
          : count.additions,
        deletions: current
                ?.deletions !== null && current?.deletions !== undefined && count
              .deletions !== null
          ? current.deletions + count.deletions
          : count.deletions,
      })
    }
  }
  return counts
}

function parseNumstat(
  output: string,
): (Pick<GitFileChange, 'additions' | 'deletions'> & { path: string })[] {
  const fields = output.split('\0')
  const counts: (Pick<GitFileChange, 'additions' | 'deletions'> & { path: string })[] = []
  for (let index = 0; index < fields.length - 1; index += 1) {
    const field = fields[index]
    if (!field) continue
    const [additions, deletions, path] = field.split('\t')
    if (path) {
      counts.push({ path, additions: numberOrNull(additions), deletions: numberOrNull(deletions) })
      continue
    }
    const oldPath = fields[++index]
    const newPath = fields[++index]
    if (oldPath && newPath)
      counts.push({
        path: newPath,
        additions: numberOrNull(additions),
        deletions: numberOrNull(deletions),
      })
  }
  return counts
}

function statusFor(code: string): GitFileChange['status'] {
  if (code === '??' || code.includes('A')) return 'added'
  if (code.includes('D')) return 'deleted'
  if (code.includes('R')) return 'renamed'
  return 'modified'
}

function numberOrNull(value: string): number | null {
  const number = Number.parseInt(value, 10)
  return Number.isNaN(number) ? null : number
}

async function runGit(
  cwd: string,
  args: string[],
  allowedExitCodes = [0],
): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    const process = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    process.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    process.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    process.once('error', reject)
    process.once('close', (exitCode) => {
      const result = { exitCode: exitCode ?? 1, stdout, stderr }
      if (allowedExitCodes.includes(result.exitCode)) resolve(result)
      else reject(new Error(gitError(result)))
    })
  })
}

function gitError(result: GitCommandResult): string {
  return result.stderr.trim() || result.stdout.trim() || 'The Git command failed.'
}
