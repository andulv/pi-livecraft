import { useMemo, useState } from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'
import { isObject } from '../../../shared/is-object.ts'
import type {
  JsonObject,
  SessionEnvironmentSnapshot,
  SessionEnvironmentTool,
  SessionStats,
} from '../../../shared/types.ts'
import { formatTokens } from '../composer/composer-utils.ts'

/**
 * Shows what the selected session has loaded: context usage and files, tools, skills,
 * extensions, and prompt templates. Tools and context files arrive through the
 * session-environment extension payload; the command groups come from the snapshot.
 */
export function SessionEnvironmentWidget(
  {
    commands,
    environment,
    onRefresh,
    stats,
    state,
  }: {
    commands: readonly JsonObject[]
    environment: SessionEnvironmentSnapshot | null
    onRefresh: () => Promise<void>
    stats: SessionStats | null
    state: JsonObject | null
  },
) {
  const [refreshing, setRefreshing] = useState(false)
  const [toolFilter, setToolFilter] = useState('')
  const [expandedTool, setExpandedTool] = useState<string | null>(null)

  /** Keeps the button disabled until the manual refresh completes, whether success or error. */
  async function refresh(): Promise<void> {
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
    }
  }

  const model = readModel(state)
  const context = readContextUsage(stats)
  const tools = useMemo(() => environment?.tools ?? [], [environment])
  const filteredTools = useMemo(() => {
    const filter = toolFilter.trim().toLowerCase()
    if (!filter) return tools
    return tools.filter((tool) =>
      tool.name.toLowerCase().includes(filter)
      || tool.description?.toLowerCase().includes(filter)
    )
  }, [tools, toolFilter])
  const activeCount = tools.filter((tool) => tool.active).length
  const commandList = useMemo(() => readCommands(commands), [commands])
  const skills = useMemo(
    () => commandList.filter((command) => command.source === 'skill'),
    [commandList],
  )
  const prompts = useMemo(
    () => commandList.filter((command) => command.source === 'prompt'),
    [commandList],
  )
  const extensions = useMemo(() => groupExtensions(commandList), [commandList])
  /** Counts tools registered by each extension file, matched through the payload's sourceName. */
  const extensionToolCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const tool of tools) {
      if (tool.source !== 'extension' || !tool.sourceName) continue
      counts.set(tool.sourceName, (counts.get(tool.sourceName) ?? 0) + 1)
    }
    return counts
  }, [tools])
  const contextFiles = environment?.contextFiles ?? []

  return (
    <>
      <header className='widget-header environment-header'>
        <div>
          <strong>Environment</strong>
          <span>
            {environment?.updatedAt
              ? `Updated ${formatRelativeDate(environment.updatedAt)}`
              : 'No reading'}
          </span>
        </div>
        <Tooltip label='Refresh'>
          <button
            aria-label='Refresh session environment'
            className='git-refresh'
            disabled={refreshing || environment?.refreshing || environment?.sessionRequired}
            onClick={() => void refresh()}
            type='button'
          >
            ↻
          </button>
        </Tooltip>
      </header>
      <div
        aria-busy={refreshing || environment?.refreshing || false}
        className='widget-content environment-content'
      >
        <section className='environment-section'>
          <div className='environment-heading'>
            <h2>Context</h2>
            {context && <span className='environment-chip'>{context.label}</span>}
          </div>
          {model && (
            <div className='environment-kv'>
              <span className='environment-key'>Model</span>
              <span className='environment-value'>
                {model.label}
                {model.thinkingLevel && (
                  <span className='environment-chip accent'>thinking {model.thinkingLevel}</span>
                )}
              </span>
            </div>
          )}
          {context && (
            <>
              <div className='environment-kv'>
                <span className='environment-key'>Usage</span>
                <span className='environment-value'>
                  {context.label} · {Math.round(context.percent)}%
                </span>
              </div>
              <div className='environment-usage'>
                <span
                  className={context.tone
                    ? `environment-usage-fill ${context.tone}`
                    : 'environment-usage-fill'}
                  style={{ width: `${context.percent}%` }}
                />
              </div>
            </>
          )}
          <p className='environment-sub-label'>
            Context files · {contextFiles.length}
          </p>
          {contextFiles.length === 0
            ? <p className='environment-empty'>{emptyContextFilesText(environment)}</p>
            : contextFiles.map((file) => (
              <div className='environment-file-row' key={file.path}>
                <span aria-hidden='true' className='environment-file-glyph'>▤</span>
                <span className='environment-file-name'>{fileNameOf(file.path)}</span>
                <span className='environment-file-path'>{dirNameOf(file.path)}</span>
                <span className='environment-file-size'>{formatBytes(file.bytes)}</span>
              </div>
            ))}
        </section>

        <section className='environment-section'>
          <div className='environment-heading'>
            <h2>Tools</h2>
            {tools.length > 0 && (
              <span className='environment-chip'>{activeCount} active · {tools.length} loaded</span>
            )}
          </div>
          {tools.length === 0
            ? <p className='environment-empty'>{emptyToolsText(environment)}</p>
            : (
              <>
                <input
                  aria-label='Filter tools'
                  className='environment-filter'
                  onChange={(event) => setToolFilter(event.target.value)}
                  placeholder='Filter tools'
                  type='search'
                  value={toolFilter}
                />
                {filteredTools.length === 0 && (
                  <p className='environment-empty'>No tools match “{toolFilter.trim()}”.</p>
                )}
                {filteredTools.map((tool) => (
                  <ToolRow
                    expanded={expandedTool === tool.name}
                    key={tool.name}
                    onToggle={() =>
                      setExpandedTool((current) => current === tool.name ? null : tool.name)}
                    tool={tool}
                  />
                ))}
              </>
            )}
        </section>

        <section className='environment-section'>
          <div className='environment-heading'>
            <h2>Skills</h2>
            {skills.length > 0 && <span className='environment-chip'>{skills.length} loaded</span>}
          </div>
          {skills.length === 0
            ? <p className='environment-empty'>No skills loaded in the selected session.</p>
            : skills.map((skill) => (
              <div className='environment-item' key={skill.name}>
                <div className='environment-item-top'>
                  <span className='environment-item-name'>{skill.name.replace(/^skill:/, '')}</span>
                  {skill.location && (
                    <span className='environment-chip muted'>{skill.location}</span>
                  )}
                </div>
                {skill.description && <p className='environment-item-desc'>{skill.description}</p>}
                {skill.path && <p className='environment-item-path'>{skill.path}</p>}
              </div>
            ))}
        </section>

        <section className='environment-section'>
          <div className='environment-heading'>
            <h2>Extensions &amp; prompts</h2>
            {extensions.length + prompts.length > 0 && (
              <span className='environment-chip'>{extensions.length + prompts.length} loaded</span>
            )}
          </div>
          {extensions.length === 0 && prompts.length === 0 && (
            <p className='environment-empty'>No extensions or prompt templates loaded.</p>
          )}
          {extensions.map((extension) => (
            <div
              className='environment-item'
              key={extension.path || extension.commands.join(',')}
            >
              <div className='environment-item-top'>
                <span className='environment-item-name'>{fileNameOf(extension.path)}</span>
                {extension.commands.map((name) => (
                  <span className='environment-chip muted' key={name}>/{name}</span>
                ))}
                {toolCountForExtension(extension, extensionToolCounts) > 0 && (
                  <span className='environment-chip secondary'>
                    {toolCountForExtension(extension, extensionToolCounts)}{' '}
                    tool{toolCountForExtension(extension, extensionToolCounts) > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          ))}
          {prompts.map((prompt) => (
            <div className='environment-item' key={prompt.name}>
              <div className='environment-item-top'>
                <span className='environment-item-name'>
                  {fileNameOf(prompt.path ?? prompt.name)}
                </span>
                <span className='environment-chip muted'>/{prompt.name}</span>
                {prompt.location && (
                  <span className='environment-chip muted'>{prompt.location}</span>
                )}
              </div>
              {prompt.description && <p className='environment-item-desc'>{prompt.description}</p>}
            </div>
          ))}
        </section>
      </div>
    </>
  )
}

/** One tool row; rows with parameters expand into a schema summary on click. */
function ToolRow(
  { expanded, onToggle, tool }: {
    expanded: boolean
    onToggle: () => void
    tool: SessionEnvironmentTool
  },
) {
  const expandable = (tool.params?.length ?? 0) > 0
  const badges = (
    <>
      {tool.source === 'builtin' && <span className='environment-chip muted'>built-in</span>}
      {tool.source === 'extension' && (
        <span className='environment-chip secondary'>
          ext ·{' '}
          {tool.sourceName ? fileNameOf(tool.sourceName).replace(/\.(ts|js)$/, '') : 'extension'}
        </span>
      )}
      {tool.source === 'sdk' && <span className='environment-chip muted'>sdk</span>}
      {!tool.active && <span className='environment-chip warn'>off</span>}
    </>
  )
  return (
    <div className={tool.active ? 'environment-tool-row' : 'environment-tool-row off'}>
      {expandable
        ? (
          <button
            aria-expanded={expanded}
            className='environment-tool-toggle'
            onClick={onToggle}
            type='button'
          >
            <span className='environment-tool-name'>{tool.name}</span>
            <span className='environment-tool-desc'>{tool.description ?? ''}</span>
            {badges}
          </button>
        )
        : (
          <div className='environment-tool-line'>
            <span className='environment-tool-name'>{tool.name}</span>
            <span className='environment-tool-desc'>{tool.description ?? ''}</span>
            {badges}
          </div>
        )}
      {expanded && tool.params && (
        <div className='environment-tool-params'>
          {tool.params.map((param) => (
            <div key={param.name}>
              <b>{param.name}</b>
              {param.type && <span className='environment-param-type'>: {param.type}</span>}
              {!param.required && <span className='environment-param-optional'>(optional)</span>}
              {param.description && <span>— {param.description}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface CommandInfo {
  name: string
  description?: string
  source?: string
  location?: string
  path?: string
}

function readCommands(commands: readonly JsonObject[]): CommandInfo[] {
  return commands.flatMap((command) => {
    const name = typeof command.name === 'string' ? command.name : ''
    if (!name) return []
    const entry: CommandInfo = { name }
    if (typeof command.description === 'string' && command.description)
      entry.description = command.description
    if (typeof command.source === 'string') entry.source = command.source
    if (typeof command.location === 'string') entry.location = command.location
    if (typeof command.path === 'string') entry.path = command.path
    return [entry]
  })
}

interface ExtensionGroup {
  path: string
  commands: string[]
}

/** Groups extension commands by their source file. */
function groupExtensions(commandList: CommandInfo[]): ExtensionGroup[] {
  const groups = new Map<string, ExtensionGroup>()
  for (const command of commandList) {
    if (command.source !== 'extension') continue
    const key = command.path ?? ''
    const group = groups.get(key) ?? { path: key, commands: [] }
    group.commands.push(command.name)
    groups.set(key, group)
  }
  return [...groups.values()]
}

function toolCountForExtension(
  extension: ExtensionGroup,
  counts: ReadonlyMap<string, number>,
): number {
  return extension.path ? counts.get(fileNameOf(extension.path)) ?? 0 : 0
}

function readModel(state: JsonObject | null): { label: string; thinkingLevel?: string } | null {
  const model = isObject(state) && isObject(state.model) ? state.model : undefined
  if (!model) return null
  const provider = typeof model.provider === 'string' ? model.provider : ''
  const name = typeof model.name === 'string' && model.name
    ? model.name
    : typeof model.id === 'string'
    ? model.id
    : ''
  if (!name) return null
  const thinkingLevel = isObject(state) && typeof state.thinkingLevel === 'string'
    ? state.thinkingLevel
    : undefined
  return {
    label: provider ? `${provider} · ${name}` : name,
    ...(thinkingLevel ? { thinkingLevel } : {}),
  }
}

function readContextUsage(
  stats: SessionStats | null,
): { label: string; percent: number; tone: string } | null {
  const usage = stats?.contextUsage
  if (typeof usage?.tokens !== 'number' || typeof usage.contextWindow !== 'number') return null
  const percent = typeof usage.percent === 'number'
    ? usage.percent
    : usage.contextWindow > 0
    ? usage.tokens / usage.contextWindow * 100
    : 0
  const clamped = Math.max(0, Math.min(100, percent))
  // Thresholds match the composer's context-pressure colouring.
  const tone = clamped >= 40 ? 'danger' : clamped >= 30 ? 'warning' : ''
  return {
    label: `${formatTokens(usage.tokens)} / ${formatTokens(usage.contextWindow)}`,
    percent: clamped,
    tone,
  }
}

function emptyToolsText(environment: SessionEnvironmentSnapshot | null): string {
  if (environment?.sessionRequired) return 'Open a Pi session to read the environment.'
  if (!environment?.updatedAt) return 'No reading yet. Refresh once a session is open.'
  return 'No tools reported.'
}

function emptyContextFilesText(environment: SessionEnvironmentSnapshot | null): string {
  if (!environment?.updatedAt) return 'Included in the next environment refresh.'
  return 'No context files loaded.'
}

function formatRelativeDate(timestamp: number): string {
  const elapsedMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (elapsedMinutes < 1) return 'just now'
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`
  return new Intl.DateTimeFormat(navigator.language, { dateStyle: 'short', timeStyle: 'short' })
    .format(timestamp)
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${Math.round(bytes / 104_857.6) / 10} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 102.4) / 10} KB`
  return `${bytes} B`
}

function fileNameOf(path: string | undefined): string {
  if (!path) return 'unknown'
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index >= 0 ? path.slice(index + 1) : path
}

function dirNameOf(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index > 0 ? path.slice(0, index) : path
}
