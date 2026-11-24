import test from 'node:test'
import assert from 'node:assert/strict'
import { pairingStateAfterAdminRecoveryRequest, pairingStateAfterAuthenticatedHeartbeat } from './display-pairing-state.js'

test('admin recovery remains distinct from authenticated pairing', () => {
  assert.equal(pairingStateAfterAdminRecoveryRequest('PAIRED'), 'RECOVERY_REQUESTED')
  assert.equal(pairingStateAfterAuthenticatedHeartbeat('RECOVERY_REQUESTED', 'READY'), 'RECOVERY_REQUESTED')
})

test('pair API response remains pending until authenticated heartbeat', () => {
  assert.equal(pairingStateAfterAuthenticatedHeartbeat('PAIRING_PENDING', 'READY'), 'PAIRED')
  assert.equal(pairingStateAfterAuthenticatedHeartbeat('PAIRING_PENDING', 'UNPAIRED'), 'UNPAIRED')
})

test('failed pairing can only be recovered by an authenticated heartbeat', () => {
  assert.equal(pairingStateAfterAuthenticatedHeartbeat('PAIRING_FAILED', 'READY'), 'PAIRED')
  assert.equal(pairingStateAfterAuthenticatedHeartbeat('PAIRING_FAILED', 'DISABLED'), 'UNPAIRED')
})

test('an unpair request remains pending until the device acknowledges it', () => {
  assert.equal(pairingStateAfterAuthenticatedHeartbeat('REMOVAL_PENDING', 'UNPAIRED'), 'REMOVAL_PENDING')
  assert.equal(pairingStateAfterAuthenticatedHeartbeat('UNPAIRED', 'UNPAIRED'), 'UNPAIRED')
})
