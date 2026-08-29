import { useEffect, useState, type FormEvent } from 'react'
import { normalizeBrowserUrl } from './browser-url.ts'

/** Human-driven browser surface: an address bar and a sandboxed iframe. */
export function BrowserView({ onUrlCommit, url }: {
  onUrlCommit: (url: string) => void
  url: string
}) {
  const [address, setAddress] = useState(url)
  const [reloadNonce, setReloadNonce] = useState(0)

  useEffect(() => setAddress(url), [url])

  function navigate(event: FormEvent): void {
    event.preventDefault()
    const next = normalizeBrowserUrl(address)
    if (!next) {
      setAddress(url)
      return
    }
    if (next === url) setReloadNonce((current) => current + 1)
    onUrlCommit(next)
  }

  function reload(): void {
    if (!url) return
    setReloadNonce((current) => current + 1)
  }

  return (
    <div aria-label='Browser' className='browser-view'>
      <form className='browser-bar' onSubmit={navigate}>
        <input
          onChange={(event) => setAddress(event.target.value)}
          placeholder='Enter address — e.g. localhost:3000'
          spellCheck={false}
          type='text'
          value={address}
        />
        <button
          aria-label='Reload page'
          className='browser-reload'
          disabled={!url}
          onClick={reload}
          type='button'
        >
          ↻
        </button>
        {url && (
          <a
            aria-label='Open in new window'
            className='browser-external'
            href={url}
            rel='noreferrer'
            target='_blank'
          >
            ↗
          </a>
        )}
      </form>
      {url
        ? (
          <iframe
            className='browser-frame'
            key={`${url}#${reloadNonce}`}
            sandbox='allow-forms allow-same-origin allow-scripts'
            src={url}
            title={`Browser view of ${url}`}
          />
        )
        : (
          <p className='browser-hint'>
            Enter an address above to browse. Local development servers (for example{' '}
            <code>localhost:3000</code>) frame well; many public sites refuse embedding — use ↗ to
            open those in a real window.
          </p>
        )}
    </div>
  )
}
