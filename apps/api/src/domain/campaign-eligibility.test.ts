import test from 'node:test'
import assert from 'node:assert/strict'
import { campaignDeliveryQuota, deliveryAssetUrl, hasVerifiedAssetMetadata, manifestDeliveryReasons, manifestValidUntil, MANIFEST_AUTHORIZATION_LEASE_MS, manifestVersionFor, manifestVersionFromDigest, resolveQrConfiguration, selectManifestDeliverySlots, sponsoredSlotDiagnostic } from './campaign-eligibility.js'
import { THREE_ZONE_AD_SPONSOR_QR_CONTRACT_V1, THREE_ZONE_AD_SPONSOR_QR_V1 } from './presentation-layout.js'
import { safeDestination } from './qr-destination.js'

test('manifest versions fit persisted signed INT4 fields', () => {
  const version = manifestVersionFromDigest('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
  assert.equal(version, 268435455)
  assert.ok(version > 0 && version <= 2_147_483_647)
})

test('manifest QR requires explicit creative enablement and a valid authorized HTTPS destination', () => {
  assert.deepEqual(resolveQrConfiguration({ qrEnabled: true, qrTargetUrl: 'https://merchant.example/offer' }), { enabled: true, destination: 'https://merchant.example/offer' })
  assert.deepEqual(resolveQrConfiguration({ qrEnabled: false, qrTargetUrl: 'https://merchant.example/offer' }), { enabled: false, destination: null })
  assert.deepEqual(resolveQrConfiguration({ qrEnabled: true }), { enabled: true, destination: null })
  assert.deepEqual(resolveQrConfiguration({ qrEnabled: true, qrTargetUrl: 'https://staging.theooro.com/offer' }), { enabled: true, destination: null })
  assert.deepEqual(resolveQrConfiguration({ qrEnabled: true, qrTargetUrl: 'https://api-staging.theooro.com/offer' }), { enabled: true, destination: null })
  assert.deepEqual(resolveQrConfiguration({ qrEnabled: true, qrTargetUrl: 'http://merchant.example/offer' }), { enabled: true, destination: null })
})

test('sponsored creative is selected independently and never promoted from a main slot', () => {
  const items = [
    { id: 'main-a', campaignId: 'main', type: 'IMAGE', priority: 3 },
    { id: 'sponsor-video', campaignId: 'sponsor-video', type: 'VIDEO', priority: 99 },
    { id: 'sponsor-image', campaignId: 'sponsor-image', type: 'IMAGE', priority: 2 },
  ]
  const campaigns = [{ id: 'main', deliverySlot: 'MAIN' }, { id: 'sponsor-video', deliverySlot: 'SPONSORED' }, { id: 'sponsor-image', deliverySlot: 'SPONSORED' }]
  const v3 = selectManifestDeliverySlots(items, campaigns, true)
  assert.deepEqual(v3.mainItems.map(item => item.id), ['main-a'])
  assert.equal(v3.sponsoredItem?.id, 'sponsor-image')
  const v2 = selectManifestDeliverySlots(items, campaigns, false)
  assert.deepEqual(v2.mainItems.map(item => item.id), ['main-a'])
  assert.equal(v2.sponsoredItem, null)
  const inheritedSlot = selectManifestDeliverySlots([{ id: 'inherited-sponsor', campaignId: 'campaign-sponsor', type: 'IMAGE', priority: 4, deliverySlot: 'MAIN' }], [{ id: 'campaign-sponsor', deliverySlot: 'SPONSORED' }], true)
  assert.deepEqual(inheritedSlot.mainItems, [])
  assert.equal(inheritedSlot.sponsoredItem?.id, 'inherited-sponsor')
  const ordered = selectManifestDeliverySlots([{ id: 'second', campaignId: 'ordered', type: 'IMAGE', priority: 4, sequence: 2 }, { id: 'first', campaignId: 'ordered', type: 'IMAGE', priority: 4, sequence: 1 }], [{ id: 'ordered', deliverySlot: 'MAIN' }], false)
  assert.deepEqual(ordered.mainItems.map(item => item.id), ['first', 'second'])
})

test('sponsored slot diagnostics name the authorization gate without weakening it', () => {
  assert.equal(sponsoredSlotDiagnostic({ contractVersion: 2, playerSupportsSponsoredSlot: true, eligibleSponsorCount: 0, assignedApprovedSponsorCount: 1 }).code, 'SCREEN_LAYOUT_V2')
  assert.equal(sponsoredSlotDiagnostic({ contractVersion: 3, playerSupportsSponsoredSlot: false, eligibleSponsorCount: 0, assignedApprovedSponsorCount: 1 }).code, 'PLAYER_CAPABILITY_UNCONFIRMED')
  assert.deepEqual(sponsoredSlotDiagnostic({ contractVersion: 3, playerSupportsSponsoredSlot: true, eligibleSponsorCount: 0, assignedApprovedSponsorCount: 1, exclusion: { code: 'SPONSOR_FUNDING_REQUIRED', message: 'Funding required.' } }), { code: 'SPONSOR_FUNDING_REQUIRED', message: 'Funding required.' })
  assert.equal(sponsoredSlotDiagnostic({ contractVersion: 3, playerSupportsSponsoredSlot: true, eligibleSponsorCount: 1, assignedApprovedSponsorCount: 1 }).code, 'READY')
})

test('three-zone first-party preset has a versioned 65/35 geometry and no map slot', () => {
  assert.equal(THREE_ZONE_AD_SPONSOR_QR_V1, 'THREE_ZONE_AD_SPONSOR_QR_V1')
  assert.deepEqual(THREE_ZONE_AD_SPONSOR_QR_CONTRACT_V1, { type: THREE_ZONE_AD_SPONSOR_QR_V1, contractVersion: 1, layoutVersion: 1, primaryWidthPercent: 65, qrHeightPercent: 75, sponsoredHeightPercent: 25, minWidthPx: 1280, minHeightPx: 720 })
  assert.ok(!Object.keys(THREE_ZONE_AD_SPONSOR_QR_CONTRACT_V1).some(key => /map|widget|creativeId/i.test(key)))
})

test('manifest expiry is refresh metadata, not campaign delivery eligibility', () => {
  const now = new Date('2026-11-04T12:00:00.000Z')
  const until = manifestValidUntil(now)
  assert.equal(MANIFEST_AUTHORIZATION_LEASE_MS, 900_000)
  assert.equal(until.toISOString(), '2026-11-04T12:15:00.000Z')
  assert.ok(until > now)
})

test('campaign delivery requires active funded state and remains unmetered across offline plays', () => {
  const base = { campaignId: 'campaign', displayId: 'screen', revision: 2, status: 'ACTIVE', fundingStatus: 'PAID', authorizedPlays: 5, unlimited: false, consumedPlays: 2 }
  assert.deepEqual(campaignDeliveryQuota(base), { id: 'campaign:screen', revision: 2, remainingPlays: null, unlimited: true })
  assert.equal(campaignDeliveryQuota({ ...base, status: 'PAUSED' }), null)
  assert.equal(campaignDeliveryQuota({ ...base, status: 'APPROVED' }), null)
  assert.equal(campaignDeliveryQuota({ ...base, fundingStatus: 'UNFUNDED' }), null)
  assert.deepEqual(campaignDeliveryQuota({ ...base, authorizedPlays: null }), { id: 'campaign:screen', revision: 2, remainingPlays: null, unlimited: true })
  assert.deepEqual(campaignDeliveryQuota({ ...base, consumedPlays: 500000 }), { id: 'campaign:screen', revision: 2, remainingPlays: null, unlimited: true })
  assert.deepEqual(campaignDeliveryQuota({ ...base, authorizedPlays: null, unlimited: true }), { id: 'campaign:screen', revision: 2, remainingPlays: null, unlimited: true })
})

test('missing, future, expired, and inactive legacy timing metadata never gates valid delivery', () => {
  const base = { campaignId: 'campaign', displayId: 'assigned-screen', revision: 4, status: 'ACTIVE', fundingStatus: 'PAID', authorizedPlays: 8, unlimited: false, consumedPlays: 1 }
  const validCampaign = { status: 'ACTIVE', fundingStatus: 'PAID', quotaAuthorized: true, approvedCreativeCount: 1, checksumVerifiedAssetCount: 1 }
  const timingVariants = [
    {},
    { startsAt: new Date('2099-01-01T00:00:00Z'), endsAt: new Date('2099-02-01T00:00:00Z') },
    { startsAt: new Date('2000-01-01T00:00:00Z'), endsAt: new Date('2000-02-01T00:00:00Z') },
    { startTime: '23:55', endTime: '00:05', daysOfWeek: [], timezone: 'Pacific/Honolulu', scheduleActive: false },
  ]

  for (const legacyTiming of timingVariants) {
    const quota = campaignDeliveryQuota({ ...base, ...legacyTiming })
    assert.deepEqual(quota, { id: 'campaign:assigned-screen', revision: 4, remainingPlays: null, unlimited: true })
    assert.deepEqual(manifestDeliveryReasons({
      displayEnabled: true,
      supportsDeliveryQuota: true,
      assignmentCount: 1,
      campaigns: [{ ...validCampaign, ...legacyTiming }],
      eligibleItemCount: 1,
    }), [])
  }
})

test('campaign state, approval, funding, and assignment still fail closed without an offline counter', () => {
  const base = { campaignId: 'campaign', displayId: 'assigned-screen', revision: 4, status: 'ACTIVE', fundingStatus: 'PAID', authorizedPlays: 8, unlimited: false, consumedPlays: 1 }
  assert.equal(campaignDeliveryQuota({ ...base, status: 'PAUSED' }), null)
  assert.equal(campaignDeliveryQuota({ ...base, status: 'REJECTED' }), null)
  assert.deepEqual(campaignDeliveryQuota({ ...base, authorizedPlays: 1, consumedPlays: 1000000 }), { id: 'campaign:assigned-screen', revision: 4, remainingPlays: null, unlimited: true })

  const reasons = (assignmentCount: number, approvedCreativeCount: number, eligibleItemCount: number) => manifestDeliveryReasons({
    displayEnabled: true,
    supportsDeliveryQuota: true,
    assignmentCount,
    campaigns: [{ status: 'ACTIVE', fundingStatus: 'PAID', quotaAuthorized: true, approvedCreativeCount, checksumVerifiedAssetCount: approvedCreativeCount }],
    eligibleItemCount,
  })
  assert.deepEqual(reasons(0, 1, 0), ['NO_ASSIGNMENT'])
  assert.deepEqual(reasons(1, 0, 0), ['NO_APPROVED_CREATIVE'])
  assert.deepEqual(reasons(1, 1, 0), ['NO_ELIGIBLE_CREATIVE'])
})

test('manifest diagnostics distinguish assignment, state, funding, approval, and asset blockers', () => {
  const reasons = (campaigns: Array<{ status: string; fundingStatus: string; quotaAuthorized: boolean; approvedCreativeCount: number; checksumVerifiedAssetCount: number }>, assignmentCount = campaigns.length, eligibleItemCount = 0) => manifestDeliveryReasons({ displayEnabled: true, supportsDeliveryQuota: true, assignmentCount, campaigns, eligibleItemCount })
  assert.deepEqual(reasons([], 0), ['NO_ASSIGNMENT'])
  assert.deepEqual(reasons([{ status: 'APPROVED', fundingStatus: 'PAID', quotaAuthorized: true, approvedCreativeCount: 1, checksumVerifiedAssetCount: 1 }]), ['CAMPAIGN_INACTIVE'])
  assert.deepEqual(reasons([{ status: 'SCHEDULED', fundingStatus: 'PAID', quotaAuthorized: true, approvedCreativeCount: 1, checksumVerifiedAssetCount: 1 }]), ['CAMPAIGN_INACTIVE'])
  assert.deepEqual(reasons([{ status: 'PAUSED', fundingStatus: 'PAID', quotaAuthorized: true, approvedCreativeCount: 1, checksumVerifiedAssetCount: 1 }]), ['CAMPAIGN_INACTIVE'])
  assert.deepEqual(reasons([{ status: 'REJECTED', fundingStatus: 'PAID', quotaAuthorized: true, approvedCreativeCount: 1, checksumVerifiedAssetCount: 1 }]), ['CAMPAIGN_INACTIVE'])
  assert.deepEqual(reasons([{ status: 'DRAFT', fundingStatus: 'PAID', quotaAuthorized: false, approvedCreativeCount: 0, checksumVerifiedAssetCount: 0 }]), ['APPROVAL_REQUIRED'])
  assert.deepEqual(reasons([{ status: 'ACTIVE', fundingStatus: 'UNFUNDED', quotaAuthorized: false, approvedCreativeCount: 1, checksumVerifiedAssetCount: 1 }]), ['FUNDING_REQUIRED'])
  assert.deepEqual(reasons([{ status: 'ACTIVE', fundingStatus: 'PAID', quotaAuthorized: false, approvedCreativeCount: 1, checksumVerifiedAssetCount: 1 }]), ['NO_ELIGIBLE_CREATIVE'])
  assert.deepEqual(reasons([{ status: 'ACTIVE', fundingStatus: 'PAID', quotaAuthorized: true, approvedCreativeCount: 0, checksumVerifiedAssetCount: 0 }]), ['NO_APPROVED_CREATIVE'])
  assert.deepEqual(reasons([{ status: 'ACTIVE', fundingStatus: 'PAID', quotaAuthorized: true, approvedCreativeCount: 1, checksumVerifiedAssetCount: 0 }]), ['ASSET_UNAVAILABLE'])
  assert.deepEqual(reasons([{ status: 'ACTIVE', fundingStatus: 'PAID', quotaAuthorized: true, approvedCreativeCount: 0, checksumVerifiedAssetCount: 0 }], 0), ['NO_ASSIGNMENT'])
  // Legacy campaign dates and daily windows are deliberately not inputs to state-based eligibility.
  assert.deepEqual(reasons([{ status: 'ACTIVE', fundingStatus: 'PAID', quotaAuthorized: true, approvedCreativeCount: 1, checksumVerifiedAssetCount: 1 }], 1, 1), [])
})

test('manifest delivery requires active asset metadata and an actual SHA-256 digest', () => {
  assert.equal(hasVerifiedAssetMetadata({ active: true, url: 'https://cdn.example/ad.mp4', checksum: 'a'.repeat(64) }), true)
  assert.equal(hasVerifiedAssetMetadata({ active: true, url: 'https://cdn.example/ad.mp4', checksum: null }), false)
  assert.equal(hasVerifiedAssetMetadata({ active: true, url: 'https://cdn.example/ad.mp4', checksum: 'not-a-digest' }), false)
  assert.equal(hasVerifiedAssetMetadata({ active: false, url: 'https://cdn.example/ad.mp4', checksum: 'a'.repeat(64) }), false)
  assert.equal(hasVerifiedAssetMetadata(null), false)
})

test('relative asset URLs become device-fetchable URLs in development', () => {
  const base = process.env.PUBLIC_ASSET_BASE_URL?.replace(/\/$/, '') || 'http://127.0.0.1:3000'
  assert.equal(deliveryAssetUrl('/uploads/creative.png'), `${base}/uploads/creative.png`)
  assert.equal(deliveryAssetUrl('https://cdn.example/creative.png'), 'https://cdn.example/creative.png')
})

test('configured LAN asset base replaces persisted localhost URLs', () => {
  const previous = process.env.PUBLIC_ASSET_BASE_URL
  process.env.PUBLIC_ASSET_BASE_URL = 'http://172.20.10.5:3000'
  assert.equal(deliveryAssetUrl('http://localhost:3000/uploads/creative.png'), 'http://172.20.10.5:3000/uploads/creative.png')
  if (previous === undefined) delete process.env.PUBLIC_ASSET_BASE_URL
  else process.env.PUBLIC_ASSET_BASE_URL = previous
})

test('manifest version changes for creative offer and layout changes but not unchanged content', () => {
  const base = { displayId: 'screen-1', layout: { type: 'AD_NAV_OFFER' }, items: [{ creativeId: 'creative-a', assetId: 'asset-a', offer: { offerTitle: 'Offer A', qrUrl: 'https://theooro.com/go/token-a' } }] }
  assert.equal(manifestVersionFor(base), manifestVersionFor(structuredClone(base)))
  assert.notEqual(manifestVersionFor(base), manifestVersionFor({ ...base, items: [{ ...base.items[0], offer: { offerTitle: 'Offer B', qrUrl: 'https://theooro.com/go/token-b' } }] }))
  assert.notEqual(manifestVersionFor(base), manifestVersionFor({ ...base, layout: { type: 'SPLIT_50_25_25' } }))
  assert.notEqual(manifestVersionFor(base), manifestVersionFor({ ...base, layout: { type: 'AD_NAV_OFFER', contractVersion: 2 } }))
})

test('QR destinations require HTTPS outside local development', () => {
  assert.equal(safeDestination('javascript:alert(1)', false), null)
  assert.equal(safeDestination('http://evil.example/offer', false), null)
  assert.equal(safeDestination('https://example.com/offer', false), 'https://example.com/offer')
})
