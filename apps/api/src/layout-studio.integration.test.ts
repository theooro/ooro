import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { app } from './server.js'
import { prisma } from './prisma.js'
import { issueTokens } from './http.js'
import { MBOX_PROFILE_ID } from './domain/layout-studio.js'
import { deliverableLayoutContract } from './domain/layout-manifest.js'
import { standardV3Draft, type LayoutDraft } from './domain/layout-studio.js'

const enabled = process.env.OORO_LAYOUT_STUDIO_INTEGRATION_TESTS === 'true'
  && /@127\.0\.0\.1:55432\/ooro_test(?:\?|$)/.test(process.env.DATABASE_URL ?? '')

test('Layout Studio persists drafts, enforces Super Admin publication and keeps assignment disabled', { skip: !enabled }, async () => {
  const suffix = randomUUID()
  const superAdmin = await prisma.user.create({ data: { phone: `layout-super-${suffix}`, role: 'SUPER_ADMIN', accountStatus: 'ACTIVE' } })
  const admin = await prisma.user.create({ data: { phone: `layout-admin-${suffix}`, role: 'ADMIN', accountStatus: 'ACTIVE' } })
  const superToken = (await issueTokens(superAdmin.id, superAdmin.role)).accessToken
  const adminToken = (await issueTokens(admin.id, admin.role)).accessToken
  const superHeaders = { authorization: `Bearer ${superToken}` }
  const adminHeaders = { authorization: `Bearer ${adminToken}` }
  const draft = standardV3Draft()
  try {
    const created = await app.inject({ method: 'POST', url: '/api/admin/layout-studio', headers: superHeaders, payload: { name: `Disposable ${suffix}`, contract: draft } })
    assert.equal(created.statusCode, 201, created.body)
    const id = created.json().data.id as string
    const save = await app.inject({ method: 'PUT', url: `/api/admin/layout-studio/${id}/draft`, headers: superHeaders, payload: { expectedRowVersion: 1, name: `Disposable ${suffix} edited`, contract: draft } })
    assert.equal(save.statusCode, 200, save.body)
    assert.equal(save.json().data.rowVersion, 2)
    const alteredStandard = structuredClone(draft)
    alteredStandard.zones[0]!.geometry.width = 0.79
    const rejectedStandardCreate = await app.inject({ method: 'POST', url: '/api/admin/layout-studio', headers: superHeaders, payload: { name: `Invalid Standard ${suffix}`, contract: alteredStandard } })
    assert.equal(rejectedStandardCreate.statusCode, 422)
    const rejectedStandardUpdate = await app.inject({ method: 'PUT', url: `/api/admin/layout-studio/${id}/draft`, headers: superHeaders, payload: { expectedRowVersion: 2, name: 'Altered Standard', contract: alteredStandard } })
    assert.equal(rejectedStandardUpdate.statusCode, 422)
    const unchangedStandard = await app.inject({ method: 'GET', url: `/api/admin/layout-studio/${id}`, headers: superHeaders })
    assert.equal(unchangedStandard.json().data.draftContract.zones[0].geometry.width, 0.8)
    assert.equal(unchangedStandard.json().data.rowVersion, 2)
    const stale = await app.inject({ method: 'PUT', url: `/api/admin/layout-studio/${id}/draft`, headers: superHeaders, payload: { expectedRowVersion: 1, name: 'stale', contract: draft } })
    assert.equal(stale.statusCode, 409)
    const adminPublish = await app.inject({ method: 'POST', url: `/api/admin/layout-studio/${id}/publish`, headers: adminHeaders, payload: { expectedRowVersion: 2 } })
    assert.equal(adminPublish.statusCode, 403)
    const validated = await app.inject({ method: 'POST', url: `/api/admin/layout-studio/${id}/validate`, headers: superHeaders, payload: { expectedRowVersion: 2 } })
    assert.equal(validated.statusCode, 200, validated.body)
    assert.equal(validated.json().data.valid, true)
    const published = await app.inject({ method: 'POST', url: `/api/admin/layout-studio/${id}/publish`, headers: superHeaders, payload: { expectedRowVersion: validated.json().data.rowVersion } })
    assert.equal(published.statusCode, 201, published.body)
    const assignment = await app.inject({ method: 'POST', url: `/api/admin/layout-studio/${id}/assign`, headers: superHeaders, payload: { displayId: randomUUID() } })
    assert.equal(assignment.statusCode, 409)
    assert.equal(assignment.json().error.code, 'LAYOUT_ASSIGNMENT_DISABLED')

    const rotationCampaign = await prisma.campaign.create({
      data: {
        name: `Rotation fixtures ${suffix}`, status: 'ACTIVE', commercialFundingStatus: 'PAID',
        creatives: { create: [
          { name: 'Rotation image A', status: 'APPROVED', type: 'IMAGE', asset: { create: { fileName: 'rotation-a.png', storageKey: `layout-test/${suffix}-a.png`, url: 'https://example.com/rotation-a.png', checksum: 'c'.repeat(64), mimeType: 'image/png', active: true } } },
          { name: 'Rotation image B', status: 'APPROVED', type: 'IMAGE', asset: { create: { fileName: 'rotation-b.png', storageKey: `layout-test/${suffix}-b.png`, url: 'https://example.com/rotation-b.png', checksum: 'd'.repeat(64), mimeType: 'image/png', active: true } } },
        ] },
      },
      include: { creatives: true },
    })
    const customDraft = {
      ...standardV3Draft(),
      mode: 'CUSTOM' as const,
      preset: 'CUSTOM_CANVAS' as const,
      profileId: 'OORO_PREMIUM' as const,
      zones: [{
        id: 'custom-image', type: 'IMAGE' as const, label: 'Custom media', schemaVersion: 1 as const,
        geometry: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, zIndex: 0,
        fit: 'FIT' as const, contentBinding: { kind: 'NONE' as const }, visible: true,
        rotation: { version: 1 as const, mode: 'SEQUENTIAL' as const, items: [
          { referenceId: rotationCampaign.creatives[0]!.id, durationSeconds: 5 },
          { referenceId: rotationCampaign.creatives[1]!.id, durationSeconds: 12 },
        ] },
      }],
    }
    const invalidRotation = structuredClone(customDraft)
    invalidRotation.zones[0]!.rotation!.items[0]!.durationSeconds = 2
    const invalidRotationResponse = await app.inject({ method: 'POST', url: '/api/admin/layout-studio', headers: superHeaders, payload: { name: `Invalid rotation ${suffix}`, contract: invalidRotation } })
    assert.equal(invalidRotationResponse.statusCode, 422)
    const customCreated = await app.inject({ method: 'POST', url: '/api/admin/layout-studio', headers: superHeaders, payload: { name: `Uncertified draft ${suffix}`, contract: customDraft } })
    assert.equal(customCreated.statusCode, 201, customCreated.body)
    const customId = customCreated.json().data.id as string
    const customValidation = await app.inject({ method: 'POST', url: `/api/admin/layout-studio/${customId}/validate`, headers: superHeaders, payload: { expectedRowVersion: 1 } })
    assert.equal(customValidation.statusCode, 200, customValidation.body)
    assert.equal(customValidation.json().data.valid, false)
    assert.ok(customValidation.json().data.issues.some((issue: { code: string }) => issue.code === 'CAPABILITY_PROFILE_UNVERIFIED'))
    const customSave = await app.inject({ method: 'PUT', url: `/api/admin/layout-studio/${customId}/draft`, headers: superHeaders, payload: { expectedRowVersion: 1, name: `Uncertified draft saved ${suffix}`, contract: customDraft } })
    assert.equal(customSave.statusCode, 200, customSave.body)
    assert.equal(customSave.json().data.rowVersion, 2)
    assert.equal(customSave.json().data.draftContract.zones[0].rotation.items[1].durationSeconds, 12)

    const proofsBefore = await prisma.proofOfPlay.count({ where: { campaignId: rotationCampaign.id } })
    const mboxDraft: LayoutDraft = { ...customDraft, profileId: MBOX_PROFILE_ID, capabilityProfileVersion: 1, screenType: 'AUTO_SCREEN', zones: [{ ...customDraft.zones[0]!, rotation: undefined, contentBinding: { kind: 'APPROVED_CREATIVE', referenceId: rotationCampaign.creatives[0]!.id } }] }
    const emptyDraft = await app.inject({ method: 'POST', url: '/api/admin/layout-studio', headers: superHeaders, payload: { name: `Empty draft ${suffix}`, contract: { ...mboxDraft, zones: [] } } })
    assert.equal(emptyDraft.statusCode, 201)
    const emptyCheck = await app.inject({ method: 'POST', url: `/api/admin/layout-studio/${emptyDraft.json().data.id}/validate`, headers: superHeaders, payload: { expectedRowVersion: 1 } })
    assert.ok(emptyCheck.json().data.issues.some((issue: { code: string }) => issue.code === 'NO_VISIBLE_ZONES'))
    const mboxCreated = await app.inject({ method: 'POST', url: '/api/admin/layout-studio', headers: superHeaders, payload: { name: `MBOX candidate ${suffix}`, contract: mboxDraft } })
    assert.equal(mboxCreated.statusCode, 201, mboxCreated.body)
    const mboxId = mboxCreated.json().data.id as string
    const readBack = await app.inject({ method: 'GET', url: `/api/admin/layout-studio/${mboxId}`, headers: superHeaders })
    assert.equal(readBack.json().data.profileId, MBOX_PROFILE_ID)
    assert.deepEqual(readBack.json().data.draftContract, JSON.parse(JSON.stringify(mboxDraft)))
    const checked = await app.inject({ method: 'POST', url: `/api/admin/layout-studio/${mboxId}/validate`, headers: superHeaders, payload: { expectedRowVersion: 1 } })
    assert.equal(checked.statusCode, 200)
    assert.equal(checked.json().data.valid, false)
    assert.ok(checked.json().data.issues.some((issue: { code: string }) => issue.code === 'WIDGET_CERTIFICATION_REQUIRED'))
    assert.ok(checked.json().data.issues.some((issue: { code: string }) => issue.code === 'PROFILE_RESOURCE_BUDGET_UNVERIFIED'))
    // A tampered state in this disposable fixture must not bypass certification at publication.
    await prisma.layoutTemplate.update({ where: { id: mboxId }, data: { state: 'VALIDATED' } })
    const blockedPublish = await app.inject({ method: 'POST', url: `/api/admin/layout-studio/${mboxId}/publish`, headers: superHeaders, payload: { expectedRowVersion: 1 } })
    assert.equal(blockedPublish.statusCode, 422)
    assert.equal(await prisma.layoutRevision.count({ where: { templateId: mboxId } }), 0)
    assert.equal(deliverableLayoutContract(mboxDraft, [{ creativeId: rotationCampaign.creatives[0]!.id, type: 'IMAGE', checksum: 'c'.repeat(64) }]), null)
    const catalog = await app.inject({ method: 'GET', url: '/api/admin/layout-studio/content', headers: superHeaders })
    assert.equal(catalog.statusCode, 200)
    assert.ok(catalog.json().data.creatives.some((creative: { id: string; previewUrl?: string }) => creative.id === rotationCampaign.creatives[0]!.id && creative.previewUrl))
    const wrongTarget = await app.inject({ method: 'POST', url: '/api/admin/layout-studio', headers: superHeaders, payload: { name: 'Wrong profile target', contract: { ...mboxDraft, target: { width: 720, height: 1280 } } } })
    assert.equal(wrongTarget.statusCode, 422)
    const videoCreative = await prisma.creative.create({ data: { campaignId: rotationCampaign.id, name: 'Wrong image binding video', status: 'APPROVED', type: 'VIDEO', asset: { create: { fileName: 'video.mp4', storageKey: `layout-test/${suffix}-video.mp4`, url: 'https://example.invalid/video.mp4', checksum: 'e'.repeat(64), mimeType: 'video/mp4', active: true } } } })
    const wrongType = await app.inject({ method: 'POST', url: '/api/admin/layout-studio', headers: superHeaders, payload: { name: 'Wrong type', contract: { ...mboxDraft, zones: [{ ...mboxDraft.zones[0], contentBinding: { kind: 'APPROVED_CREATIVE', referenceId: videoCreative.id } }] } } })
    assert.equal(wrongType.statusCode, 422)
    await prisma.asset.update({ where: { creativeId: rotationCampaign.creatives[0]!.id }, data: { checksum: 'missing-verification' } })
    const missingChecksum = await app.inject({ method: 'POST', url: '/api/admin/layout-studio', headers: superHeaders, payload: { name: 'Unverifiable image', contract: mboxDraft } })
    assert.equal(missingChecksum.statusCode, 422)
    assert.equal(await prisma.proofOfPlay.count({ where: { campaignId: rotationCampaign.id } }), proofsBefore)

  } finally {
    await app.close()
    await prisma.$disconnect()
  }
})
