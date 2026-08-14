import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import test from 'node:test'
import {
  listRecentPiSessions,
  resolvePiSessionDirectory,
  workspaceSessionDir,
} from '../server/pi-session-store.ts'

async function fixture(): Promise<{ directory: string; workspace: string }> {
  return {
    directory: await mkdtemp(join(tmpdir(), 'pi-sessions-')),
    workspace: await mkdtemp(join(tmpdir(), 'pi-workspace-')),
  }
}

test('resolves Pi session storage with Pi environment precedence', () => {
  const homeDirectory = join('home', 'user')
  const agentDirectory = join('infrastructure', '.pi', 'agent')
  const sessionDirectory = join('custom', 'sessions')

  assert.equal(
    resolvePiSessionDirectory({
      PI_CODING_AGENT_SESSION_DIR: sessionDirectory,
      PI_CODING_AGENT_DIR: agentDirectory,
    }, homeDirectory),
    sessionDirectory,
  )
  assert.equal(
    resolvePiSessionDirectory({ PI_CODING_AGENT_DIR: agentDirectory }, homeDirectory),
    join(agentDirectory, 'sessions'),
  )
  assert.equal(
    resolvePiSessionDirectory({}, homeDirectory),
    join(homeDirectory, '.pi', 'agent', 'sessions'),
  )
})

test('encodes the workspace folder name the way Pi does', () => {
  const base = join('data', 'pi-sessions')
  // Absolute path: the leading separator is dropped and each remaining separator becomes `-`.
  assert.equal(
    workspaceSessionDir('/home/anders/source/agent/pi-livecraft', base),
    join(base, '--home-anders-source-agent-pi-livecraft--'),
  )
  // Linked worktrees and dotted segments keep their characters.
  assert.equal(
    workspaceSessionDir('/home/anders/source/agent/.worktrees/plan150', base),
    join(base, '--home-anders-source-agent-.worktrees-plan150--'),
  )
  // Repeated or trailing separators do not add extra dashes.
  assert.equal(
    workspaceSessionDir('/home/anders//projects/x/', base),
    join(base, '--home-anders-projects-x--'),
  )
})

test('sorts canonical Pi sessions by their last message timestamp', async () => {
  const { directory, workspace } = await fixture()
  const sessions = workspaceSessionDir(workspace, directory)
  await mkdir(sessions, { recursive: true })
  await writeSession(
    join(sessions, 'older.jsonl'),
    `${workspace}${sep}`,
    'older',
    'Older session',
    undefined,
    '2026-07-19T11:00:00.000Z',
  )
  await writeSession(
    join(sessions, 'newer.jsonl'),
    workspace,
    'newer',
    'Newer session',
    'Renamed session',
  )
  const recent = await listRecentPiSessions(workspace, directory)
  assert.deepEqual(recent.map(({ id, name, cwd }) => ({ id, name, cwd })), [
    { id: 'older', name: 'Older session', cwd: workspace },
    { id: 'newer', name: 'Renamed session', cwd: workspace },
  ])
  assert.deepEqual(recent.map(({ sessionPath }) => sessionPath), [
    await realpath(join(sessions, 'older.jsonl')),
    await realpath(join(sessions, 'newer.jsonl')),
  ])
})

test('returns every session in the canonical working directory and omits stale cwd records', async () => {
  const { directory, workspace } = await fixture()
  const folder = workspaceSessionDir(workspace, directory)
  await mkdir(folder, { recursive: true })
  await Promise.all(
    Array.from({ length: 11 }, (_, index) =>
      writeSession(
        join(folder, `${index}.jsonl`),
        workspace,
        String(index),
        `Session ${index}`,
      )),
  )
  await writeSession(join(folder, 'stale.jsonl'), join(directory, 'missing'), 'stale', 'Stale')
  assert.equal((await listRecentPiSessions(workspace, directory)).length, 11)
})

test('uses the first non-command user prompt and hides sessions without messages', async () => {
  const { directory, workspace } = await fixture()
  const folder = workspaceSessionDir(workspace, directory)
  await mkdir(folder, { recursive: true })
  await writeFile(
    join(folder, 'unnamed.jsonl'),
    [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'unnamed',
        timestamp: '2026-07-19T10:00:00.000Z',
        cwd: workspace,
      }),
      JSON.stringify({ type: 'message', message: { role: 'user', content: '/agent' } }),
      JSON.stringify({
        type: 'message',
        message: { role: 'user', content: 'One two three four five six seven eight nine' },
      }),
    ]
      .join('\n'),
  )
  await writeFile(
    join(folder, 'empty.jsonl'),
    [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'empty',
        timestamp: '2026-07-19T10:00:00.000Z',
        cwd: workspace,
      }),
      JSON.stringify({ type: 'session_info', name: 'New session' }),
    ]
      .join('\n'),
  )
  const recent = await listRecentPiSessions(workspace, directory)
  assert.equal(recent.length, 1)
  assert.equal(recent[0].name, 'One two three four five six seven eight…')
})

test('finds a rename buried deep in a large session', async () => {
  const { directory, workspace } = await fixture()
  const folder = workspaceSessionDir(workspace, directory)
  await mkdir(folder, { recursive: true })
  // The rename sits more than 8 KB from both ends of the file, so neither a head nor a
  // tail window can see it; the backwards scan must walk through the padding to reach it.
  const padding = (timestamp: string) =>
    JSON.stringify({
      type: 'message',
      timestamp,
      message: { role: 'assistant', content: 'x'.repeat(20 * 1024) },
    })
  await writeFile(
    join(folder, 'buried.jsonl'),
    [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'buried',
        timestamp: '2026-07-19T09:00:00.000Z',
        cwd: workspace,
      }),
      padding('2026-07-19T09:00:00.000Z'),
      JSON.stringify({ type: 'session_info', name: 'Renamed session' }),
      padding('2026-07-19T10:00:00.000Z'),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-07-19T11:00:00.000Z',
        message: { role: 'user', content: 'final prompt' },
      }),
    ]
      .join('\n') + '\n',
  )
  const recent = await listRecentPiSessions(workspace, directory)
  assert.equal(recent.length, 1)
  assert.equal(recent[0].name, 'Renamed session')
  assert.equal(recent[0].updatedAt, Date.parse('2026-07-19T11:00:00.000Z'))
})

test('reads a session_info line that spans the head boundary', async () => {
  const { directory, workspace } = await fixture()
  const folder = workspaceSessionDir(workspace, directory)
  await mkdir(folder, { recursive: true })
  const header = JSON.stringify({
    type: 'session',
    version: 3,
    id: 'boundary',
    timestamp: '2026-07-19T09:00:00.000Z',
    cwd: workspace,
  })
  // Size an unparseable filler line so the session_info entry starts 30 bytes before
  // the 8 KB head boundary and is split across the head chunk and the backwards scan.
  const fillerLength = 8192 - 30 - header.length - 2
  await writeFile(
    join(folder, 'boundary.jsonl'),
    [
      header,
      'x'.repeat(fillerLength),
      JSON.stringify({ type: 'session_info', name: 'Boundary name' }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-07-19T10:00:00.000Z',
        message: { role: 'user', content: 'final prompt' },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-07-19T11:00:00.000Z',
        message: { role: 'assistant', content: 'y'.repeat(20 * 1024) },
      }),
    ]
      .join('\n') + '\n',
  )
  const recent = await listRecentPiSessions(workspace, directory)
  assert.equal(recent.length, 1)
  assert.equal(recent[0].name, 'Boundary name')
  assert.equal(recent[0].updatedAt, Date.parse('2026-07-19T11:00:00.000Z'))
})

test('falls back to the first prompt when the latest session_info clears the name', async () => {
  const { directory, workspace } = await fixture()
  const folder = workspaceSessionDir(workspace, directory)
  await mkdir(folder, { recursive: true })
  await writeFile(
    join(folder, 'cleared.jsonl'),
    [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'cleared',
        timestamp: '2026-07-19T10:00:00.000Z',
        cwd: workspace,
      }),
      JSON.stringify({ type: 'session_info', name: 'Old name' }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-07-19T10:00:00.000Z',
        message: { role: 'user', content: 'the first prompt here' },
      }),
      JSON.stringify({ type: 'session_info', name: '' }),
    ]
      .join('\n') + '\n',
  )
  const recent = await listRecentPiSessions(workspace, directory)
  assert.equal(recent.length, 1)
  assert.equal(recent[0].name, 'the first prompt here')
})

async function writeSession(
  path: string,
  cwd: string,
  id: string,
  name: string,
  renamedName?: string,
  lastMessageTimestamp?: string,
): Promise<void> {
  const timestamp = id === 'newer' ? '2026-07-19T10:00:00.000Z' : '2026-07-19T09:00:00.000Z'
  await writeFile(
    path,
    [
      JSON.stringify({ type: 'session', version: 3, id, timestamp, cwd }),
      JSON.stringify({ type: 'session_info', name }),
      JSON.stringify({
        type: 'message',
        timestamp: lastMessageTimestamp ?? timestamp,
        message: { role: 'user', content: name },
      }),
      ...(renamedName ? [JSON.stringify({ type: 'session_info', name: renamedName })] : []),
    ]
      .join('\n'),
  )
}
