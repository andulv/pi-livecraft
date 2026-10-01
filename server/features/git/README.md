# Git backend capability

`git.ts` reads repository state, recent history, single-file diffs (including the original and new file contents), and aggregate outgoing changed-file lists with per-file patches; commits, fast-forward pulls, and pushes workspace changes; resets eligible unpushed commits while preserving their changes; and reverts them with inverse commits. Its snapshot reports commits waiting to be pulled from the local tracked remote ref, but never fetches automatically. For a linked worktree, the snapshot also reports commits ahead of and behind the branch checked out in Git's primary worktree. These divergence counts use local refs only and do not fetch. It shells out to the installed Git executable in the validated working directory supplied by `server/backend.ts`. Snapshots list untracked files with unknown line counts instead of running Git for each one on page load; selecting a file still computes its diff on demand.

## Snapshot cost and sharing

A snapshot runs six Git processes in the main checkout (one `rev-parse` for the repository check, root, and worktree layout; `status --branch`, which also yields the branch, upstream, and ahead/behind counts; two `diff --numstat`; two `log`) and two more in a linked worktree (`worktree list` and the base-branch divergence). `getGitSnapshot` routes every caller (HTTP refreshes from any tab, diffs, outgoing changes, and mutation checks) through `FreshRuns` in `fresh-runs.ts`: callers within 25 ms share one run, and a caller arriving mid-run shares the one run queued after it, so no caller receives state read before it asked. Every Git process runs with `GIT_OPTIONAL_LOCKS=0`, so read-only refreshes never take the index lock that the agent's own Git commands need.

Unpushed commits in snapshots contain only hashes and subjects. `GET /api/git/commit-files?cwd=…&hash=…` validates a full commit hash and computes that commit's changed files when opened, rather than launching two Git commands per commit during every snapshot.

HTTP paths and request validation remain in `server/backend.ts`. Main coverage: `test/git.test.ts` (including the shared six-process budget) and `test/git-fresh-runs.test.ts`.
