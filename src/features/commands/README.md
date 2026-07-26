# Commands

The command registry is the shared source for the palette, global keyboard handling, and editable shortcuts. `App.tsx` supplies execution and availability because commands act on cross-cutting state.

## Adding a command

Follow the [step-by-step guide](/docs/HOW-TO-PALETTE-COMMAND.md). Return here for the registry rules below.

Sidebar widgets are the exception to step 1: adding their identity to `rightWidgetDefinitions` automatically creates an `open-widget-*` command. It appears in the palette and Settings without a separate registration. Add custom availability in `App.tsx` only when the widget itself is conditional.

Read the [right sidebar guide](/src/features/right-sidebar/README.md) only when adding or rendering a widget.
