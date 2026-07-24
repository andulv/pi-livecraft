# Git backend capability

`git.ts` reads repository state and diffs, commits and pushes workspace changes, resets eligible unpushed commits while preserving their changes, and reverts them with inverse commits. It shells out to the installed Git executable in the validated working directory supplied by `server/backend.ts`.

HTTP paths and request validation remain in `server/backend.ts`. Main coverage: `test/git.test.ts`.
