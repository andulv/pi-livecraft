import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import type { SyntaxHighlighterProps } from 'react-syntax-highlighter'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown'
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import type { CSSProperties } from 'react'

SyntaxHighlighter.registerLanguage('bash', bash)
SyntaxHighlighter.registerLanguage('csharp', csharp)
SyntaxHighlighter.registerLanguage('css', css)
SyntaxHighlighter.registerLanguage('javascript', javascript)
SyntaxHighlighter.registerLanguage('json', json)
SyntaxHighlighter.registerLanguage('markdown', markdown)
SyntaxHighlighter.registerLanguage('markup', markup)
SyntaxHighlighter.registerLanguage('typescript', typescript)

const syntaxTheme = {
  'code[class*="language-"]': { color: 'var(--ink)' },
  'pre[class*="language-"]': { color: 'var(--ink)' },
  comment: { color: 'var(--muted)', fontStyle: 'italic' },
  prolog: { color: 'var(--muted)' },
  doctype: { color: 'var(--muted)' },
  cdata: { color: 'var(--muted)' },
  punctuation: { color: 'var(--ink)' },
  property: { color: 'var(--danger)' },
  tag: { color: 'var(--danger)' },
  deleted: { color: 'var(--danger)' },
  boolean: { color: 'var(--warning-strong)' },
  number: { color: 'var(--warning-strong)' },
  constant: { color: 'var(--warning-strong)' },
  symbol: { color: 'var(--warning-strong)' },
  selector: { color: 'var(--success)' },
  'attr-name': { color: 'var(--success)' },
  string: { color: 'var(--success)' },
  char: { color: 'var(--success)' },
  builtin: { color: 'var(--success)' },
  inserted: { color: 'var(--success)' },
  operator: { color: 'var(--accent)' },
  entity: { color: 'var(--accent)' },
  url: { color: 'var(--accent)' },
  atrule: { color: 'var(--accent)' },
  'attr-value': { color: 'var(--success)' },
  keyword: { color: 'var(--accent)' },
  function: { color: 'var(--secondary)' },
  'class-name': { color: 'var(--secondary)' },
  regex: { color: 'var(--warning-strong)' },
  important: { color: 'var(--warning-strong)', fontWeight: 650 },
  variable: { color: 'var(--warning-strong)' },
  bold: { fontWeight: 650 },
  italic: { fontStyle: 'italic' },
} satisfies Record<string, CSSProperties>

type Props = Omit<SyntaxHighlighterProps, 'style'>

/** Highlights source with palette variables inherited from the active theme. */
export default function CodeHighlighter({ children, ...props }: Props) {
  return (
    <SyntaxHighlighter {...props} style={syntaxTheme}>
      {children}
    </SyntaxHighlighter>
  )
}
