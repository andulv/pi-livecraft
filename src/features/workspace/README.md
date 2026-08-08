# Workspace and sessions

`useWorkspaceSessions` owns project/workspace selection and the session lists shown by the application. It coordinates initial selection, refreshes, creation, reopening, renaming and closing, optimistic naming, pending UI requests, and local persistence of projects and completed sessions. A project is a local Git repository; its main checkout and linked worktrees are the selectable workspaces.

Keep session-list reconciliation and workspace/session persistence in this controller. `App.tsx` supplies cross-feature callbacks, such as clearing feature state when the workspace changes or preparing an initial composer draft; it should not duplicate the controller's state.

Repository browsing and Git validation remain in `ProjectPicker`. Workspace paths accept both `~/...` and Windows `~\...`; completion preserves the separator style the user typed. Project persistence lives in `projects.ts`; pure session-list rules live in `sidebar-sessions.ts`.
