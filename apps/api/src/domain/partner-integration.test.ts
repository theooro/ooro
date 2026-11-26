import test from 'node:test'
import assert from 'node:assert/strict'
import {
  authenticatePartner, hashPartnerSecret, issuePartnerCredential, normalizedRideEventSchema,
  PartnerEventInbox, PartnerRateLimiter, partnerTenantWhere, requirePartnerScope,
  signPartnerWebhook, verifyPartnerWebhook, type PartnerPrincipal,
  SyntheticMobilityAdapter,
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
  const inbox = new PartnerEventInbox(); const receivedAt = new Date('2026-01-01T00:00:00Z'), input = event()
  const first = inbox.ingest(principal, 'req-1', input, receivedAt)
  assert.equal(first.status, 'ACCEPTED')
  assert.equal(inbox.ingest(principal, 'req-2', input, receivedAt).status, 'DUPLICATE')
  assert.equal(inbox.ingest({ ...principal, partnerId: 'partner-b' }, 'req-3', input, receivedAt).status, 'ACCEPTED')
  assert.equal(inbox.ingest({ ...principal, environment: 'STAGING' }, 'req-4', input, receivedAt).status, 'ACCEPTED')
  assert.throws(() => inbox.ingest(principal, 'req-5', { ...input, eventType: 'RIDE_ACTIVE' }, receivedAt), (error: unknown) => (error as {code?: string}).code === 'EVENT_ID_REUSE')
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

test('synthetic provider adapter normalizes only consented sandbox fixtures', async () => {
  const adapter = new SyntheticMobilityAdapter()
  const fixture = { fixtureId: 'f89c0e09-4667-46f8-beb0-c7d4220686cb', lifecycle: 'COMPLETED', occurredAt: new Date().toISOString(), consent: true, serviceArea: 'Fixture Area', feature: 'SERVICEABILITY' }
  assert.deepEqual(await adapter.normalize(fixture, { partnerId: 'synthetic', environment: 'SANDBOX', requestId: 'fixture-request' }), {eventId:fixture.fixtureId,eventType:'RIDE_COMPLETED',occurredAt:fixture.occurredAt,consent:true,context:{serviceArea:'Fixture Area',feature:'SERVICEABILITY'}})
  await assert.rejects(adapter.normalize(fixture, { partnerId: 'synthetic', environment: 'STAGING', requestId: 'fixture-request' }), { code: 'SYNTHETIC_ENVIRONMENT_DENIED' })
  await assert.rejects(adapter.normalize({ ...fixture, consent: false }, { partnerId: 'synthetic', environment: 'SANDBOX', requestId: 'fixture-request' }))
})

test('webhook destination policy blocks special IPv4 and IPv6 address ranges', async () => {
  const { isPartnerWebhookAddressAllowed } = await import('../partner-runtime.js')
  for (const address of ['127.0.0.1','10.1.2.3','169.254.169.254','172.16.0.1','192.168.0.1','100.100.100.200','168.63.129.16','::1','fc00::1','fd00:ec2::254','fe80::1','ff02::1','::ffff:127.0.0.1']) assert.equal(isPartnerWebhookAddressAllowed(address), false, address)
  assert.equal(isPartnerWebhookAddressAllowed('8.8.8.8'), true)
  assert.equal(isPartnerWebhookAddressAllowed('2606:4700:4700::1111'), true)
})
