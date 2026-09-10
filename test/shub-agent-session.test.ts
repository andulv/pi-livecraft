import { deepEqual, strictEqual } from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildShubMarkerData,
  sessionIdFromFilePath,
  shubAgentSessionName,
  SHUB_MARKER_CUSTOM_TYPE,
  shubMarkerFromEntry,
} from '../shared/shub-agent-session.ts'

test('marker data is built from narrowly named environment variables', () => {
  deepEqual(
    buildShubMarkerData({
      PI_SHUB_OWNER_SESSION_ID: ' owner-id ',
      PI_SHUB_AGENT: 'research',
    }),
    { version: 1, ownerSessionId: 'owner-id', agent: 'research' },
  )

  strictEqual(buildShubMarkerData({ PI_SHUB_AGENT: 'research' }), undefined)
  strictEqual(buildShubMarkerData({}), undefined)
})

test('the marker entry is recognized and anything else is rejected', () => {
  const entry = {
    type: 'custom',
    id: 'h8i9j0k1',
    parentId: null,
    timestamp: '2026-07-19T10:00:00.000Z',
    customType: SHUB_MARKER_CUSTOM_TYPE,
    data: { version: 1, ownerSessionId: 'owner-id', agent: 'research' },
  }
  deepEqual(shubMarkerFromEntry(entry), {
    version: 1,
    ownerSessionId: 'owner-id',
    agent: 'research',
  })

  for (
    const invalid of [
      undefined,
      null,
      'text',
      { type: 'custom', customType: SHUB_MARKER_CUSTOM_TYPE },
      {
        type: 'custom',
        customType: 'other-extension',
        data: { version: 1, ownerSessionId: 'o', agent: 'a' },
      },
      {
        type: 'custom',
        customType: SHUB_MARKER_CUSTOM_TYPE,
        data: { version: 2, ownerSessionId: 'o', agent: 'a' },
      },
      { type: 'custom', customType: SHUB_MARKER_CUSTOM_TYPE, data: { version: 1, agent: 'a' } },
      {
        type: 'custom',
        customType: SHUB_MARKER_CUSTOM_TYPE,
        data: { version: 1, ownerSessionId: 'o' },
      },
    ]
  ) {
    strictEqual(shubMarkerFromEntry(invalid), undefined)
  }
})

test('child session names stay readable and bounded', () => {
  strictEqual(
    shubAgentSessionName('research', 'map session persistence'),
    'shub-agent/research: map session persistence',
  )
  strictEqual(
    shubAgentSessionName('research', `x${'y'.repeat(200)}`),
    `shub-agent/research: x${'y'.repeat(119)}`,
  )
})

test('Pi session ids are extracted from persisted filenames', () => {
  strictEqual(
    sessionIdFromFilePath('/sessions/2026-07-19T10-00-00_abc123.jsonl'),
    'abc123',
  )
  strictEqual(sessionIdFromFilePath(undefined), undefined)
  strictEqual(sessionIdFromFilePath('/sessions/plain.jsonl'), undefined)
})
