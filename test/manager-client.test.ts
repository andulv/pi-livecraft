import assert from 'node:assert/strict'
import test from 'node:test'
import { ManagerClient } from '../server/manager-client.ts'

test('waits briefly before reporting an unavailable manager', async () => {
  const client = new ManagerClient('127.0.0.1', 0)
  let settled = false
  const request = client.request({ action: 'list' }).finally(() => {
    settled = true
  })

  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(settled, false)
  await assert.rejects(request, /Pi manager is unavailable/)
})
