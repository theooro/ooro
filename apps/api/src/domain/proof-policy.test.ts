import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalProofId, canonicalProofStatus, proofIdentityBelongsToDisplay } from './proof-policy.js'

test('standalone proof remains canonical without a ride id', () => {
  assert.equal(canonicalProofId('device-proof-1'), 'device-proof-1')
  assert.equal(canonicalProofStatus(true, 10, 10), 'VALID')
})

test('ride-linked and standalone retries use the same stable proof identity', () => {
  assert.equal(canonicalProofId('proof-1', 'event-1'), 'proof-1')
  assert.equal(canonicalProofId(undefined, 'event-1'), 'event-1')
  assert.equal(canonicalProofStatus(false, 10, 10), 'FAILED')
  assert.equal(canonicalProofStatus(true, 5, 10), 'PARTIAL')
})

test('successful proof with offline unverified timing is not marked billable', () => {
  assert.equal(canonicalProofStatus(true, 10, 10, false), 'UNVERIFIED_TIME')
  assert.equal(canonicalProofStatus(false, 10, 10, false), 'FAILED')
})

test('proof retries cannot move a canonical proof between displays', () => {
  assert.equal(proofIdentityBelongsToDisplay(undefined, 'display-a'), true)
  assert.equal(proofIdentityBelongsToDisplay('display-a', 'display-a'), true)
  assert.equal(proofIdentityBelongsToDisplay('display-a', 'display-b'), false)
})
