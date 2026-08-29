# Workspace files

`FileExplorer.tsx` browses the selected workspace's files through the files API, lazily loading directory children. `FileContentPane.tsx` previews files opened from the explorer beside the conversation: one open-file tab strip, read-only content, and per-file loading/error states cached per workspace. Markdown files (`.md`, `.markdown`) render through the shared conversation `Markdown` component with frontmatter support; a header toggle switches between rendered and raw text views. File content is never edited here.

`App.tsx` owns the pane width because it sizes the workspace grid's second column via `--file-pane-width`. The width is dragged on the pane's left separator (pointer or keyboard, mirroring the sidebar handles), persists in `pi-livecraft.file-pane-width`, and stays between 280 and 960 px (`file-pane-width.ts`). Below 900 px the workspace stacks and the separator hides. Width bounds are covered by `test/file-pane-width.test.ts`.
