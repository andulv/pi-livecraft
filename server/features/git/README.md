# Git backend capability

`git.ts` reads repository state, recent history, single-file diffs (including the original and new file contents), and aggregate outgoing changed-file lists with per-file patches; commits, fast-forward pulls, and pushes workspace changes; resets eligible unpushed commits while preserving their changes; and reverts them with inverse commits. Its snapshot reports commits waiting to be pulled from the local tracked remote ref, but never fetches automatically. For a linked worktree, the snapshot also reports commits ahead of and behind the branch checked out in Git's primary worktree. These divergence counts use local refs only and do not fetch. It shells out to the installed Git executable in the validated working directory supplied by `server/backend.ts`. Snapshots list untracked files with unknown line counts instead of running Git for each one on page load; selecting a file still computes its diff on demand.

Unpushed commits in snapshots contain only hashes and subjects. `GET /api/git/commit-files?cwd=…&hash=…` validates a full commit hash and computes that commit's changed files when opened, rather than launching two Git commands per commit during every snapshot.

HTTP paths and request validation remain in `server/backend.ts`. Main coverage: `test/git.test.ts`.
