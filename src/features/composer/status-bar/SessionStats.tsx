/** Displays cumulative session usage. Context pressure lives in ContextUsage. */
export function SessionStats(
  {
    assistantMessages,
    cachePercent,
    cost,
    inputTokens,
    outputTokens,
    toolCalls,
    userMessages,
  }: {
    assistantMessages: string
    cachePercent: string
    cost: string
    inputTokens: string
    outputTokens: string
    toolCalls: string
    userMessages: string
  },
) {
  return (
    <div className='composer-stats'>
      <span className='composer-stat-input'>
        <b>In</b>
        {inputTokens}
        <small className='composer-cache'>
          <span className='composer-cache-label'>cache</span> <i>{cachePercent}</i>
        </small>
      </span>
      <span>
        <b>Out</b>
        {outputTokens}
      </span>
      <span className='composer-message-counts'>
        <b>Messages</b>
        <small aria-label={`User messages: ${userMessages}`} title='User messages'>
          <i aria-hidden='true'>U</i>
          {userMessages}
        </small>
        <small aria-label={`Assistant messages: ${assistantMessages}`} title='Assistant messages'>
          <i aria-hidden='true'>A</i>
          {assistantMessages}
        </small>
      </span>
      <span>
        <b>Tools</b>
        {toolCalls}
      </span>
      <span>
        <b>Cost</b>
        {cost}
      </span>
    </div>
  )
}

/** Displays current context-window pressure as a compact two-line block in the
    composer's action row: label + tokens, meter + percent beneath. */
export function ContextUsage(
  { contextClass, contextTokens, contextPercent, contextPercentValue }: {
    contextClass: string
    contextTokens: string
    contextPercent: string
    contextPercentValue: number | null
  },
) {
  return (
    <span
      className={`composer-context composer-stats ${contextClass}`}
      title={contextPercentValue !== null
        ? `Context usage: ${contextTokens} (${contextPercent})`
        : undefined}
    >
      <span className='composer-context-label'>
        <b>Context</b>
        <small className='composer-context-tokens'>{contextTokens}</small>
      </span>
      {contextPercentValue !== null && (
        <span className='composer-context-meter'>
          <progress
            aria-label={`Context usage: ${contextTokens} (${contextPercent})`}
            max={100}
            value={contextPercentValue}
          />
          {contextPercent}
        </span>
      )}
    </span>
  )
}
