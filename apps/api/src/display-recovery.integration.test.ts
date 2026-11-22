import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { app } from './server.js'
import { prisma } from './prisma.js'
import { hashSecret, issueTokens } from './http.js'
import { config } from './config.js'
import { encryptDisplayRecoveryCode } from './domain/display-recovery-code.js'

const enabled = process.env.OORO_INTEGRATION_TESTS === 'true' && /127\.0\.0\.1:55432\/ooro_audit/.test(process.env.DATABASE_URL ?? '')

test('Screen Player recovery reuses one screen code, replaces credentials, and blocks cross-screen claims', { skip: !enabled }, async () => {
  const suffix = randomUUID()
  const code = `RECOVERY${suffix.replaceAll('-', '').slice(0, 10).toUpperCase()}`
  const displayIdOne = randomUUID()
  const displayIdTwo = randomUUID()
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
    assert.equal(reveal.statusCode, 200, reveal.body)
    assert.equal(reveal.json().data.pairingCode, code)
    const deniedReveal = await app.inject({ method: 'POST', url: '/api/displays/pairing-code', headers: { authorization: `Bearer ${supportToken}` }, payload: { displayId: one.id } })
    assert.equal(deniedReveal.statusCode, 403)

    const firstPair = await app.inject({ method: 'POST', url: '/api/device/pair', payload: { pairingCode: code.toLowerCase(), deviceId: deviceIdOne, appVersion: 'test' } })
    assert.equal(firstPair.statusCode, 200, firstPair.body)
    const firstToken = firstPair.json().data.deviceToken as string
    assert.equal(firstPair.json().data.screenId, one.id)

    const secondPair = await app.inject({ method: 'POST', url: '/api/device/pair', payload: { pairingCode: code, deviceId: deviceIdOne, appVersion: 'test-reinstalled' } })
    assert.equal(secondPair.statusCode, 200, secondPair.body)
    const secondToken = secondPair.json().data.deviceToken as string
    assert.notEqual(secondToken, firstToken)
    assert.equal(secondPair.json().data.screenId, one.id)
    assert.equal((await prisma.display.findUniqueOrThrow({ where: { id: one.id } })).name, 'Recovery screen one')
    assert.equal(await prisma.displayRecoveryCode.count({ where: { displayId: one.id, revokedAt: null } }), 1)
    assert.equal(await prisma.displayCampaignAssignment.count({ where: { displayId: one.id, campaignId: campaign.id, active: true } }), 1)

    const staleCredential = await app.inject({ method: 'GET', url: '/api/device/manifest', headers: { authorization: `Bearer ${firstToken}` } })
    assert.equal(staleCredential.statusCode, 401)
    const currentCredential = await app.inject({ method: 'GET', url: '/api/device/manifest', headers: { authorization: `Bearer ${secondToken}` } })
    assert.equal(currentCredential.statusCode, 200, currentCredential.body)
    const crossScreen = await app.inject({ method: 'POST', url: '/api/device/pair', payload: { pairingCode: code, deviceId: deviceIdTwo } })
    assert.equal(crossScreen.statusCode, 409)
    assert.equal((await prisma.display.findUniqueOrThrow({ where: { id: two.id } })).deviceTokenHash, null)
    const invalid = await app.inject({ method: 'POST', url: '/api/device/pair', payload: { pairingCode: 'INVALID0', deviceId: `invalid-${suffix}` } })
    assert.equal(invalid.statusCode, 400)

    const rotate = await app.inject({ method: 'POST', url: `/api/displays/${one.id}/recovery-code/rotate`, headers: { authorization: `Bearer ${adminToken}` } })
    assert.equal(rotate.statusCode, 200, rotate.body)
    const rotatedCode = rotate.json().data.pairingCode as string
    assert.notEqual(rotatedCode, code)
    const oldCode = await app.inject({ method: 'POST', url: '/api/device/pair', payload: { pairingCode: code, deviceId: deviceIdOne } })
    assert.equal(oldCode.statusCode, 400)
    const revoke = await app.inject({ method: 'POST', url: `/api/displays/${one.id}/recovery-code/revoke`, headers: { authorization: `Bearer ${adminToken}` } })
    assert.equal(revoke.statusCode, 200, revoke.body)
    const revokedCode = await app.inject({ method: 'POST', url: '/api/device/pair', payload: { pairingCode: rotatedCode, deviceId: deviceIdOne } })
    assert.equal(revokedCode.statusCode, 400)
    const audit = await prisma.auditLog.findMany({ where: { entityId: one.id, action: { in: ['SCREEN_RECOVERY_CODE_REVEALED', 'SCREEN_RECOVERY_CODE_ROTATED', 'SCREEN_RECOVERY_CODE_REVOKED'] } }, select: { before: true, after: true } })
    assert.equal(JSON.stringify(audit).includes(code), false)
    assert.equal(JSON.stringify(audit).includes(rotatedCode), false)
  } finally {
    await prisma.display.deleteMany({ where: { id: { in: [displayIdOne, displayIdTwo] } } })
    if (campaignId) await prisma.campaign.deleteMany({ where: { id: campaignId } })
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, support.id] } } })
    await app.close()
    await prisma.$disconnect()
  }
})
