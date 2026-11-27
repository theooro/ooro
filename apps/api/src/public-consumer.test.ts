import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { app } from './server.js'
import { prisma } from './prisma.js'

const token = 'abcdefghijklmnopqrstuvwxyzABCDEF'
const campaign = { id: 'f5043274-b6c3-4628-a1a1-ef664377f24f', name: 'Local fixture', status: 'ACTIVE', startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 60_000), commercialFundingStatus: 'INTERNAL_TEST', metadata: { offer: { brandName: 'Fixture Café', offerTitle: 'Fixture offer', offerValue: '10% off', ctaLabel: 'Explore offer' } } }
let oldFindUnique: typeof prisma.campaignTrackingLink.findUnique
let oldDisplayFindMany: typeof prisma.display.findMany
let oldCampaignFindUnique: typeof prisma.campaign.findUnique
let oldCreativeFindUnique: typeof prisma.creative.findUnique
let oldProofFindFirst: typeof prisma.proofOfPlay.findFirst
before(async () => { await app.ready(); oldFindUnique = prisma.campaignTrackingLink.findUnique; oldDisplayFindMany = prisma.display.findMany; oldCampaignFindUnique = prisma.campaign.findUnique; oldCreativeFindUnique = prisma.creative.findUnique; oldProofFindFirst = prisma.proofOfPlay.findFirst })
after(async () => { prisma.campaignTrackingLink.findUnique = oldFindUnique; prisma.display.findMany = oldDisplayFindMany; prisma.campaign.findUnique = oldCampaignFindUnique; prisma.creative.findUnique = oldCreativeFindUnique; prisma.proofOfPlay.findFirst = oldProofFindFirst; await app.close() })

test('public QR offer route binds an active approved asset and emits only the canonical consumer URL', async () => {
  prisma.campaignTrackingLink.findUnique = (async () => ({ id: 'link-1', token, campaignId: campaign.id, creativeId: '4fc0cf92-586f-4b49-85ab-69d51a5e39e5', displayId: null, destinationUrl: 'https://merchant.example.test/redeem', ctaType: 'WEBSITE', active: true, createdAt: new Date(), expiresAt: null, campaign, creative: { id: '4fc0cf92-586f-4b49-85ab-69d51a5e39e5', name: 'Poster', type: 'IMAGE', status: 'APPROVED', brandName: null, promotionalText: 'Weekends only', qrLabel: null, campaignId: campaign.id, campaign, asset: { active: true, url: 'https://cdn.example.test/poster.png', checksum: 'a'.repeat(64) } } })) as unknown as typeof prisma.campaignTrackingLink.findUnique
  const response = await app.inject({ method: 'GET', url: `/api/public/qr-offers/${token}` })
  assert.equal(response.statusCode, 200)
  const body = response.json()
  assert.equal(body.data.state, 'ACTIVE')
  assert.equal(body.data.offer.consumerUrl, `https://theooro.com/go/${token}`)
  assert.equal(body.data.offer.destinationUrl, 'https://merchant.example.test/redeem')
  assert.equal(JSON.stringify(body).includes('api-staging.theooro.com'), false)
})

test('public QR route does not disclose unknown codes or make them active', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/public/qr-offers/invalid' })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json().data, { state: 'UNAVAILABLE', offer: null })
})

test('now-playing excludes assigned playback without a matching acknowledged proof', async () => {
  const now = new Date()
  const display = { id: 'private-display-id', deviceTokenHash: 'fixture-only-hash', state: 'ACTIVE', pairingStatus: 'PAIRED', currentPlaybackState: 'PLAYING', currentCampaignId: campaign.id, currentCreativeId: '4fc0cf92-586f-4b49-85ab-69d51a5e39e5', currentPlaybackStartedAt: now, lastHeartbeatAt: now, lastLatitude: 12.9, lastLongitude: 77.6, lastLocationAt: now, vehicle: { city: 'Bengaluru' } }
  prisma.display.findMany = (async () => [display]) as unknown as typeof prisma.display.findMany
  prisma.campaign.findUnique = (async () => campaign) as unknown as typeof prisma.campaign.findUnique
  prisma.creative.findUnique = (async () => ({ id: display.currentCreativeId, name: 'Poster', brandName: 'Fixture Café', status: 'APPROVED', asset: { active: true, url: 'https://cdn.example.test/poster.png', checksum: 'b'.repeat(64) } })) as unknown as typeof prisma.creative.findUnique
  prisma.proofOfPlay.findFirst = (async () => null) as unknown as typeof prisma.proofOfPlay.findFirst
  const response = await app.inject({ method: 'POST', url: '/api/public/now-playing', payload: {} })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json().data.items, [])
})

test('now-playing rejects precise location coordinates and accepts only coarse request points', async () => {
  const response = await app.inject({ method: 'POST', url: '/api/public/now-playing', payload: { location: { latitude: 12.9716, longitude: 77.5946 } } })
  assert.equal(response.statusCode, 422)
})

test('now-playing emits only fresh proof-confirmed screen ads without device identity or coordinates', async () => {
  const now = new Date()
  const display = { id: 'private-display-id', deviceTokenHash: 'fixture-only-hash', state: 'ACTIVE', pairingStatus: 'PAIRED', currentPlaybackState: 'PLAYING', currentCampaignId: campaign.id, currentCreativeId: '4fc0cf92-586f-4b49-85ab-69d51a5e39e5', currentPlaybackStartedAt: now, lastHeartbeatAt: now, lastLatitude: 12.9, lastLongitude: 77.6, lastLocationAt: now, vehicle: { city: 'Bengaluru' } }
  prisma.display.findMany = (async () => [display]) as unknown as typeof prisma.display.findMany
  prisma.campaign.findUnique = (async () => campaign) as unknown as typeof prisma.campaign.findUnique
  prisma.creative.findUnique = (async () => ({ id: display.currentCreativeId, name: 'Poster', brandName: 'Fixture Café', status: 'APPROVED', asset: { active: true, url: 'https://cdn.example.test/poster.png', checksum: 'c'.repeat(64) } })) as unknown as typeof prisma.creative.findUnique
  prisma.proofOfPlay.findFirst = (async () => ({ playbackStartedAt: now })) as unknown as typeof prisma.proofOfPlay.findFirst
  const response = await app.inject({ method: 'POST', url: '/api/public/now-playing', payload: { location: { latitude: 12.9, longitude: 77.6 } } })
  const serialized = JSON.stringify(response.json())
  assert.equal(response.json().data.items.length, 1)
  assert.equal(serialized.includes('private-display-id'), false)
  assert.equal(serialized.includes('12.9'), false)
  assert.equal(serialized.includes('77.6'), false)
})
