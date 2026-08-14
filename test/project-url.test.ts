import assert from 'node:assert/strict'
import test from 'node:test'
import {
  projectIdFromLocation,
  projectPageUrl,
  projectUrlState,
} from '../src/features/workspace/project-url.ts'

const projectId = 'project-4a3ab1ac'
const projectPath = '/project/pi-livecraft-4a3ab1ac'

test('extracts the stable project id from readable and legacy path forms', () => {
  assert.equal(projectIdFromLocation(projectPath, ''), projectId)
  assert.equal(projectIdFromLocation(projectPath, '?workspace=%2Fx'), projectId)
  assert.equal(projectIdFromLocation(`/project/${projectId}`, ''), projectId)
  assert.equal(projectIdFromLocation('/', `?project=${projectId}`), projectId)
  assert.equal(projectIdFromLocation('/', ''), null)
})

test('extracts workspace and session from query parameters', () => {
  assert.deepEqual(projectUrlState(projectPath, ''), {
    workspacePath: undefined,
    sessionPath: undefined,
  })
  assert.deepEqual(projectUrlState(projectPath, '?workspace=%2Fhome%2Fu%2Fp'), {
    workspacePath: '/home/u/p',
    sessionPath: undefined,
  })
  assert.deepEqual(
    projectUrlState(projectPath, '?workspace=%2Fhome%2Fu%2Fp&session=%2Fsessions%2Ff.jsonl'),
    { workspacePath: '/home/u/p', sessionPath: '/sessions/f.jsonl' },
  )
})

test('builds and round-trips a readable, stable project page URL', () => {
  const workspace = '/home/anders/source/agent/pi-livecraft'
  const session =
    '/home/anders/.pi/agent/sessions/--home-anders-source-agent-pi-livecraft--/x.jsonl'
  const url = projectPageUrl(projectId, 'Pi Livecraft!', workspace, session)
  assert.match(url, /^\/project\/pi-livecraft-4a3ab1ac\?/)
  const parsed = new URL(url, 'http://localhost')
  assert.deepEqual(projectUrlState(parsed.pathname, parsed.search), {
    workspacePath: workspace,
    sessionPath: session,
  })
  assert.equal(projectIdFromLocation(parsed.pathname, parsed.search), projectId)
  assert.equal(projectPageUrl(projectId, 'Pi Livecraft!'), projectPath)
})
