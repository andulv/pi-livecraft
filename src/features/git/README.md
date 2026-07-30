# Git widget

The Git widget keeps the state of the current repository beside the conversation. It appears when the selected workspace is a Git repository, and its rail badge counts modified files plus commits waiting to be pushed.

## What it shows

- the current branch and whether the working tree is clean;
- added, modified, deleted, and renamed files, with line counts when Git provides them;
- a line-numbered textual diff for added and modified files;
- commits ahead of the tracked remote branch, including their subject and changed files;
- action errors without closing the panel or losing the current selection.

Deleted and renamed files remain visible but are not selectable because the widget does not request a textual diff for them.

## What you can do

- refresh repository state manually;
- commit all current changes with a message;
- push every commit ahead of the tracked branch;
- discard one file or all uncommitted changes;
- reset the latest unpushed commit while keeping its changes in the working tree;
- revert any listed unpushed commit by creating an inverse commit.

Discard, reset, and revert ask for confirmation. Discard is destructive and can delete new files. Failed commands stay visible in the widget so the conversation can remain in context.

## Ownership and data flow

`App.tsx` loads and mutates Git state through `src/api.ts`. `GitWidget` owns only its selected file, commit message, busy state, and currently displayed diff. Public response shapes live in `shared/types.ts`.

The [Git backend capability](/server/features/git/README.md) runs the validated Git commands in the selected workspace. Unified diff parsing remains pure in `git-diff.ts`.

Focused coverage: `test/git-sidebar.test.ts` and `test/git.test.ts`.
