import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { parseMarkdownFrontmatter } from './markdown-frontmatter.ts'

/** Renders conversation Markdown and optionally exposes validated front matter as a table. */
export function Markdown(
  { children, renderFrontmatter = false }: { children: string; renderFrontmatter?: boolean },
) {
  const frontmatter = renderFrontmatter ? parseMarkdownFrontmatter(children) : null
  const body = frontmatter?.body ?? children

  return (
    <>
      {frontmatter && frontmatter.entries.length > 0 && (
        <table className='tool-call-frontmatter'>
          <thead>
            <tr>
              <th>Property</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {frontmatter.entries.map(({ key, value }) => (
              <tr key={key}>
                <th scope='row'>{key}</th>
                <td>
                  <code className='tool-call-frontmatter-value'>{value}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </>
  )
}
