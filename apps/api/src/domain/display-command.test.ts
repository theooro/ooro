import test from 'node:test'
import assert from 'node:assert/strict'
import { sameDisplayCommandRequest } from './display-command.js'

test('display command retries match the same screen, type, and semantic payload', () => {
  assert.equal(sameDisplayCommandRequest(
    { displayId: 'screen-a', commandType: 'REFRESH_MANIFEST', payload: { version: 4, force: true } },
    { displayId: 'screen-a', commandType: 'REFRESH_MANIFEST', payload: { force: true, version: 4 } },
  ), true)
})

test('idempotency keys cannot replay a command to another screen or action', () => {
  const command = { displayId: 'screen-a', commandType: 'RESTART_PLAYER', payload: null }
  assert.equal(sameDisplayCommandRequest(command, { ...command, displayId: 'screen-b' }), false)
  assert.equal(sameDisplayCommandRequest(command, { ...command, commandType: 'REFRESH_MANIFEST' }), false)
})

test('idempotency payload changes are rejected while absent and null payloads are equivalent', () => {
  assert.equal(sameDisplayCommandRequest(
    { displayId: 'screen-a', commandType: 'RESTART_PLAYER' },
    { displayId: 'screen-a', commandType: 'RESTART_PLAYER', payload: null },
  ), true)
  assert.equal(sameDisplayCommandRequest(
    { displayId: 'screen-a', commandType: 'RESTART_PLAYER', payload: { reason: 'operator' } },
    { displayId: 'screen-a', commandType: 'RESTART_PLAYER', payload: { reason: 'other' } },
  ), false)
})
