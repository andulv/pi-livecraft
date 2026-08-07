import { useRef, type ReactNode } from 'react'
import { CopyButton } from './CopyButton.tsx'

interface CodeBlockProps {
  children: ReactNode
  onError?: (cause: unknown) => void
}

/** Adds a contextual copy action to a preformatted block without changing its content. */
export function CopyablePre({ children, onError }: CodeBlockProps) {
  const ref = useRef<HTMLPreElement>(null)
  return (
    <pre className='conversation-code-block' ref={ref}>
      {children}
      <CodeBlockActions onError={onError} value={() => ref.current?.textContent ?? ''} />
    </pre>
  )
}

function CodeBlockActions(
  { onError, value }: { onError?: (cause: unknown) => void; value: () => string },
) {
  return (
    <span className='conversation-code-actions' onClick={(event) => event.stopPropagation()}>
      <CopyButton label='Copy code' onError={onError} value={value} />
    </span>
  )
}
