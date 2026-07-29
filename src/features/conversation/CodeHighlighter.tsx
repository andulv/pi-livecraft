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
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'

SyntaxHighlighter.registerLanguage('bash', bash)
SyntaxHighlighter.registerLanguage('csharp', csharp)
SyntaxHighlighter.registerLanguage('css', css)
SyntaxHighlighter.registerLanguage('javascript', javascript)
SyntaxHighlighter.registerLanguage('json', json)
SyntaxHighlighter.registerLanguage('markdown', markdown)
SyntaxHighlighter.registerLanguage('markup', markup)
SyntaxHighlighter.registerLanguage('typescript', typescript)

type Props = Omit<SyntaxHighlighterProps, 'style'> & { darkMode: boolean }

export default function CodeHighlighter({ children, darkMode, ...props }: Props) {
  return (
    <SyntaxHighlighter {...props} style={darkMode ? oneDark : oneLight}>
      {children}
    </SyntaxHighlighter>
  )
}
