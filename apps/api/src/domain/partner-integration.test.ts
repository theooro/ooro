import test from 'node:test'
import assert from 'node:assert/strict'
import {
  authenticatePartner, hashPartnerSecret, issuePartnerCredential, normalizedRideEventSchema,
  PartnerEventInbox, PartnerRateLimiter, partnerTenantWhere, requirePartnerScope,
  signPartnerWebhook, verifyPartnerWebhook, type PartnerPrincipal,
} from './partner-integration.js'

const principal: PartnerPrincipal = { partnerId: 'partner-a', clientId: 'client-a', environment: 'SANDBOX', scopes: ['mobility.events:write','campaigns:read'] }
const event = (eventId = 'd2f43c18-2a99-4ce3-8ff2-8f82074f42d1') => ({ eventId, eventType: 'RIDE_COMPLETED', occurredAt: new Date().toISOString(), consent: true, context: { serviceArea: 'Bengaluru', vehicleClass: 'AUTO', feature: 'SERVICEABILITY' } })

test('normalized partner event accepts minimized consented context and rejects identity/route data and oversized payloads', () => {
  assert.equal(normalizedRideEventSchema.safeParse(event()).success, true)
  assert.equal(normalizedRideEventSchema.safeParse({ ...event(), passengerName: 'Example' }).success, false)
  assert.equal(normalizedRideEventSchema.safeParse({ ...event(), context: { preciseTripId: 'private' } }).success, false)
  assert.equal(normalizedRideEventSchema.safeParse({ ...event(), context: { serviceArea: 'x'.repeat(81) } }).success, false)
  assert.equal(normalizedRideEventSchema.safeParse({ ...event(), consent: false }).success, false)
  assert.equal(normalizedRideEventSchema.safeParse({ ...event(), occurredAt: new Date(Date.now()-8*86400000).toISOString() }).success, false)
})

test('credentials are returned once, stored as hashes, environment scoped, rotatable and revocable', () => {
  const first = issuePartnerCredential({ partnerId: 'p1', clientId: 'c1', environment: 'SANDBOX', scopes: ['campaigns:read'] })
  assert.notEqual(first.credential.secretHash, first.secret)
  assert.equal(first.credential.secretHash, hashPartnerSecret(first.secret))
  assert.equal(authenticatePartner(first.credential, first.secret, 'SANDBOX')?.partnerId, 'p1')
  assert.equal(authenticatePartner(first.credential, first.secret, 'STAGING'), null)
  assert.equal(authenticatePartner({ ...first.credential, revokedAt: Date.now() }, first.secret, 'SANDBOX'), null)
  assert.equal(authenticatePartner({ ...first.credential, expiresAt: Date.now()-1 }, first.secret, 'SANDBOX'), null)
  const rotated = issuePartnerCredential({ partnerId: 'p1', clientId: 'c1', environment: 'SANDBOX', scopes: ['campaigns:read'] })
  assert.notEqual(first.secret, rotated.secret)
})

test('scope denial and tenant filter are explicit', () => {
  assert.throws(() => requirePartnerScope(principal, 'webhooks:manage'), (error: unknown) => (error as {statusCode?: number}).statusCode === 403)
  assert.deepEqual(partnerTenantWhere(principal, { status: 'ACTIVE' }), { partnerId: 'partner-a', status: 'ACTIVE' })
})

test('event inbox is partner/environment scoped, idempotent and rejects event ID payload changes', () => {
  const inbox = new PartnerEventInbox(); const receivedAt = new Date('2026-01-01T00:00:00Z')
  const first = inbox.ingest(principal, 'req-1', event(), receivedAt)
  assert.equal(first.status, 'ACCEPTED')
  assert.equal(inbox.ingest(principal, 'req-2', event(), receivedAt).status, 'DUPLICATE')
  assert.equal(inbox.ingest({ ...principal, partnerId: 'partner-b' }, 'req-3', event(), receivedAt).status, 'ACCEPTED')
  assert.equal(inbox.ingest({ ...principal, environment: 'STAGING' }, 'req-4', event(), receivedAt).status, 'ACCEPTED')
  assert.throws(() => inbox.ingest(principal, 'req-5', { ...event(), eventType: 'RIDE_ACTIVE' }, receivedAt), (error: unknown) => (error as {code?: string}).code === 'EVENT_ID_REUSE')
})

test('partner rate limits are isolated by partner and environment', () => {
  const limiter = new PartnerRateLimiter(2, 1000)
  assert.equal(limiter.consume('p1','SANDBOX',1000).allowed, true)
  assert.equal(limiter.consume('p1','SANDBOX',1100).allowed, true)
  assert.deepEqual(limiter.consume('p1','SANDBOX',1200), { allowed:false, remaining:0, retryAfterSeconds:1 })
  assert.equal(limiter.consume('p2','SANDBOX',1200).allowed, true)
  assert.equal(limiter.consume('p1','STAGING',1200).allowed, true)
  assert.equal(limiter.consume('p1','SANDBOX',2000).allowed, true)
})

test('webhook signatures verify with timestamp tolerance and reject tampering/replay', () => {
  const body = JSON.stringify({ id:'evt-1',type:'campaign.status',data:{status:'APPROVED'} })
  const signature = signPartnerWebhook('sandbox-secret', 1000, body)
  assert.equal(verifyPartnerWebhook('sandbox-secret', 1000, body, signature, 1000), true)
  assert.equal(verifyPartnerWebhook('sandbox-secret', 1000, body+' ', signature, 1000), false)
  assert.equal(verifyPartnerWebhook('sandbox-secret', 1000, body, signature, 1401), false)
  assert.equal(verifyPartnerWebhook('wrong-secret', 1000, body, signature, 1000), false)
})
