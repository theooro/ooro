import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { app } from './server.js'
import { prisma } from './prisma.js'
import { hashSecret, issueTokens } from './http.js'
import { config } from './config.js'
import { encryptDisplayRecoveryCode } from './domain/display-recovery-code.js'

const enabled = process.env.OORO_INTEGRATION_TESTS === 'true' && /127\.0\.0\.1:55439\/ooro_recovery_test/.test(process.env.DATABASE_URL ?? '')

test('Screen Player recovery reuses one screen code, retries credentials idempotently, reveals without mutation, and blocks cross-screen claims', { skip: !enabled }, async () => {
  const suffix = randomUUID()
  const code = `RECOVERY${suffix.replaceAll('-', '').slice(0, 10).toUpperCase()}`
  const displayIdOne = randomUUID()
  const displayIdTwo = randomUUID()
  const deletedOwnerId = randomUUID()
  const admin = await prisma.user.create({ data: { phone: `recovery-admin-${suffix}`, role: 'ADMIN', accountStatus: 'ACTIVE' } })
  const support = await prisma.user.create({ data: { phone: `recovery-support-${suffix}`, role: 'SUPPORT', accountStatus: 'ACTIVE' } })
  const { accessToken: adminToken } = await issueTokens(admin.id, admin.role)
  const { accessToken: supportToken } = await issueTokens(support.id, support.role)
  const deviceIdOne = `recovery-device-one-${suffix}`
  const deviceIdTwo = `recovery-device-two-${suffix}`
  let campaignId: string | undefined
  try {
    const one = await prisma.display.create({ data: { id: displayIdOne, deviceId: deviceIdOne, name: 'Recovery screen one', state: 'READY', deviceTokenHash: hashSecret(`old-${suffix}`) } })
    const two = await prisma.display.create({ data: { id: displayIdTwo, deviceId: deviceIdTwo, name: 'Recovery screen two', state: 'READY' } })
    const campaign = await prisma.campaign.create({ data: { name: `Recovery assignment ${suffix}`, status: 'DRAFT' } })
    campaignId = campaign.id
    await prisma.displayCampaignAssignment.create({ data: { displayId: one.id, campaignId: campaign.id, active: true, offlinePlaysAuthorized: 2 } })
    await prisma.displayRecoveryCode.create({ data: { displayId: one.id, codeHash: hashSecret(code), encryptedCode: encryptDisplayRecoveryCode(code, config.documentStorageKey), codeLast4: code.slice(-4) } })

    const reveal = await app.inject({ method: 'POST', url: '/api/displays/pairing-code', headers: { authorization: `Bearer ${adminToken}` }, payload: { displayId: one.id } })
    assert.equal(reveal.statusCode, 200)
    assert.ok(reveal.json().data.pairingCode === code)
    assert.equal((await prisma.display.findUniqueOrThrow({ where: { id: one.id } })).pairingStatus, 'RECOVERY_REQUESTED')
    const deniedReveal = await app.inject({ method: 'POST', url: '/api/displays/pairing-code', headers: { authorization: `Bearer ${supportToken}` }, payload: { displayId: one.id } })
    assert.equal(deniedReveal.statusCode, 403)

    const readOnlyReveal = await app.inject({ method: 'GET', url: `/api/displays/${one.id}/recovery-code`, headers: { authorization: `Bearer ${adminToken}` } })
    assert.equal(readOnlyReveal.statusCode, 200)
    assert.ok(readOnlyReveal.json().data.pairingCode === code)
    assert.equal((await prisma.display.findUniqueOrThrow({ where: { id: one.id } })).pairingStatus, 'RECOVERY_REQUESTED')
    assert.equal((await app.inject({ method: 'GET', url: `/api/displays/${one.id}/recovery-code`, headers: { authorization: `Bearer ${supportToken}` } })).statusCode, 403)

    const firstPair = await app.inject({ method: 'POST', url: '/api/device/pair', payload: { pairingCode: code.toLowerCase(), deviceId: deviceIdOne, appVersion: 'test' } })
    assert.equal(firstPair.statusCode, 200)
    assert.equal(firstPair.json().data.pairingStatus, 'PAIRING_PENDING')
    const firstToken = firstPair.json().data.deviceToken as string
    assert.equal(firstPair.json().data.screenId, one.id)

    const secondPair = await app.inject({ method: 'POST', url: '/api/device/pair', payload: { pairingCode: code, deviceId: deviceIdOne, appVersion: 'test-reinstalled' } })
    assert.equal(secondPair.statusCode, 200)
    const secondToken = secondPair.json().data.deviceToken as string
    assert.ok(secondToken === firstToken)
    assert.equal(secondPair.json().data.screenId, one.id)
    assert.equal((await prisma.display.findUniqueOrThrow({ where: { id: one.id } })).pairingStatus, 'PAIRING_PENDING')
    assert.equal((await prisma.display.findUniqueOrThrow({ where: { id: one.id } })).name, 'Recovery screen one')
    assert.equal(await prisma.displayRecoveryCode.count({ where: { displayId: one.id, revokedAt: null } }), 1)
    assert.equal(await prisma.displayCampaignAssignment.count({ where: { displayId: one.id, campaignId: campaign.id, active: true } }), 1)

    const staleCredential = await app.inject({ method: 'GET', url: '/api/device/manifest', headers: { authorization: `Bearer ${firstToken}` } })
    assert.equal(staleCredential.statusCode, 200)
    const currentCredential = await app.inject({ method: 'GET', url: '/api/device/manifest', headers: { authorization: `Bearer ${secondToken}` } })
    assert.equal(currentCredential.statusCode, 200)
    const failedRecovery = await app.inject({ method: 'POST', url: '/api/device/pairing-failed', headers: { authorization: `Bearer ${secondToken}` }, payload: { failureStage: 'AUTHORIZATION_RESET', exceptionClass: 'SQLiteConstraintException', sqliteCode: 19 } })
    assert.equal(failedRecovery.statusCode, 200)
    assert.equal((await prisma.display.findUniqueOrThrow({ where: { id: one.id } })).pairingStatus, 'PAIRING_FAILED')
    const authenticatedHeartbeat = await app.inject({ method: 'POST', url: '/api/device/heartbeat', headers: { authorization: `Bearer ${secondToken}` }, payload: { appVersion: 'test', networkConnected: true } })
    assert.equal(authenticatedHeartbeat.statusCode, 200)
    const pairedAfterHeartbeat = await prisma.display.findUniqueOrThrow({ where: { id: one.id } })
    assert.equal(pairedAfterHeartbeat.pairingStatus, 'PAIRED')
    assert.ok(pairedAfterHeartbeat.pairedAt)
    const revealPaired = await app.inject({ method: 'GET', url: `/api/displays/${one.id}/recovery-code`, headers: { authorization: `Bearer ${adminToken}` } })
    assert.equal(revealPaired.statusCode, 200)
    assert.equal((await prisma.display.findUniqueOrThrow({ where: { id: one.id } })).pairingStatus, 'PAIRED')
    const absent = await app.inject({ method: 'GET', url: `/api/displays/${two.id}/recovery-code`, headers: { authorization: `Bearer ${adminToken}` } })
    assert.equal(absent.statusCode, 200)
    assert.equal(absent.json().data, null)
    assert.equal(await prisma.displayRecoveryCode.count({ where: { displayId: two.id } }), 0)
    const crossScreen = await app.inject({ method: 'POST', url: '/api/device/pair', payload: { pairingCode: code, deviceId: deviceIdTwo } })
    assert.equal(crossScreen.statusCode, 409)
    assert.equal((await prisma.display.findUniqueOrThrow({ where: { id: two.id } })).deviceTokenHash, null)
    const deletedDeviceId = 'deleted-device-' + suffix
    const reclaimCode = 'RECLAIM' + suffix.replaceAll('-', '').slice(0, 10).toUpperCase()
    const deletedOwner = await prisma.display.create({ data: { id: deletedOwnerId, deviceId: deletedDeviceId, name: 'Removed screen record', state: 'DELETED', pairingStatus: 'UNPAIRED' } })
    await prisma.displayRecoveryCode.create({ data: { displayId: two.id, codeHash: hashSecret(reclaimCode), encryptedCode: encryptDisplayRecoveryCode(reclaimCode, config.documentStorageKey), codeLast4: reclaimCode.slice(-4) } })
    const reclaimed = await app.inject({ method: 'POST', url: '/api/device/pair', payload: { pairingCode: reclaimCode, deviceId: deletedDeviceId, appVersion: 'test-reclaim' } })
    assert.equal(reclaimed.statusCode, 200)
    assert.equal(reclaimed.json().data.screenId, two.id)
    const archivedOwnerAfter = await prisma.display.findUniqueOrThrow({ where: { id: deletedOwner.id } })
    const reclaimedDisplay = await prisma.display.findUniqueOrThrow({ where: { id: two.id } })
    assert.equal(archivedOwnerAfter.state, 'DELETED')
    assert.equal(archivedOwnerAfter.pairingStatus, 'UNPAIRED')
    assert.equal(archivedOwnerAfter.deviceTokenHash, null)
    assert.notEqual(archivedOwnerAfter.deviceId, deletedDeviceId)
    assert.equal(reclaimedDisplay.deviceId, deletedDeviceId)
    assert.equal(reclaimedDisplay.pairingStatus, 'PAIRING_PENDING')
    const reclaimAudit = await prisma.auditLog.findFirst({ where: { entityId: deletedOwner.id, action: 'SCREEN_DEVICE_ID_RECLAIMED_FROM_DELETED_RECORD' } })
    assert.equal(reclaimAudit?.after && (reclaimAudit.after as { reassignedToDisplayId?: string }).reassignedToDisplayId, two.id)
    const invalid = await app.inject({ method: 'POST', url: '/api/device/pair', payload: { pairingCode: randomUUID().replaceAll('-', ''), deviceId: `invalid-${suffix}` } })
    assert.equal(invalid.statusCode, 400)

    const rotate = await app.inject({ method: 'POST', url: `/api/displays/${one.id}/recovery-code/rotate`, headers: { authorization: `Bearer ${adminToken}` } })
    assert.equal(rotate.statusCode, 200)
    const rotatedCode = rotate.json().data.pairingCode as string
    assert.ok(rotatedCode !== code)
    const oldCode = await app.inject({ method: 'POST', url: '/api/device/pair', payload: { pairingCode: code, deviceId: deviceIdOne } })
    assert.equal(oldCode.statusCode, 400)
    const revoke = await app.inject({ method: 'POST', url: `/api/displays/${one.id}/recovery-code/revoke`, headers: { authorization: `Bearer ${adminToken}` } })
    assert.equal(revoke.statusCode, 200)
    const revokedCode = await app.inject({ method: 'POST', url: '/api/device/pair', payload: { pairingCode: rotatedCode, deviceId: deviceIdOne } })
    assert.equal(revokedCode.statusCode, 400)
    const audit = await prisma.auditLog.findMany({ where: { entityId: one.id, action: { in: ['SCREEN_RECOVERY_REQUESTED', 'SCREEN_PLAYER_RECOVERY_ACCEPTED', 'SCREEN_PLAYER_RECOVERY_FAILED', 'SCREEN_RECOVERY_CODE_REVEALED', 'SCREEN_RECOVERY_CODE_ROTATED', 'SCREEN_RECOVERY_CODE_REVOKED'] } }, select: { before: true, after: true } })
    assert.equal(JSON.stringify(audit).includes(code), false)
    assert.equal(JSON.stringify(audit).includes(rotatedCode), false)
  } finally {
    await prisma.display.deleteMany({ where: { id: { in: [displayIdOne, displayIdTwo, deletedOwnerId] } } })
    if (campaignId) await prisma.campaign.deleteMany({ where: { id: campaignId } })
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, support.id] } } })
    await app.close()
    await prisma.$disconnect()
  }
})
