# Git backend capability

`git.ts` reads repository state and diffs, commits and pushes workspace changes, and resets eligible unpushed commits while preserving their changes. It shells out to the installed Git executable in the validated working directory supplied by `server/backend.ts`.

HTTP paths and request validation remain in `server/backend.ts`. Main coverage: `test/git.test.ts`.
