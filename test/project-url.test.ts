import assert from 'node:assert/strict'
import test from 'node:test'
import {
  projectIdFromLocation,
  projectPageUrl,
  projectUrlState,
} from '../src/features/workspace/project-url.ts'

test('extracts the project id from the path form', () => {
  assert.equal(projectIdFromLocation('/project/project-abc123', ''), 'project-abc123')
  assert.equal(
    projectIdFromLocation('/project/project-abc123', '?workspace=%2Fx'),
    'project-abc123',
  )
  assert.equal(projectIdFromLocation('/', '?project=project-abc123'), 'project-abc123')
  assert.equal(projectIdFromLocation('/', ''), null)
})

test('extracts workspace and session from query parameters', () => {
  assert.deepEqual(projectUrlState('/project/project-abc123', ''), {
    workspacePath: undefined,
    sessionPath: undefined,
  })
  assert.deepEqual(projectUrlState('/project/project-abc123', '?workspace=%2Fhome%2Fu%2Fp'), {
    workspacePath: '/home/u/p',
    sessionPath: undefined,
  })
  assert.deepEqual(
    projectUrlState(
      '/project/project-abc123',
      '?workspace=%2Fhome%2Fu%2Fp&session=%2Fsessions%2Ff.jsonl',
    ),
    { workspacePath: '/home/u/p', sessionPath: '/sessions/f.jsonl' },
  )
})

test('builds and round-trips the project page URL', () => {
  const workspace = '/home/anders/source/agent/pi-livecraft'
  const session =
    '/home/anders/.pi/agent/sessions/--home-anders-source-agent-pi-livecraft--/x.jsonl'
  const url = projectPageUrl('project-abc123', workspace, session)
  assert.match(url, /^\/project\/project-abc123\?/)
  const parsed = new URL(url, 'http://localhost')
  assert.deepEqual(projectUrlState(parsed.pathname, parsed.search), {
    workspacePath: workspace,
    sessionPath: session,
  })
  assert.equal(projectIdFromLocation(parsed.pathname, parsed.search), 'project-abc123')
  assert.equal(projectPageUrl('project-abc123'), '/project/project-abc123')
})
