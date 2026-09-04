import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cdpInputCommand,
  parseBrowserInputEvent,
} from '../server/features/browser/browser-session.ts'

test('maps input events to their CDP commands', () => {
  assert.deepEqual(
    cdpInputCommand({
      type: 'mousePressed',
      x: 10.5,
      y: 20,
      button: 'left',
      clickCount: 1,
      modifiers: 2,
    }),
    {
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mousePressed',
        x: 10.5,
        y: 20,
        button: 'left',
        buttons: 0,
        clickCount: 1,
        modifiers: 2,
      },
    },
  )

  for (const button of ['back', 'forward'] as const) {
    assert.equal(
      cdpInputCommand({
        type: 'mousePressed',
        x: 0,
        y: 0,
        button,
        clickCount: 1,
        modifiers: 0,
      })
        .params
        .button,
      button,
    )
  }

  assert.deepEqual(
    cdpInputCommand({
      type: 'mouseMoved',
      x: 1,
      y: 2,
      button: 'left',
      clickCount: 1,
      modifiers: 0,
    })
      .params
      .buttons,
    1,
  )

  assert.deepEqual(
    cdpInputCommand({
      type: 'mouseWheel',
      x: 1,
      y: 2,
      deltaX: -3,
      deltaY: 12,
      modifiers: 0,
    }),
    {
      method: 'Input.dispatchMouseEvent',
      params: { type: 'mouseWheel', x: 1, y: 2, deltaX: -3, deltaY: 12, modifiers: 0 },
    },
  )

  assert.deepEqual(
    cdpInputCommand({
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      keyCode: 65,
      modifiers: 0,
      text: 'a',
    }),
    {
      method: 'Input.dispatchKeyEvent',
      params: {
        type: 'keyDown',
        key: 'a',
        code: 'KeyA',
        windowsVirtualKeyCode: 65,
        nativeVirtualKeyCode: 65,
        modifiers: 0,
        text: 'a',
        unmodifiedText: 'a',
      },
    },
  )

  assert.deepEqual(
    cdpInputCommand({
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      modifiers: 0,
    })
      .params
      .type,
    'rawKeyDown',
  )

  assert.deepEqual(
    cdpInputCommand({ type: 'insertText', text: 'héllo' }),
    { method: 'Input.insertText', params: { text: 'héllo' } },
  )
})

test('validates untrusted input payloads', () => {
  assert.deepEqual(
    parseBrowserInputEvent({
      type: 'mouseReleased',
      x: 5,
      y: 6,
      button: 'right',
      clickCount: 2.4,
      modifiers: 'ignored',
    }),
    { type: 'mouseReleased', x: 5, y: 6, button: 'right', clickCount: 2, modifiers: 0 },
  )

  assert.equal(parseBrowserInputEvent({ type: 'mousePressed', x: 1, y: 2, button: 'hyper' }), null)
  assert.equal(parseBrowserInputEvent({ type: 'mousePressed', x: '1', y: 2, button: 'left' }), null)
  assert.equal(parseBrowserInputEvent({ type: 'mouseWheel', x: 1, deltaY: 'a' }), null)
  assert.equal(parseBrowserInputEvent({ type: 'keyDown', key: 'a' }), null)
  assert.equal(parseBrowserInputEvent({ type: 'insertText', text: '' }), null)
  assert.equal(parseBrowserInputEvent({ type: 'insertText', text: 'x'.repeat(10_001) }), null)
  assert.equal(parseBrowserInputEvent('nonsense'), null)
})
