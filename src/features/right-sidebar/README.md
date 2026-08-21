# Right sidebar

The right sidebar keeps workspace tools close without mixing their behavior. Its rail separates current-session widgets (index, analysis, environment), current-workspace tools (Git, folder, terminal, VS Code), and global quotas with accessible groups and compact dividers. `RightSidebar.tsx` composes the rail, active panel, and accessible resizing; `App.tsx` owns the active widget and width because they affect the whole layout.

## Adding a widget

Follow the [step-by-step guide](/docs/HOW-TO-WIDGET.md). Return here for the sidebar-specific contracts below.

Each widget automatically receives an **Open…** palette command and an assignable shortcut via `rightWidgetDefinitions`. Rendering remains explicit: do not introduce a component registry.

Width and active widget are stored in `pi-livecraft.right-sidebar-width` and `pi-livecraft.right-sidebar-widget`. Legacy Git sidebar keys are read only as migration fallbacks. Width stays between 240 and 720 px.

Panel contracts: [session index](/src/features/session-index/README.md), [Git](/src/features/git/README.md), [quotas](/src/features/quotas/README.md), [session analysis](/src/features/session-analysis/README.md), and [session environment](/src/features/session-environment/README.md). [Terminal](/src/features/terminal/README.md) is an immediate rail action rather than a panel. The session index is the default when no sidebar choice has been saved; an explicit collapsed choice is still respected. Registry and width behavior are covered by `test/shortcuts.test.ts` and `test/git-sidebar.test.ts`.
