# Git widget

The Git widget keeps the state of the current repository beside the conversation. It renders as the Git tab of the workspace sidebar (alongside Sessions and Files) and appears whenever the selected workspace provides repository state; workspaces without one show an empty state instead.

## What it shows

- the current branch and whether the working tree is clean;
- a count on Pull when its local tracking ref reports commits waiting;
- added, modified, deleted, and renamed files, with line counts when Git provides them;
- a line-numbered textual diff for added and modified files;
- commits ahead of the tracked remote branch, with their subjects in the initial snapshot and changed files loaded only when a commit is expanded, plus an aggregate changed-file list against the integration branch;
- the 20 most recent commits reachable from `HEAD`, shown as compact summaries;
- action errors without closing the panel or losing the current selection.

Deleted files open a diff with an unavailable New view; renamed files remain visible but are not selectable.

## What you can do

- switch changed-file lists between flat and expanded tree views from the Git options menu; both views virtualize visible file rows with React Arborist, so large change sets do not mount every file at once;
- refresh repository state manually without contacting the remote;
- commit all current changes with a message;
- pull the tracked branch with `--ff-only`, which never creates a merge commit;
- list and open per-file aggregate diffs for all outgoing commits against the tracked branch (or a linked worktree's primary branch);
- push every commit ahead of the tracked branch;
- discard one file or all uncommitted changes;
- reset the latest unpushed commit while keeping its changes in the working tree;
- revert any listed unpushed commit by creating an inverse commit.

Discard, reset, and revert ask for confirmation. Discard is destructive and can delete new files. Failed commands stay visible in the widget so the conversation can remain in context.

## Ownership and data flow

`App.tsx` loads and mutates Git state through `src/api.ts`. It refreshes after a Pi tool finishes only when `toolMayChangeGitState` (`git-refresh.ts`) allows it: Pi's read-only built-in tools (`read`, `grep`, `find`, `ls`) never trigger a refresh. Concurrent refreshes from several tabs share one server-side snapshot run; see the [data-flow guide](/docs/DATA-FLOW.md). `GitWidget` owns its commit message, busy state, action errors, and on-demand commit-file cache. `GitFileList.tsx` renders virtualized Changes and aggregate outgoing files in both display modes; individual commit details remain on demand. Selecting an eligible file opens its diff in the shared file viewer. Public response shapes live in `shared/types.ts`.

The [Git backend capability](/server/features/git/README.md) runs the validated Git commands in the selected workspace. Unified diff parsing remains pure in `git-diff.ts`.

Focused coverage: `test/git-sidebar.test.ts` and `test/git.test.ts`.
