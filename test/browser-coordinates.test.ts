import assert from 'node:assert/strict'
import test from 'node:test'
import {
  browserMouseButton,
  cdpModifiers,
  mapPointerToPage,
} from '../src/features/browser/coordinates.ts'

test('maps pane coordinates into the captured frame and clamps overflow', () => {
  const frame = {
    rect: { left: 40, top: 20, width: 800, height: 500 },
    naturalWidth: 1440,
    naturalHeight: 1000,
  }
  assert.deepEqual(mapPointerToPage({ clientX: 40, clientY: 20 }, frame), { x: 0, y: 0 })
  assert.deepEqual(mapPointerToPage({ clientX: 440, clientY: 270 }, frame), { x: 720, y: 500 })
  assert.deepEqual(mapPointerToPage({ clientX: 9e9, clientY: 9e9 }, frame), { x: 1440, y: 1000 })
  assert.deepEqual(mapPointerToPage({ clientX: -50, clientY: -50 }, frame), { x: 0, y: 0 })
  assert.deepEqual(
    mapPointerToPage({ clientX: 10, clientY: 10 }, { ...frame, naturalWidth: 0 }),
    { x: 0, y: 0 },
  )
})

test('maps auxiliary pointer buttons to browser navigation buttons', () => {
  assert.equal(browserMouseButton(0), 'left')
  assert.equal(browserMouseButton(1), 'middle')
  assert.equal(browserMouseButton(2), 'right')
  assert.equal(browserMouseButton(3), 'back')
  assert.equal(browserMouseButton(4), 'forward')
  assert.equal(browserMouseButton(-1), 'left')
})

test('combines modifier flags into the CDP bitmask', () => {
  assert.equal(
    cdpModifiers({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: true }),
    1 | 8,
  )
  assert.equal(
    cdpModifiers({ altKey: false, ctrlKey: true, metaKey: true, shiftKey: false }),
    2 | 4,
  )
  assert.equal(
    cdpModifiers({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }),
    0,
  )
})
