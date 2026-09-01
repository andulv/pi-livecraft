import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { livecraftBrowserEnv } from '../server/pi-process.ts'
import { browserDebugPortFor, primaryBrowserId } from '../shared/browser-port.ts'

test('describes the workspace browser for agent tooling', () => {
  const env = livecraftBrowserEnv('/workspace/a')
  const port = browserDebugPortFor('/workspace/a', primaryBrowserId)
  assert.equal(env.LIVECRAFT_BROWSER_URL, `http://127.0.0.1:${port}`)
  assert.equal(env.PLAYWRIGHT_CLI_SESSION, `livecraft-${port}`)

  const other = livecraftBrowserEnv('/workspace/b')
  assert.notEqual(env.PLAYWRIGHT_CLI_SESSION, other.PLAYWRIGHT_CLI_SESSION)
})

test('ships the shared-browser skill with valid frontmatter and attach flow', async () => {
  const content = await readFile(
    new URL('../pi-skills/livecraft-browser/SKILL.md', import.meta.url),
    'utf8',
  )
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)
  assert.ok(frontmatter, 'SKILL.md must start with YAML frontmatter')
  assert.match(frontmatter[1], /^name:\s*livecraft-browser\s*$/m)
  assert.match(frontmatter[1], /^description:\s*\S/m)
  // The attach flow must teach the injected environment and safe disconnect.
  assert.match(content, /playwright-cli attach --cdp="\$LIVECRAFT_BROWSER_URL"/)
  assert.match(content, /PLAYWRIGHT_CLI_SESSION/)
  assert.match(content, /playwright-cli detach/)
  assert.doesNotMatch(content, /playwright-cli close-all/)
  assert.doesNotMatch(content, /playwright-cli kill-all/)
})
