import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { movePiSession } from '../server/pi-session-move.ts'
import { workspaceSessionDir } from '../server/pi-session-directory.ts'

interface Fixture {
  directory: string
  source: string
  target: string
}

async function fixture(): Promise<Fixture> {
  return {
    directory: await mkdtemp(join(tmpdir(), 'pi-move-sessions-')),
    source: await mkdtemp(join(tmpdir(), 'pi-move-source-')),
    target: await mkdtemp(join(tmpdir(), 'pi-move-target-')),
  }
}

/** Writes a minimal session file with a header line and one user message. */
async function writeSession(path: string, cwd: string, id = 'session-id'): Promise<void> {
  const header = { type: 'session', id, timestamp: '2024-01-01T00:00:00.000Z', cwd }
  const message = {
    type: 'message',
    timestamp: '2024-01-01T00:00:01.000Z',
    message: { role: 'user', content: 'hello world' },
  }
  await writeFile(path, `${JSON.stringify(header)}\n${JSON.stringify(message)}\n`)
}

test('relocates the session file and rewrites its header cwd', async () => {
  const { directory, source, target } = await fixture()
  const sourceDir = workspaceSessionDir(source, directory)
  await mkdir(sourceDir, { recursive: true })
  const sourcePath = join(sourceDir, 'session-id.jsonl')
  await writeSession(sourcePath, source)

  const moved = await movePiSession(sourcePath, target, directory)

  assert.equal(moved.cwd, target)
  assert.equal(moved.sessionPath, join(workspaceSessionDir(target, directory), 'session-id.jsonl'))
  assert.equal(existsSync(sourcePath), false)

  const content = await readFile(moved.sessionPath, 'utf8')
  const [headerLine, messageLine] = content.split('\n')
  assert.equal(JSON.parse(headerLine).cwd, target)
  // The rest of the file is preserved verbatim.
  assert.equal(JSON.parse(messageLine).message.content, 'hello world')
})

test('rejects moving a session into the worktree it already belongs to', async () => {
  const { directory, source } = await fixture()
  const sourceDir = workspaceSessionDir(source, directory)
  await mkdir(sourceDir, { recursive: true })
  const sourcePath = join(sourceDir, 'session-id.jsonl')
  await writeSession(sourcePath, source)

  await assert.rejects(
    () => movePiSession(sourcePath, source, directory),
    /already belongs to this worktree/,
  )
  assert.equal(existsSync(sourcePath), true)
})

test('refuses to overwrite an existing session file in the target worktree', async () => {
  const { directory, source, target } = await fixture()
  const sourceDir = workspaceSessionDir(source, directory)
  const targetDir = workspaceSessionDir(target, directory)
  await mkdir(sourceDir, { recursive: true })
  await mkdir(targetDir, { recursive: true })
  const sourcePath = join(sourceDir, 'session-id.jsonl')
  await writeSession(sourcePath, source)
  await writeSession(join(targetDir, 'session-id.jsonl'), target, 'other')

  await assert.rejects(
    () => movePiSession(sourcePath, target, directory),
    /already exists in the target worktree/,
  )
  assert.equal(existsSync(sourcePath), true)
})
