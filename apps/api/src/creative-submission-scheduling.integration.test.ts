import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { prisma } from './prisma.js'
import { addApprovedSubmissionToCampaign } from './domain/creative-submission-scheduling.js'
import { buildDisplayManifest } from './domain/campaign-eligibility.js'
import { campaignDateWindow } from './domain/campaign-date-window.js'

const enabled = process.env.OORO_INTEGRATION_TESTS === 'true' && /127\.0\.0\.1:55432\/ooro_audit/.test(process.env.DATABASE_URL ?? '')

test('approved standalone submission remains detached until admin assignment and never bypasses campaign delivery checks', { skip: !enabled }, async () => {
  const suffix = randomUUID()
  const organization = await prisma.organization.create({ data: { name: `Submission test ${suffix}`, type: 'BRAND', verificationStatus: 'VERIFIED' } })
  const adminUser = await prisma.user.create({ data: { email: `admin-${suffix}@example.invalid`, name: 'Integration admin', role: 'ADMIN', accountStatus: 'ACTIVE' } })
  const screen = await prisma.display.create({ data: { deviceId: `submission-screen-${suffix}`, name: 'Submission test screen', state: 'READY' } })
  const window = campaignDateWindow('2099-11-22', '2099-11-22')
  const campaign = await prisma.campaign.create({ data: { name: `Submission campaign ${suffix}`, status: 'DRAFT', commercialFundingStatus: 'PENDING', startsAt: window.startsAt, endsAt: window.endsAt, timezone: window.timezone } })
  const submission = await prisma.creativeSubmission.create({ data: { organizationId: organization.id, submitterUserId: randomUUID(), submitterEmail: 'test@example.invalid', fileName: 'verified.jpg', type: 'IMAGE', status: 'PENDING_REVIEW', storageKey: `submissions/${suffix}.jpg`, url: 'https://assets.example.invalid/test.jpg', checksum: 'a'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 1234n, width: 1280, height: 720 } })
  const rejected = await prisma.creativeSubmission.create({ data: { organizationId: organization.id, submitterUserId: randomUUID(), submitterEmail: 'test@example.invalid', fileName: 'rejected.jpg', type: 'IMAGE', status: 'REJECTED', storageKey: `submissions/${suffix}-rejected.jpg`, url: 'https://assets.example.invalid/rejected.jpg', checksum: 'b'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 1234n } })
  try {
    const admin = { userId: adminUser.id, role: 'ADMIN' }
    const pending = await prisma.$transaction(tx => addApprovedSubmissionToCampaign(tx, { submissionId: submission.id, campaignId: campaign.id, admin }))
    assert.equal(pending.ok, false)
    assert.equal((await prisma.creative.count({ where: { campaignId: campaign.id } })), 0)

    await prisma.$transaction(async tx => {
      await tx.creativeSubmission.update({ where: { id: submission.id }, data: { status: 'APPROVED', reviewerId: admin.userId, reviewerRole: admin.role, reviewedAt: new Date() } })
      await tx.auditLog.create({ data: { actorId: admin.userId, actorRole: admin.role, action: 'CREATIVE_SUBMISSION_REVIEWED', entityType: 'CreativeSubmission', entityId: submission.id, after: { status: 'APPROVED' } } })
    })
    const afterApproval = await prisma.creativeSubmission.findUniqueOrThrow({ where: { id: submission.id } })
    assert.equal(afterApproval.scheduledCreativeId, null)
    assert.equal(await prisma.displayCommand.count({ where: { displayId: screen.id } }), 0)
    assert.equal(await prisma.displayCampaignAssignment.count({ where: { displayId: screen.id, campaignId: campaign.id } }), 0)
    assert.equal((await buildDisplayManifest(screen.id)).manifest.items.length, 0)

    const deniedRejected = await prisma.$transaction(tx => addApprovedSubmissionToCampaign(tx, { submissionId: rejected.id, campaignId: campaign.id, admin }))
    assert.equal(deniedRejected.ok, false)
    assert.equal(deniedRejected.code, 'CREATIVE_SUBMISSION_NOT_APPROVED')

    const added = await prisma.$transaction(tx => addApprovedSubmissionToCampaign(tx, { submissionId: submission.id, campaignId: campaign.id, admin }), { isolationLevel: 'Serializable' })
    assert.equal(added.ok, true)
    if (!added.ok) return
    const linked = await prisma.creativeSubmission.findUniqueOrThrow({ where: { id: submission.id }, include: { scheduledCreative: { include: { asset: true } } } })
    assert.equal(linked.scheduledCreativeId, added.creativeId)
    assert.equal(linked.scheduledCreative?.campaignId, campaign.id)
    assert.equal(linked.scheduledCreative?.asset?.storageKey, submission.storageKey)
    assert.equal(await prisma.displayCommand.count({ where: { displayId: screen.id } }), 0)
    assert.equal(await prisma.displayCampaignAssignment.count({ where: { displayId: screen.id, campaignId: campaign.id } }), 0)
    assert.equal((await buildDisplayManifest(screen.id)).manifest.items.length, 0)
    const duplicate = await prisma.$transaction(tx => addApprovedSubmissionToCampaign(tx, { submissionId: submission.id, campaignId: campaign.id, admin }))
    assert.equal(duplicate.ok, false)
  } finally {
    await prisma.display.deleteMany({ where: { id: screen.id } })
    await prisma.creativeSubmission.deleteMany({ where: { id: { in: [submission.id, rejected.id] } } })
    await prisma.campaign.deleteMany({ where: { id: campaign.id } })
    await prisma.organization.deleteMany({ where: { id: organization.id } })
    await prisma.user.deleteMany({ where: { id: adminUser.id } })
  }
})
