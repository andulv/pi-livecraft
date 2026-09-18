/**
 * Declarative registry of Pi Livecraft's browser-stored preferences. Both the
 * Livecraft settings sections render from this list, so a new preference appears
 * by adding one entry rather than editing the renderer.
 *
 * Values live in `localStorage` under the `pi-livecraft.` prefix. Two Pi
 * session-status keys (`pi-livecraft.quotas`, `pi-livecraft.environment`) are not
 * stored preferences and are intentionally absent.
 */

/** A user-facing preference or a piece of remembered layout state. */
export interface LivecraftPreference {
  /** Full `localStorage` key. */
  key: string
  label: string
  description?: string
  /** `preferences` renders an editable control; `layout` renders a Reset row. */
  section: 'preferences' | 'layout'
}

/** Every `pi-livecraft.` key surfaced in the Livecraft settings tab. */
export const livecraftPreferences: LivecraftPreference[] = [
  {
    key: 'pi-livecraft.conversation-view',
    label: 'Conversation view',
    description: 'How much detail the transcript shows.',
    section: 'preferences',
  },
  {
    key: 'pi-livecraft.detailed-view',
    label: 'Detailed view',
    description: 'Show tool calls and metadata inline.',
    section: 'preferences',
  },
  {
    key: 'pi-livecraft.pinned-models',
    label: 'Pinned models',
    description: 'Favourite models in the composer menu.',
    section: 'preferences',
  },
  {
    key: 'pi-livecraft.browser-viewport',
    label: 'Browser viewport preset',
    description: 'Viewport size for the viewer-pane browser.',
    section: 'preferences',
  },
  {
    key: 'pi-livecraft.workspace-sidebar-width',
    label: 'Workspace sidebar width',
    section: 'layout',
  },
  {
    key: 'pi-livecraft.workspace-sidebar-collapsed',
    label: 'Workspace sidebar collapsed',
    section: 'layout',
  },
  {
    key: 'pi-livecraft.git-sidebar-width',
    label: 'Git sidebar width',
    section: 'layout',
  },
  {
    key: 'pi-livecraft.git-sidebar-collapsed',
    label: 'Git sidebar collapsed',
    section: 'layout',
  },
  {
    key: 'pi-livecraft.right-sidebar-width',
    label: 'Right sidebar width',
    section: 'layout',
  },
  {
    key: 'pi-livecraft.right-sidebar-widget',
    label: 'Last right-sidebar widget',
    section: 'layout',
  },
  {
    key: 'pi-livecraft.file-pane-share',
    label: 'File pane split',
    section: 'layout',
  },
  {
    key: 'pi-livecraft.workspace-session-selection',
    label: 'Selected session per workspace',
    description: 'The last selected session for each workspace.',
    section: 'layout',
  },
  {
    key: 'pi-livecraft.workspace-viewer-state',
    label: 'Workspace viewer tabs',
    description: 'Open file tabs, active view, and browser/terminal state per workspace.',
    section: 'layout',
  },
]

/** The `localStorage` prefix that scopes every Livecraft preference. */
export const LIVECRAFT_PREFIX = 'pi-livecraft.'
