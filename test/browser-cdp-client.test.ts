import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CdpConnection,
  CdpError,
  type CdpTransport,
} from '../server/features/browser/cdp-client.ts'

/** Minimal scriptable transport: records sends, lets tests deliver frames. */
class FakeTransport implements CdpTransport {
  sent: string[] = []
  private handlers = {
    open: [] as Array<() => void>,
    message: [] as Array<(data: string) => void>,
    close: [] as Array<() => void>,
    error: [] as Array<(error: unknown) => void>,
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    for (const handler of this.handlers.close) handler()
  }

  onOpen(handler: () => void): void {
    this.handlers.open.push(handler)
  }

  onMessage(handler: (data: string) => void): void {
    this.handlers.message.push(handler)
  }

  onClose(handler: () => void): void {
    this.handlers.close.push(handler)
  }

  onError(handler: (error: unknown) => void): void {
    this.handlers.error.push(handler)
  }

  open(): void {
    for (const handler of this.handlers.open) handler()
  }

  deliver(value: unknown): void {
    for (const handler of this.handlers.message) handler(JSON.stringify(value))
  }
}

function connectedPair(): { transport: FakeTransport; connection: CdpConnection } {
  const transport = new FakeTransport()
  const connection = new CdpConnection(() => transport)
  const connected = connection.connect('ws://test/page')
  transport.open()
  void connected
  return { transport, connection }
}

test('correlates command responses by id and resolves results', async () => {
  const { transport, connection } = connectedPair()
  const pending = connection.send('Page.navigate', { url: 'https://example.com' })
  const request = JSON.parse(transport.sent[0])
  assert.equal(request.method, 'Page.navigate')
  assert.equal(request.params.url, 'https://example.com')
  transport.deliver({ id: request.id, result: { frameId: 'f1' } })
  assert.deepEqual(await pending, { frameId: 'f1' })
  connection.close()
})

test('rejects commands with protocol errors', async () => {
  const { transport, connection } = connectedPair()
  const pending = connection.send('Page.enable')
  const request = JSON.parse(transport.sent[0])
  assert.rejects(pending, /was not enabled/)
  transport.deliver({ id: request.id, error: { code: -32000, message: 'was not enabled' } })
  await assert.rejects(pending, CdpError)
  connection.close()
})

test('fans out events to subscribers and supports unsubscribe', async () => {
  const { transport, connection } = connectedPair()
  const received: unknown[] = []
  const unsubscribe = connection.on('Page.frameNavigated', (params) => received.push(params))
  connection.on('Page.screencastFrame', (params) => received.push(params))

  transport.deliver({ method: 'Page.frameNavigated', params: { frame: { url: 'https://a.dev' } } })
  transport.deliver({ method: 'Page.screencastFrame', params: { data: 'abc' } })
  unsubscribe()
  transport.deliver({ method: 'Page.frameNavigated', params: { frame: { url: 'ignored' } } })

  assert.equal(received.length, 2)
  connection.close()
})

test('notifies disconnect listeners and fails pending commands', async () => {
  const { transport, connection } = connectedPair()
  let disconnected = false
  connection.onDisconnected(() => {
    disconnected = true
  })
  const pending = connection.send('Page.enable')
  transport.close()
  assert.ok(disconnected)
  await assert.rejects(pending, /connection lost/)
  connection.close()
})
