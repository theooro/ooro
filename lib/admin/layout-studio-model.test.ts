import test from 'node:test'
import assert from 'node:assert/strict'
import { standardV3Draft } from '../../apps/api/src/domain/layout-studio'
import { changeLayoutWidgetType, layoutCatalogSchema, matchingLayoutCreatives, readLayoutResponse, selectLayoutProfile, selectLayoutScreenType } from './layout-studio-model'

test('profile/type selection persists a coherent target and version; switching clears stale profile metadata', () => {
  const mbox = selectLayoutProfile(standardV3Draft(), 'MBOX_ANDROID10_1280_720_V1')
  assert.deepEqual(mbox.target, { width: 1280, height: 720 }); assert.equal(mbox.capabilityProfileVersion, 1); assert.equal(mbox.screenType, 'AUTO_SCREEN')
  const retail = selectLayoutScreenType(mbox, 'RETAIL_EVENT')
  assert.deepEqual(retail.target, { width: 1080, height: 1920 }); assert.equal(retail.profileId, 'OORO_RETAIL_EVENT'); assert.equal(retail.capabilityProfileVersion, undefined)
})

test('widget type changes reset incompatible references and media choices match the widget type/slot', () => {
  const zone = changeLayoutWidgetType(standardV3Draft().zones[0]!, 'IMAGE')
  assert.deepEqual(zone.contentBinding, { kind: 'APPROVED_CREATIVE' }); assert.equal(zone.fit, 'FIT')
  const campaign = { id: '11111111-1111-4111-8111-111111111111', name: 'Approved catalog', deliverySlot: 'MAIN' }
  const catalog = layoutCatalogSchema.parse({ creatives: [
    { id: '22222222-2222-4222-8222-222222222222', name: 'Image', type: 'IMAGE', campaign },
    { id: '33333333-3333-4333-8333-333333333333', name: 'Video', type: 'VIDEO', campaign },
  ], destinations: [] })
  assert.deepEqual(matchingLayoutCreatives(catalog, zone).map(item => item.name), ['Image'])
  assert.deepEqual(matchingLayoutCreatives(catalog, changeLayoutWidgetType(zone, 'VIDEO')).map(item => item.name), ['Video'])
  assert.deepEqual(changeLayoutWidgetType(zone, 'TEXT').contentBinding, { kind: 'NONE' })
})

test('catalog and API failures are visible, include status/request ID, and are not converted to empty data', async () => {
  await assert.rejects(readLayoutResponse(new Response(JSON.stringify({ error: { message: 'Catalog access denied' }, requestId: 'req-catalog' }), { status: 403 })), /Catalog access denied.*HTTP 403.*req-catalog/)
  await assert.rejects(readLayoutResponse(new Response('upstream unavailable', { status: 503 })), /HTTP 503/)
  await assert.rejects(readLayoutResponse(new Response('{}', { status: 200 })), /Invalid Layout Studio response/)
  assert.equal(layoutCatalogSchema.safeParse({ creatives: {}, destinations: [] }).success, false)
})
