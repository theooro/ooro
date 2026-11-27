import assert from 'node:assert/strict'
import { test } from 'node:test'
import { safeDestination } from './qr-destination.js'

test('consumer redemption destinations must be HTTPS public URLs, never OORO API hosts', () => {
  assert.equal(safeDestination('https://merchant.example.test/redeem'), 'https://merchant.example.test/redeem')
  assert.equal(safeDestination('https://theooro.com'), 'https://theooro.com/')
  assert.equal(safeDestination('https://api-staging.theooro.com/offers'), null)
  assert.equal(safeDestination('https://staging.theooro.com'), null)
  assert.equal(safeDestination('http://merchant.example.test'), null)
})
