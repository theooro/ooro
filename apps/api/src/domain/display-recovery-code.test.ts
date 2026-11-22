import test from 'node:test'
import assert from 'node:assert/strict'
import { createDisplayRecoveryCode, decryptDisplayRecoveryCode, encryptDisplayRecoveryCode } from './display-recovery-code.js'

test('recovery codes are readable only through authenticated encryption', () => {
  const code = createDisplayRecoveryCode()
  const encrypted = encryptDisplayRecoveryCode(code, 'test signing secret')
  assert.equal(decryptDisplayRecoveryCode(encrypted, 'test signing secret'), code)
  assert.notEqual(encrypted, code)
  assert.throws(() => decryptDisplayRecoveryCode(encrypted, 'different secret'))
})

test('recovery codes use the human-entry alphabet and stable display-safe length', () => {
  const code = createDisplayRecoveryCode()
  assert.match(code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/)
})
