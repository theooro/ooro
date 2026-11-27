import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { prisma } from './prisma.js'
import { buildDisplayManifest, MBOX_AD_QR_SPONSOR_CONTRACT_V1 } from './domain/campaign-eligibility.js'

// Only opt in against the repository's disposable local audit database.
const enabled = process.env.OORO_INTEGRATION_TESTS === 'true'
  && /127\.0\.0\.1:55432\/ooro_audit(?:\?|$)/.test(process.env.DATABASE_URL ?? '')

test('MBOX built-in layout manifest carries only main and sponsored ad slots plus an eligible canonical QR', { skip: !enabled }, async () => {
  const suffix = randomUUID()
  const now = new Date()
  const screen = await prisma.display.create({ data: {
    deviceId: `mbox-layout-${suffix}`,
    deviceTokenHash: createHash('sha256').update(suffix).digest('hex'),
    name: 'MBOX layout contract integration screen',
    state: 'READY',
    supportsDeliveryQuota: true,
  } })
  const campaign = await prisma.campaign.create({ data: {
    name: `MBOX layout contract ${suffix}`,
    status: 'ACTIVE',
    commercialFundingStatus: 'PAID',
    startsAt: new Date(now.getTime() - 60_000),
    endsAt: new Date(now.getTime() + 60_000),
    layout: 'MBOX_AD_QR_SPONSOR_V1',
    metadata: { presentationLayout: 'MBOX_AD_QR_SPONSOR_V1', offer: { brandName: 'Fixture Brand', offerTitle: 'Fixture offer', ctaUrl: 'https://merchant.example/offers/42' } },
    creatives: { create: [
      {
        name: 'approved main', type: 'IMAGE', status: 'APPROVED', deliverySlot: 'MAIN', durationSeconds: 10,
        qrEnabled: true, qrTargetUrl: 'https://merchant.example/offers/42',
        asset: { create: { fileName: 'main.png', storageKey: `mbox-layout/${suffix}/main.png`, url: 'https://assets.example.invalid/main.png', checksum: 'a'.repeat(64), mimeType: 'image/png', active: true } },
      },
      {
        name: 'approved sponsor', type: 'IMAGE', status: 'APPROVED', deliverySlot: 'SPONSORED', durationSeconds: 10,
        asset: { create: { fileName: 'sponsor.png', storageKey: `mbox-layout/${suffix}/sponsor.png`, url: 'https://assets.example.invalid/sponsor.png', checksum: 'b'.repeat(64), mimeType: 'image/png', active: true } },
      },
    ] },
  }, include: { creatives: true } })

  try {
    await prisma.displayCampaignAssignment.create({ data: {
      campaignId: campaign.id,
      displayId: screen.id,
      active: true,
      unlimitedOfflineAuthorized: true,
    } })
    await prisma.displayZoneConfig.create({ data: { displayId: screen.id, layoutContractVersion: 2 } })

    const { manifest } = await buildDisplayManifest(screen.id, now)
    assert.deepEqual(manifest.layout, { ...MBOX_AD_QR_SPONSOR_CONTRACT_V1, newsScrollSpeed: 42 })
    assert.equal(manifest.items.length, 1)
    assert.equal(manifest.items[0]?.id, campaign.creatives.find(creative => creative.deliverySlot === 'MAIN')?.id)
    assert.equal(manifest.items[0]?.qrEnabled, true)
    assert.match(manifest.items[0]?.qrTargetUrl ?? '', /^https:\/\/theooro\.com\/go\/[A-Za-z0-9_-]{32}$/)
    assert.doesNotMatch(manifest.items[0]?.qrTargetUrl ?? '', /api-staging|staging\.theooro/)
    assert.equal(manifest.sponsoredItem?.id, campaign.creatives.find(creative => creative.deliverySlot === 'SPONSORED')?.id)
    assert.equal(manifest.news.announcements.length, 0)
    assert.equal('map' in manifest.layout, false)
    assert.equal('navigation' in manifest.layout, false)
  } finally {
    await prisma.campaign.deleteMany({ where: { id: campaign.id } })
    await prisma.display.deleteMany({ where: { id: screen.id } })
  }
})
