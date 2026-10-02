import { spawn } from 'node:child_process'
import { mkdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type {
  GitCommitFiles,
  GitCommitSummary,
  GitFileChange,
  GitFileDiff,
  GitHistoryCommit,
  GitOutgoingChanges,
  GitProject,
  GitResetResult,
  GitRevertResult,
  GitSnapshot,
  GitWorkspace,
  GitWorktreeCreation,
  GitWorktreeDeletion,
} from '../../../shared/types.ts'
import { measureOperation } from '../diagnostics/operations.ts'
import { FreshRuns } from './fresh-runs.ts'

interface GitCommandResult {
  exitCode: number
  stderr: string
  stdout: string
}

/** Lets near-simultaneous callers, typically several tabs reacting to one event, share a run. */
const snapshotGatherMs = 25
const snapshotRuns = new FreshRuns<GitSnapshot>(snapshotGatherMs)

/**
 * Aggregates Git state, including divergence from locally known tracked refs. Concurrent
 * callers for one directory (tabs, widget actions, and mutation checks) share one run that
 * started after they asked, so sharing never returns state older than the request.
 */
export function getGitSnapshot(cwd: string): Promise<GitSnapshot> {
  return snapshotRuns.run(cwd, () => readGitSnapshot(cwd))
}

async function readGitSnapshot(cwd: string): Promise<GitSnapshot> {
  // One process answers the repository check, the root, and the worktree layout.
  const location = await runGit(cwd, [
    'rev-parse',
    '--is-inside-work-tree',
    '--show-toplevel',
    '--absolute-git-dir',
    '--git-common-dir',
  ], [0, 128])
  const [insideWorkTree, root, gitDir, commonDir] = location.stdout.split(/\r?\n/)
  if (location.exitCode !== 0 || insideWorkTree?.trim() !== 'true') return emptyGitSnapshot()

  // `--branch` adds the branch, its upstream, and the divergence from the local tracking ref,
  // so snapshot reads never contact the remote and avoid credential prompts.
  const [status, unstaged, staged] = await Promise.all([
    runGit(cwd, ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all']),
    runGit(cwd, ['diff', '--numstat', '-z']),
    runGit(cwd, ['diff', '--cached', '--numstat', '-z']),
  ])
  const headerEnd = status.stdout.startsWith('## ') ? status.stdout.indexOf('\0') : -1
  const header = parseStatusBranch(headerEnd >= 0 ? status.stdout.slice(0, headerEnd) : '')
  const changes = parseGitStatus(status.stdout.slice(headerEnd + 1))
  const counts = mergeNumstats(unstaged.stdout, staged.stdout)
  // Untracked files have no Git numstat in a snapshot. Keep their nullable counts;
  // loading each file's diff here would fork a process per file on every refresh.

  const hasUpstream = header.upstream !== null && !header.upstreamGone
  const behind = hasUpstream && !header.unborn ? header.behind : null

  // With an upstream, list commits ahead of it. Without one (a worktree or branch with no
  // remote tracking), fall back to commits on HEAD that are not on any remote, so local work in a
  // remote-less checkout is still listed instead of appearing empty.
  const [commits, history] = header.unborn
    ? [[], []]
    : await Promise.all([
      unpushedCommits(cwd, hasUpstream ? ['@{upstream}..HEAD'] : ['HEAD', '--not', '--remotes']),
      recentCommits(cwd),
    ])

  // Older Git or an unusual layout without both directories reports the main checkout.
  const worktree = gitDir && commonDir ? isLinkedWorktree(gitDir, commonDir, cwd) : false
  const branchName = header.branch ?? 'HEAD'
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
    root: root?.trim() || null,
    branch: branchName,
    worktree,
    files: changes.map((change) => {
      const count = counts.get(change.path)
      return { ...change, additions: count?.additions ?? null, deletions: count?.deletions ?? null }
    }),
    ahead: commits.length,
    behind,
    baseBranch,
    baseAhead,
    baseBehind,
    commits,
    history,
  }
}

function emptyGitSnapshot(): GitSnapshot {
  return {
    repository: false,
    root: null,
    branch: null,
    worktree: false,
    files: [],
    ahead: 0,
    behind: null,
    baseBranch: null,
    baseAhead: 0,
    baseBehind: 0,
    commits: [],
    history: [],
  }
}

export interface GitStatusBranch {
  /** Checked-out branch; null when HEAD is detached. */
  branch: string | null
  /** Whether the branch has no commits yet. */
  unborn: boolean
  /** Configured upstream, even when its local tracking ref no longer exists. */
  upstream: string | null
  upstreamGone: boolean
  ahead: number
  behind: number
}

/**
 * Parses the `## …` header of `git status --porcelain=v1 --branch`, for example
 * `## main...origin/main [ahead 1, behind 2]`, `## No commits yet on main`, or
 * `## HEAD (no branch)`. Branch names cannot contain spaces or `..`, so the separators
 * are unambiguous.
 */
export function parseStatusBranch(header: string): GitStatusBranch {
  let rest = header.startsWith('## ') ? header.slice(3) : header
  const unbornPrefix = ['No commits yet on ', 'Initial commit on ']
    .find((prefix) => rest.startsWith(prefix))
  if (unbornPrefix) rest = rest.slice(unbornPrefix.length)
  const result: GitStatusBranch = {
    branch: null,
    unborn: unbornPrefix !== undefined,
    upstream: null,
    upstreamGone: false,
    ahead: 0,
    behind: 0,
  }
  if (!rest || rest.startsWith('HEAD (no branch)')) return result
  const match = /^(\S+?)(?:\.\.\.(\S+))?(?: \[([^\]]*)\])?$/.exec(rest)
  if (!match) return result
  result.branch = match[1] ?? null
  result.upstream = match[2] ?? null
  for (const part of (match[3] ?? '').split(',').map((value) => value.trim())) {
    if (part === 'gone') result.upstreamGone = true
    else if (part.startsWith('ahead ')) result.ahead = Number(part.slice(6)) || 0
    else if (part.startsWith('behind ')) result.behind = Number(part.slice(7)) || 0
  }
  return result
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
    const { files } = commit ? await getGitCommitFiles(cwd, commitHash) : { files: [] }
    const file = files.find((change) => change.path === path)
    if (
      !file || (file.status !== 'added' && file.status !== 'modified' && file.status !== 'deleted')
    )
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
    const beforeAvailable = file.status !== 'added'
    const afterAvailable = file.status !== 'deleted'
    const [before, after] = await Promise.all([
      beforeAvailable ? gitFileContent(cwd, `${commitHash}^`, path) : '',
      afterAvailable ? gitFileContent(cwd, commitHash, path) : '',
    ])
    return { path, diff: result.stdout, before, beforeAvailable, after, afterAvailable }
  }

  const file = snapshot.files.find((change) => change.path === path)
  if (!file || (file.status !== 'added' && file.status !== 'modified' && file.status !== 'deleted'))
    throw new Error('This file cannot be displayed.')

  const beforeAvailable = file.status !== 'added'
  const afterAvailable = file.status !== 'deleted'
  const trackedDiff = await runGit(cwd, ['diff', 'HEAD', '--', path], [0, 128])
  const [before, after] = await Promise.all([
    beforeAvailable ? gitFileContent(cwd, 'HEAD', path) : '',
    afterAvailable ? readFile(resolve(cwd, path), 'utf8') : '',
  ])
  if (trackedDiff.stdout)
    return { path, diff: trackedDiff.stdout, before, beforeAvailable, after, afterAvailable }

  const untrackedDiff = await runGit(cwd, ['diff', '--no-index', '--', '/dev/null', path], [0, 1])
  return { path, diff: untrackedDiff.stdout, before, beforeAvailable, after, afterAvailable }
}

/** Reads a revision's file content; a newly-added file has no parent blob. */
async function gitFileContent(cwd: string, revision: string, path: string): Promise<string> {
  const result = await runGit(cwd, ['show', `${revision}:${path}`], [0, 128])
  return result.exitCode === 0 ? result.stdout : ''
}

/** Lists aggregate file changes for every outgoing commit against its integration base. */
export async function getGitOutgoingChanges(cwd: string): Promise<GitOutgoingChanges> {
  const { files } = await outgoingComparison(cwd)
  return { files }
}

/** Returns an aggregate diff for one outgoing file, with its base and HEAD contents. */
export async function getGitOutgoingFileDiff(cwd: string, path: string): Promise<GitFileDiff> {
  const { base, files } = await outgoingComparison(cwd)
  const file = files.find((change) => change.path === path)
  if (!file || (file.status !== 'added' && file.status !== 'modified' && file.status !== 'deleted'))
    throw new Error('This file cannot be displayed.')

  const mergeBase = await runGit(cwd, ['merge-base', base, 'HEAD'])
  const beforeAvailable = file.status !== 'added'
  const afterAvailable = file.status !== 'deleted'
  const [diff, before, after] = await Promise.all([
    runGit(cwd, ['diff', `${base}...HEAD`, '--', path]),
    beforeAvailable ? gitFileContent(cwd, mergeBase.stdout.trim(), path) : '',
    afterAvailable ? gitFileContent(cwd, 'HEAD', path) : '',
  ])
  return { path, diff: diff.stdout, before, beforeAvailable, after, afterAvailable }
}

/** Resolves the comparison base and its changed files without contacting the remote. */
async function outgoingComparison(cwd: string): Promise<{ base: string; files: GitFileChange[] }> {
  const snapshot = await getGitSnapshot(cwd)
  if (snapshot.commits.length === 0) throw new Error('There are no outgoing commits to display.')

  const upstream = await runGit(cwd, ['rev-parse', '--verify', '--quiet', '@{upstream}'], [0, 1])
  const base = upstream.exitCode === 0
    ? '@{upstream}'
    : snapshot.worktree && snapshot.baseBranch
    ? snapshot.baseBranch
    : null
  if (!base) throw new Error('No integration branch is available for these outgoing commits.')

  const [status, stats] = await Promise.all([
    runGit(cwd, ['diff', '--name-status', '-z', `${base}...HEAD`]),
    runGit(cwd, ['diff', '--numstat', '-z', `${base}...HEAD`]),
  ])
  const counts = mergeNumstats(stats.stdout)
  return {
    base,
    files: parseGitNameStatus(status.stdout).map((change) => ({
      ...change,
      additions: counts.get(change.path)?.additions ?? null,
      deletions: counts.get(change.path)?.deletions ?? null,
    })),
  }
}

/** Lists unpushed commit summaries without running Git once per commit. */
async function unpushedCommits(cwd: string, revisions: string[]): Promise<GitCommitSummary[]> {
  const result = await runGit(cwd, ['log', '--format=%H%x00%s%x00', ...revisions])
  const fields = result.stdout.split('\0')
  const commits: GitCommitSummary[] = []

  for (let index = 0; index < fields.length - 1; index += 2) {
    const hash = fields[index].trim()
    const subject = fields[index + 1]
    if (!hash) continue
    commits.push({ hash, subject })
  }

  return commits
}

/** Resolves the files of only the commit the user opened. */
export async function getGitCommitFiles(cwd: string, hash: string): Promise<GitCommitFiles> {
  const [status, stats] = await Promise.all([
    runGit(cwd, [
      'diff-tree',
      '--no-commit-id',
      '--name-status',
      '-r',
      '-m',
      '--root',
      '--first-parent',
      '-z',
      hash,
    ]),
    runGit(cwd, [
      'diff-tree',
      '--no-commit-id',
      '--numstat',
      '-r',
      '-m',
      '--root',
      '--first-parent',
      '-z',
      hash,
    ]),
  ])
  const counts = mergeNumstats(stats.stdout)
  return {
    files: parseGitNameStatus(status.stdout).map((change) => {
      const count = counts.get(change.path)
      return { ...change, additions: count?.additions ?? null, deletions: count?.deletions ?? null }
    }),
  }
}

/** Lists the 20 most recent commits reachable from HEAD without loading their file details. */
async function recentCommits(cwd: string): Promise<GitHistoryCommit[]> {
  const result = await runGit(cwd, ['log', '-n', '20', '--format=%H%x00%s%x00', 'HEAD'])
  const fields = result.stdout.split('\0')
  const commits: GitHistoryCommit[] = []

  for (let index = 0; index < fields.length - 1; index += 2) {
    const hash = fields[index].trim()
    const subject = fields[index + 1]
    if (hash) commits.push({ hash, subject })
  }
  return commits
}

/** Fast-forwards the tracked branch from its remote without creating a merge commit. */
export async function pullCommits(cwd: string): Promise<void> {
  const repository = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], [0, 128])
  if (repository.exitCode !== 0 || repository.stdout.trim() !== 'true')
    throw new Error('The current directory is not a Git repository.')
  await runGit(cwd, ['pull', '--ff-only'])
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

/**
 * Removes a linked worktree and its branch, refusing when work could be lost. The worktree is
 * deleted only when it has no uncommitted changes and no commits beyond the main checkout's
 * branch (every commit is already merged into "master"). Git commands run from the main
 * checkout so the worktree being removed is never the command's own directory.
 */
export async function deleteWorktree(
  cwd: string,
  worktreePath: string,
): Promise<GitWorktreeDeletion> {
  const project = await getGitProject(cwd)
  if (!project) throw new Error('The current directory is not a Git repository.')

  const canonicalTarget = await realpath(worktreePath)
  const workspaces = await Promise.all(
    project.workspaces.map(async (workspace) => ({
      workspace,
      path: await realpath(workspace.path).catch(() => workspace.path),
    })),
  )
  const target = workspaces.find((entry) => entry.path === canonicalTarget)?.workspace
  if (!target) throw new Error('That worktree is not part of this repository.')
  if (target.main) throw new Error('The main worktree cannot be deleted.')

  const snapshot = await getGitSnapshot(worktreePath)
  if (snapshot.files.length > 0)
    throw new Error('This worktree has uncommitted changes. Commit or discard them first.')
  if (!snapshot.baseBranch)
    throw new Error('Cannot verify this worktree is merged into the main branch.')
  if (snapshot.baseAhead > 0) {
    const plural = snapshot.baseAhead === 1 ? 'commit' : 'commits'
    throw new Error(
      `This worktree has ${snapshot.baseAhead} ${plural} not merged into ${snapshot.baseBranch}.`,
    )
  }

  const mainPath = workspaces.find((entry) => entry.workspace.main)?.path ?? cwd
  // We already verified the worktree is clean, so retry with --force only when Git refuses
  // because the worktree contains submodules; other refusals (e.g. a locked worktree) surface.
  const removal = await runGit(mainPath, ['worktree', 'remove', canonicalTarget], [0, 128])
  if (removal.exitCode !== 0) {
    if (!/submodules/i.test(removal.stderr)) throw new Error(gitError(removal))
    await runGit(mainPath, ['worktree', 'remove', '--force', canonicalTarget])
  }
  if (target.branch) await runGit(mainPath, ['branch', '-D', target.branch])
  return { deleted: true, branch: target.branch }
}

/**
 * Creates a new branch and a worktree for it, started from the main checkout's current HEAD.
 * The worktree lives beside the repository in a `<repo>.worktrees/<branch>` group folder, so
 * it never sits inside the main working tree. Git naming and collision errors surface verbatim.
 */
export async function createWorktree(
  cwd: string,
  branch: string,
): Promise<GitWorktreeCreation> {
  const project = await getGitProject(cwd)
  if (!project) throw new Error('The current directory is not a Git repository.')
  const mainPath = project.workspaces.find((workspace) => workspace.main)?.path ?? cwd

  const name = branch.trim()
  if (!name) throw new Error('A branch name is required.')
  if (name.length > 200) throw new Error('The branch name is too long.')

  const group = `${basename(mainPath)}.worktrees`
  const folder = name.replace(/[/\\]+/g, '-')
  const worktreePath = join(dirname(mainPath), group, folder)
  await mkdir(dirname(worktreePath), { recursive: true })
  // Default exit handling rejects on failure, so an existing branch, invalid name, or
  // occupied path reaches the caller as Git's own message.
  await runGit(mainPath, ['worktree', 'add', worktreePath, '-b', name])
  return { path: worktreePath, branch: name }
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

/**
 * Every Git process goes through here so the operation ledger sees each spawn; the ledger
 * detail is the subcommand only because later arguments can carry paths and messages.
 */
async function runGit(
  cwd: string,
  args: string[],
  allowedExitCodes = [0],
): Promise<GitCommandResult> {
  return measureOperation('git', args[0] ?? 'unknown', () => spawnGit(cwd, args, allowedExitCodes))
}

function spawnGit(
  cwd: string,
  args: string[],
  allowedExitCodes: number[],
): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    // Optional locks off: read-only commands such as `status` then never take the index
    // lock, so refreshes cannot make the agent's own Git commands fail on `index.lock`.
    const process = spawn('git', args, {
      cwd,
      env: { ...globalThis.process.env, GIT_OPTIONAL_LOCKS: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
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
