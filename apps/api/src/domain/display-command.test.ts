import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError } from '../errors.js'
import { assertCommandCanBeAcknowledged, commandBelongsToDevice, commandExpiresAt, commandStatusFromDeviceAck, isCommandExpired, sameDisplayCommandRequest, sameIdempotentCommand, safeCommandError } from './display-command.js'

test('command state lifecycle permits delivery and one terminal acknowledgement', () => {
  assert.equal(commandStatusFromDeviceAck('RECEIVED'), 'DELIVERED')
  assert.equal(commandStatusFromDeviceAck('PROCESSING'), 'DELIVERED')
  assert.equal(commandStatusFromDeviceAck('SUCCEEDED'), 'ACKNOWLEDGED')
  assert.equal(commandStatusFromDeviceAck('FAILED'), 'FAILED')
  assert.equal(commandStatusFromDeviceAck('UNSUPPORTED'), 'FAILED')
  assert.doesNotThrow(() => assertCommandCanBeAcknowledged('QUEUED', 'DELIVERED'))
  assert.doesNotThrow(() => assertCommandCanBeAcknowledged('QUEUED', 'CANCELLED'))
  assert.doesNotThrow(() => assertCommandCanBeAcknowledged('DELIVERED', 'ACKNOWLEDGED'))
  assert.doesNotThrow(() => assertCommandCanBeAcknowledged('ACKNOWLEDGED', 'ACKNOWLEDGED'))
  assert.throws(() => assertCommandCanBeAcknowledged('ACKNOWLEDGED', 'FAILED'), (error) => error instanceof ApiError && error.statusCode === 409)
  assert.throws(() => assertCommandCanBeAcknowledged('EXPIRED', 'ACKNOWLEDGED'), (error) => error instanceof ApiError && error.statusCode === 409)
  assert.throws(() => assertCommandCanBeAcknowledged('DELIVERED', 'CANCELLED'), (error) => error instanceof ApiError && error.statusCode === 409)
})

test('command expiry is explicit and queued commands remain valid until expiry', () => {
  const now = new Date('2026-11-14T12:00:00Z')
  const expiresAt = commandExpiresAt(now)
  assert.equal(expiresAt.getTime() - now.getTime(), 24 * 60 * 60_000)
  assert.equal(isCommandExpired(expiresAt, new Date(expiresAt.getTime() - 1)), false)
  assert.equal(isCommandExpired(expiresAt, expiresAt), true)
  assert.equal(isCommandExpired(undefined, now), false)
})

test('idempotency reuses only the same scoped command request', () => {
  const original = { commandType: 'RESTART_PLAYER', payload: { source: 'fleet' } }
  assert.equal(sameIdempotentCommand(original, { ...original }), true)
  assert.equal(sameIdempotentCommand(original, { commandType: 'SYNC_MANIFEST', payload: original.payload }), false)
  assert.equal(sameIdempotentCommand(original, { commandType: original.commandType, payload: { source: 'other' } }), false)
})

test('device command acknowledgement is isolated to the authenticated paired screen', () => {
  assert.equal(commandBelongsToDevice('screen-a', 'screen-a'), true)
  assert.equal(commandBelongsToDevice('screen-a', 'screen-b'), false)
})

test('device error text is sanitized before it is shown in the fleet UI', () => {
  assert.equal(safeCommandError('Bearer abc.def\nplayer failed'), 'Bearer [redacted] player failed')
  assert.equal(safeCommandError('token=secret-value'), 'token=[redacted]')
  assert.equal(safeCommandError('x'.repeat(300))?.length, 240)
})

test('display retries compare screen, type, and semantic payload independent of key order', () => {
  assert.equal(sameDisplayCommandRequest(
    { displayId: 'screen-a', commandType: 'REFRESH_MANIFEST', payload: { version: 4, force: true } },
    { displayId: 'screen-a', commandType: 'REFRESH_MANIFEST', payload: { force: true, version: 4 } },
  ), true)
  assert.equal(sameDisplayCommandRequest(
    { displayId: 'screen-a', commandType: 'RESTART_PLAYER' },
    { displayId: 'screen-b', commandType: 'RESTART_PLAYER' },
  ), false)
  assert.equal(sameDisplayCommandRequest(
    { displayId: 'screen-a', commandType: 'RESTART_PLAYER' },
    { displayId: 'screen-a', commandType: 'SYNC_MANIFEST' },
  ), false)
})
