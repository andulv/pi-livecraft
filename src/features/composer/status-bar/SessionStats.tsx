/** Displays cumulative session usage and current context pressure. */
export function SessionStats(
  {
    assistantMessages,
    cachePercent,
    cost,
    contextClass,
    contextTokens,
    contextPercent,
    contextPercentValue,
    inputTokens,
    outputTokens,
    toolCalls,
    userMessages,
  }: {
    assistantMessages: string
    cachePercent: string
    cost: string
    contextClass: string
    contextTokens: string
    contextPercent: string
    contextPercentValue: number | null
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
      <span className={contextClass}>
        <b>Context</b>
        <small className='composer-context-tokens'>{contextTokens}</small>
        {contextPercentValue !== null && (
          <>
            {contextPercent}
            <progress
              aria-label={`Context usage: ${contextTokens} (${contextPercent})`}
              max={100}
              value={contextPercentValue}
            />
          </>
        )}
      </span>
    </div>
  )
}
