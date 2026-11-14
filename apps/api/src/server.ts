Warning: truncated output (original token count: 57702)
Total output lines: 1845

/* eslint-disable @typescript-eslint/no-explicit-any */
import Fastify from 'fastify'
import { deliverOtp } from './domain/otp-delivery.js'
import { registerNetworkOperations } from './network-operations.js'
import { registerOperations } from './operations.js'
import { registerAdminManagement } from './admin-management.js'
import { registerAssetRoutes } from './asset-routes.js'
import { Prisma } from '@prisma/client'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import { z } from 'zod'
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { config } from './config.js'
import { prisma } from './prisma.js'
import { ApiError, forbidden, notFound, unauthorized } from './errors.js'
import { authenticateDeviceOs, authenticateDisplay, hashSecret, issueTokens, randomSecret, requireAuth, requirePermission, requireRoles, response } from './http.js'
import { assertRideTransition, stateForEvent } from './domain/ride-state.js'
import { verifyRide } from './domain/verification.js'
import { calculateEarnings } from './domain/earnings.js'
import { buildDisplayManifest } from './domain/campaign-eligibility.js'
import { campaignPackages } from './domain/campaign-packages.js'
import { guestOrderInput, normalizePhone, createRazorpayOrder, verifyCheckoutSignature, verifyWebhookSignature, markOrderPaid, packageFor, createGuestOrder, attachRazorpayOrder, findGuestOrder, findGuestOrderByRazorpayOrder, listGuestOrders, markOrderFailed, updateGuestOrder, isMongoError } from './domain/guest-orders.js'
import { RazorpayWebhookEventModel } from './models/razorpay-webhook-event.js'
import { connectMongo } from './lib/mongodb.js'
import { sendOrderConfirmation } from './domain/transactional-email.js'
import { receiptPdf } from './domain/receipt.js'
import { boundedLocationLimit, shouldRecordDisplayLocation, validDisplayLocation } from './domain/display-location.js'
import { getDisplayConnectivity } from './domain/display-health.js'
import { assertCommandCanBeAcknowledged, commandBelongsToDevice, commandExpiresAt, commandStatusFromDeviceAck, DISPLAY_COMMAND_DELIVERY_LEASE_MS, isCommandExpired, safeCommandError, sameIdempotentCommand } from './domain/display-command.js'
import { canonicalProofId, canonicalProofStatus, proofIdentityBelongsToDisplay } from './domain/proof-policy.js'
import { adminRoles, deviceOsDeploymentRoles, deviceOsReleaseRoles, deviceOsWriteRoles } from './domain/admin-auth.js'
import { asDeviceOsJson } from './domain/deviceos-http.js'
import { assertApprovedScreenPlayerRelease, assertHttpsDownloadUrl, assertSigningCertificateContinuity, decodeApkBase64, inspectApk } from './domain/apk-release.js'
import { deviceOsStorage, parseDeviceOsRange, sliceDeviceOsContent, verifyLocalDownloadSignature } from './domain/deviceos-storage.js'
import { campaignHealthGate, createDeviceOsCampaign, deploymentTargetingModes, isWithinMaintenanceWindow, pauseDeviceOsCampaign, resumeDeviceOsCampaign } from './domain/deviceos-deployment.js'
import { isHealthyInstallationReportValid, isManagedDeviceReleaseCompatible, retryDelayMs, validateDeviceOsEventTransition } from './domain/deviceos.js'
import { assertAdminUser, clearAdminLoginRateLimit, consumePasswordToken, enforceAdminLoginRateLimit, findAdminByEmail, issuePasswordReset, markAdminLoginFailure, normalizeAdminEmail, resetAdminLoginFailures, validateAdminPassword, verifyPassword } from './domain/admin-password-auth.js'
import { MOBILITY_EVENT_TYPES, MOBILITY_PROVIDERS, classifyEvidence, isApprovedNotificationSource } from './domain/mobility-contract.js'
import { getDriverActivationEligibility } from './domain/driver-activation.js'
import { transitionDriverOnboarding } from './domain/driver-onboarding.js'
import { privateDocumentStorage } from './domain/document-storage.js'
import { documentScanner } from './domain/document-scanner.js'
import { driverEmailOtpHash, normalizeDriverEmail, verifyGoogleIdToken } from './domain/driver-auth.js'
import { sendDriverEmailOtp } from './domain/transactional-email.js'
import { normalizeIndianPhone } from './domain/phone.js'
import { creativeTypeMatchesWidget, layoutDraftSchema, standardV3Draft, validateLayoutDraft, type LayoutDraft } from './domain/layout-studio.js'

const app = Fastify({ logger: true })
const deviceOsUploadBodyLimit = Math.ceil(config.deviceOsMaxApkBytes * 4 / 3) + 1024 * 1024
app.register(cors, { origin: config.corsOrigins })
app.register(helmet)
app.addHook('onRequest', async (request) => {
  request.log.info({ requestPath: request.raw.url?.split('?')[0] ?? request.url.split('?')[0] }, 'requestPath')
})
app.removeContentTypeParser('application/json')
app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => { try { (request as any).rawBody = body; done(null, JSON.parse(body as string)) } catch (error) { done(error as Error, undefined) } })
const retiredPaymentRoutes = new Set(['/api/public/campaign-orders', '/api/public/campaign-orders/verify', '/api/webhooks/razorpay'])
app.addHook('preHandler', async (request, reply) => {
  const path = request.url.split('?')[0]
  if (request.method === 'POST' && retiredPaymentRoutes.has(path)) return reply.code(410).send({ data: null, error: { code: 'PAYMENT_PROCESSING_RETIRED', message: 'Online payment processing is no longer available.' }, requestId: request.id })
})
const deviceReadPaths = new Set(['/api/admin/drivers', '/api/admin/vehicles', '/api/admin/displays', '/api/admin/displays/live-map'])
app.addHook('preHandler', async (request) => {
  const path = request.url.split('?')[0]
  if (request.method === 'GET' && (deviceReadPaths.has(path) || /^\/api\/admin\/displays\/[^/]+\/(live-state|location-history|manifest-debug)$/.test(path))) await requirePermission(request, 'device:read')
})
app.addHook('preHandler', async (request) => {
  if (request.method === 'GET' && request.url.split('?')[0] === '/api/admin/proof-of-play') await requirePermission(request, 'campaign:read')
})
app.addHook('preHandler', async (request) => {
  const path = request.url.split('?')[0]
  if (request.method === 'GET' && (path === '/api/admin/orders' || /^\/api\/admin\/orders\/[^/]+$/.test(path))) await requirePermission(request, 'finance:read')
})
app.addHook('preHandler', async (request) => {
  const path = request.url.split('?')[0]
  if (request.method !== 'GET') return
  if (path === '/api/admin/rides') await requirePermission(request, 'ride:read')
  else if (path === '/api/admin/verifications') await requirePermission(request, 'verification:read')
  else if (path === '/api/admin/fraud') await requirePermission(request, 'fraud:read')
})
app.addHook('preHandler', async (request) => { if (request.url.split('?')[0].startsWith('/api/admin/')) await requireRoles(request, adminRoles); if (request.url.split('?')[0] === '/api/webhooks/razorpay') await connectMongo() })

const ok = (request: any, data: unknown, reply: any) => reply.send(response(request, data))
const sendDeviceOsApk = (request: any, reply: any, content: Buffer, filename?: string) => {
  const range = parseDeviceOsRange(typeof request.headers.range === 'string' ? request.headers.range : undefined, content.length)
  const common = reply.header('content-type', 'application/vnd.android.package-archive').header('accept-ranges', 'bytes').header('content-disposition', filename ? `attachment; filename="${filename.replace(/"/g, '')}"` : 'attachment')
  if (range === null) return common.header('content-length', content.length).send(content)
  if (range === 'INVALID') return reply.code(416).header('content-range', `bytes */${content.length}`).send()
  const { start, end } = range
  return common.code(206).header('content-length', end - start + 1).header('content-range', `bytes ${start}-${end}/${content.length}`).send(sliceDeviceOsContent(content, { start, end }))
}
const bodyOf = <T>(request: any, schema: z.ZodType<T>) => {
  const parsed = schema.safeParse(request.body)
  if (!parsed.success) throw new ApiError('VALIDATION_ERROR', parsed.error.issues.map((issue) => issue.message).join('; '), 422)
  return parsed.data
}
const validateLayoutBindings = async (draft: LayoutDraft, db: typeof prisma | Prisma.TransactionClient = prisma) => {
  const issues: Array<{ code: string; message: string; zoneId?: string }> = []
  for (const zone of draft.zones) {
    const binding = zone.contentBinding
    if (binding.kind === 'NONE') continue
    if (!binding.referenceId) { issues.push({ code: 'BINDING_REFERENCE_REQUIRED', zoneId: zone.id, message: `${zone.label} needs a valid existing content reference.` }); continue }
    if ((binding.kind === 'APPROVED_SPONSOR' && zone.type !== 'SPONSORED_AD') || (zone.type === 'SPONSORED_AD' && binding.kind !== 'APPROVED_SPONSOR') || (binding.kind === 'AUTHORIZED_DESTINATION' && !['QR_OFFER', 'STATIC_QR', 'EXTERNAL_DESTINATION'].includes(zone.type))) {
      issues.push({ code: 'CONTENT_SLOT_MISMATCH', zoneId: zone.id, message: `${zone.label} must use a content binding that matches its independent delivery slot.` }); continue
    }
    if (!z.string().uuid().safeParse(binding.referenceId).success) { issues.push({ code: 'INVALID_CONTENT_REFERENCE', zoneId: zone.id, message: `${zone.label} must reference an existing OORO record ID.` }); continue }
    if (binding.kind === 'AUTHORIZED_DESTINATION') {
      const link = await db.campaignTrackingLink.findUnique({ where: { id: binding.referenceId }, select: { active: true, expiresAt: true } })
      if (!link?.active || (link.expiresAt && link.expiresAt <= new Date())) issues.push({ code: 'DESTINATION_NOT_AUTHORIZED', zoneId: zone.id, message: `${zone.label} must reference an active, unexpired authorized destination.` })
      continue
    }
    const creative = await db.creative.findUnique({ where: { id: binding.referenceId }, select: { status: true, type: true, campaign: { select: { deliverySlot: true } }, asset: { select: { active: true, url: true } } } })
    const approvedAndAvailable = creative?.status === 'APPROVED' && creative.asset?.active && Boolean(creative.asset.url)
    const sponsorSlot = creative?.campaign.deliverySlot === 'SPONSORED'
    const creativeType = creative?.type ?? ''
    const slotMatches = binding.kind === 'APPROVED_SPONSOR' ? sponsorSlot : !sponsorSlot
    const widgetTypeMatches = creativeTypeMatchesWidget(zone.type, creativeType)
    if (!approvedAndAvailable || !slotMatches || !widgetTypeMatches) issues.push({ code: 'CONTENT_REFERENCE_INELIGIBLE', zoneId: zone.id, message: `${zone.label} must reference an approved, available creative from the matching delivery slot and media type.` })
  }
  return issues
}
// Capability certification gates validation/publication, not saving work in
// progress. Draft authors must be able to persist an unsupported profile while
// the compatibility review is pending; all structural and binding checks stay
// enforced on every save.
const layoutDraftSaveIssues = (draft: LayoutDraft) =>
  validateLayoutDraft(draft).issues.filter((issue) => issue.code !== 'CAPABILITY_PROFILE_UNVERIFIED')
const asJson = (value: unknown): any => JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item))
const driverFrom = async (auth: { driverId?: string }) => {
  if (!auth.driverId) throw forbidden('Driver account required')
  const driver = await prisma.driver.findUnique({ where: { id: auth.driverId }, include: { user: true } })
  if (!driver) throw notFound('Driver not found')
  if (driver.user.accountStatus === 'SUSPENDED' || driver.user.accountStatus === 'CLOSED') throw forbidden('Driver account is restricted')
  return driver
}
const hashOtp = (phone: string, code: string) => createHash('sha256').update(`${phone}:${code}`).digest('hex')
const driverAuthResponse = (user: { id: string; phone: string | null; email: string | null; name: string | null }, driver: { id: string; onboardingStatus: string }, tokens: { accessToken: string; refreshToken: string }) => ({ ...tokens, user: { id: user.id, phone: user.phone, email: user.email, name: user.name, role: 'DRIVER' }, driver: { id: driver.id, onboardingStatus: driver.onboardingStatus } })
const generatePairingCode = () => { const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; const bytes = randomBytes(6); return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('') }
const authStoreError = (error: unknown) => {
  if (error instanceof ApiError) return error
  if (error instanceof Prisma.PrismaClientInitializationError) return new ApiError('AUTH_STORE_UNAVAILABLE', 'Authentication is temporarily unavailable', 503)
  if (error instanceof Prisma.PrismaClientKnownRequestError && ['P1001', 'P2022'].includes(error.code)) return new ApiError('AUTH_STORE_UNAVAILABLE', 'Authentication is temporarily unavailable', 503)
  return error
}
const deviceRequestId = z.string().uuid()
const consumeDeviceRequest = async (tx: Prisma.TransactionClient, managedDeviceId: string, requestId: string, endpoint: string) => {
  try {
    await tx.deviceRequestReceipt.create({ data: { managedDeviceId, requestId, endpoint } })
    await tx.deviceRequestReceipt.deleteMany({ where: { managedDeviceId, receivedAt: { lt: new Date(Date.now() - Math.max(1, config.deviceOsRequestReceiptRetentionDays) * 24 * 60 * 60 * 1000) } } })
    return true
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false
    throw error
  }
}

app.get('/health', async (request, reply) => ok(request, { status: 'ok', service: 'ooro-api' }, reply))
app.get('/api/health', async (request, reply) => ok(request, { status: 'ok', service: 'ooro-api' }, reply))
app.get('/api/health/db', async (request, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    return ok(request, { status: 'ok', service: 'ooro-api', database: 'ok' }, reply)
  } catch {
    return reply.code(503).send({ data: null, error: { code: 'DATABASE_UNAVAILABLE', message: 'Database dependency unavailable' } })
  }
})

// Layout Studio V1 persists presentation contracts independently of campaign
// eligibility. Screen delivery/assignment remains opt-in and disabled by default.
app.get('/api/admin/layout-studio', async (request, reply) => {
  await requirePermission(request, 'device:read')
  const layouts = await prisma.layoutTemplate.findMany({ orderBy: { updatedAt: 'desc' }, include: { revisions: { orderBy: { revision: 'desc' }, take: 1, select: { id: true, revision: true, contractHash: true, publishedAt: true } } } })
  return ok(request, { templates: [{ key: 'OORO_STANDARD_V3', name: 'OORO Standard V3', mode: 'STANDARD', locked: true, contract: standardV3Draft() }], layouts: asJson(layouts), liveAssignmentEnabled: false }, reply)
})
app.get('/api/admin/layout-studio/content', async (request, reply) => {
  await requirePermission(request, 'campaign:read')
  const [creatives, destinations] = await Promise.all([
    prisma.creative.findMany({ where: { status: 'APPROVED', asset: { is: { active: true, url: { not: '' } } } }, orderBy: [{ campaign: { name: 'asc' } }, { displayOrder: 'asc' }], take: 500, select: { id: true, name: true, type: true, campaign: { select: { id: true, name: true, deliverySlot: true } } } }),
    prisma.campaignTrackingLink.findMany({ where: { active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, ctaType: true, campaign: { select: { name: true } } } }),
  ])
  return ok(request, { creatives: asJson(creatives), destinations: asJson(destinations), note: 'Approval and active assets are required for selection. Layout binding does not itself authorize scheduled delivery.' }, reply)
})
app.post('/api/admin/layout-studio', async (request, reply) => {
  const auth = await requirePermission(request, 'device:write')
  const input = bodyOf(request, z.object({ name: z.string().trim().min(1).max(100), contract: layoutDraftSchema }).strict())
  const issues = [...layoutDraftSaveIssues(input.contract), ...await validateLayoutBindings(input.contract)]
  if (issues.length) throw new ApiError('LAYOUT_VALIDATION_FAILED', issues.map(issue => issue.message).join(' '), 422)
  const created = await prisma.$transaction(async tx => {
    const layout = await tx.layoutTemplate.create({ data: { name: input.name, mode: input.contract.mode, preset: input.contract.preset, profileId: input.contract.profileId, draftContract: input.contract as any, createdBy: auth.userId, updatedBy: auth.userId } })
    await tx.auditLog.create({ data: { actorId: auth.userId, actorRole: auth.role, action: 'LAYOUT_DRAFT_CREATED', entityType: 'LayoutTemplate', entityId: layout.id, after: { mode: layout.mode, preset: layout.preset } as any, requestId: request.id } })
    return layout
  })
  return reply.code(201).send(response(request, asJson(created)))
})
app.get('/api/admin/layout-studio/:layoutId', async (request, reply) => {
  await requirePermission(request, 'device:read')
  const { layoutId } = request.params as { layoutId: string }
  if (!z.string().uuid().safeParse(layoutId).success) throw new ApiError('VALIDATION_ERROR', 'Invalid layout ID', 422)
  const layout = await prisma.layoutTemplate.findUnique({ where: { id: layoutId }, include: { revisions: { orderBy: { revision: 'desc' } } } })
  if (!layout) throw notFound('Layout not found')
  return ok(request, asJson(layout), reply)
})
app.put('/api/admin/layout-studio/:layoutId/draft', async (request, reply) => {
  const auth = await requirePermission(request, 'device:write')
  const { layoutId } = request.params as { layoutId: string }
  if (!z.string().uuid().safeParse(layoutId).success) throw new ApiError('VALIDATION_ERROR', 'Invalid layout ID', 422)
  const input = bodyOf(request, z.object({ expectedRowVersion: z.number().int().positive(), name: z.string().trim().min(1).max(100), contract: layoutDraftSchema }).strict())
  const issues = [...layoutDraftSaveIssues(input.contract), ...await validateLayoutBindings(input.contract)]
  if (issues.length) throw new ApiError('LAYOUT_VALIDATION_FAILED', issues.map(issue => issue.message).join(' '), 422)
  const layout = await prisma.$transaction(async tx => {
    const changed = await tx.layoutTemplate.updateMany({ where: { id: layoutId, rowVersion: input.expectedRowVersion, state: { not: 'ARCHIVED' } }, data: { name: input.name, mode: input.contract.mode, preset: input.contract.preset, profileId: input.contract.profileId, draftContract: input.contract as any, state: 'DRAFT', rowVersion: { increment: 1 }, updatedBy: auth.userId } })
    if (!changed.count) throw new ApiError('LAYOUT_REVISION_CONFLICT', 'This draft changed elsewhere. Reload it before saving.', 409)
    const updated = await tx.layoutTemplate.findUniqueOrThrow({ where: { id: layoutId } })
    await tx.auditLog.create({ data: { actorId: auth.userId, actorRole: auth.role, action: 'LAYOUT_DRAFT_UPDATED', entityType: 'LayoutTemplate', entityId: layoutId, after: { rowVersion: updated.rowVersion } as any, requestId: request.id } })
    return updated
  })
  return ok(request, asJson(layout), reply)
})
app.post('/api/admin/layout-studio/:layoutId/validate', async (request, reply) => {
  const auth = await requirePermission(request, 'device:write')
  const { layoutId } = request.params as { layoutId: string }
  if (!z.string().uuid().safeParse(layoutId).success) throw new ApiError('VALIDATION_ERROR', 'Invalid layout ID', 422)
  const input = bodyOf(request, z.object({ expectedRowVersion: z.number().int().positive() }).strict())
  const layout = await prisma.layoutTemplate.findUnique({ where: { id: layoutId }, select: { draftContract: true, rowVersion: true, state: true } })
  if (!layout) throw notFound('Layout not found')
  if (layout.state === 'PUBLISHED' || layout.state === 'ARCHIVED') throw new ApiError('LAYOUT_REVISION_CONFLICT', 'Published layouts are immutable. Save a new draft revision before validating again.', 409)
  const result = validateLayoutDraft(layout.draftContract)
  const issues = [...result.issues, ...await validateLayoutBindings(layout.draftContract as LayoutDraft)]
  if (layout.rowVersion !== input.expectedRowVersion) throw new ApiError('LAYOUT_REVISION_CONFLICT', 'This draft changed during validation. Reload it before continuing.', 409)
  if (issues.length) return ok(request, { valid: false, issues, rowVersion: layout.rowVersion, warnings: ['Publishing a layout does not approve or authorize advertising media. Live screen assignment is disabled by default.'] }, reply)
  if (layout.state === 'VALIDATED') return ok(request, { valid: true, issues: [], rowVersion: layout.rowVersion, state: layout.state, warnings: ['Publishing a layout does not approve or authorize advertising media. Live screen assignment is disabled by default.'] }, reply)
  const validated = await prisma.$transaction(async tx => {
    const updated = await tx.layoutTemplate.updateMany({ where: { id: layoutId, rowVersion: input.expectedRowVersion, state: { not: 'ARCHIVED' } }, data: { state: 'VALIDATED', rowVersion: { increment: 1 } } })
    if (!updated.count) throw new ApiError('LAYOUT_REVISION_CONFLICT', 'This draft changed during validation. Reload it before continuing.', 409)
    await tx.auditLog.create({ data: { actorId: auth.userId, actorRole: auth.role, action: 'LAYOUT_DRAFT_VALIDATED', entityType: 'LayoutTemplate', entityId: layoutId, after: { rowVersion: input.expectedRowVersion + 1 } as any, requestId: request.id } })
    return tx.layoutTemplate.findUniqueOrThrow({ where: { id: layoutId }, select: { rowVersion: true, state: true } })
  })
  return ok(request, { valid: true, issues: [], rowVersion: validated.rowVersion, state: validated.state, warnings: ['Publishing a layout does not approve or authorize advertising media. Live screen assignment is disabled by default.'] }, reply)
})
app.post('/api/admin/layout-studio/:layoutId/publish', async (request, reply) => {
  const auth = await requireRoles(request, ['SUPER_ADMIN'])
  const { layoutId } = request.params as { layoutId: string }
  if (!z.string().uuid().safeParse(layoutId).success) throw new ApiError('VALIDATION_ERROR', 'Invalid layout ID', 422)
  const input = bodyOf(request, z.object({ expectedRowVersion: z.number().int().positive() }).strict())
  const published = await prisma.$transaction(async tx => {
    const layout = await tx.layoutTemplate.findUnique({ where: { id: layoutId } })
    if (!layout) throw notFound('Layout not found')
    if (layout.rowVersion !== input.expectedRowVersion || layout.state !== 'VALIDATED') throw new ApiError('LAYOUT_REVISION_CONFLICT', 'Validate the current draft before Super Admin approval and publication.', 409)
    const result = validateLayoutDraft(layout.draftContract)
    const issues = [...result.issues, ...await validateLayoutBindings(layout.draftContract as LayoutDraft, tx)]
    if (issues.length) throw new ApiError('LAYOUT_VALIDATION_FAILED', issues.map(issue => issue.message).join(' '), 422)
    const contract = JSON.stringify(layout.draftContract)
    const contractHash = createHash('sha256').update(contract).digest('hex')
    const revision = await tx.layoutRevision.create({ data: { templateId: layoutId, revision: (await tx.layoutRevision.count({ where: { templateId: layoutId } })) + 1, contract: layout.draftContract as any, contractHash, validation: { valid: true, issues: [] }, publishedBy: auth.userId } })
    await tx.layoutTemplate.update({ where: { id: layoutId }, data: { state: 'PUBLISHED', rowVersion: { increment: 1 }, updatedBy: auth.userId } })
    await tx.auditLog.create({ data: { actorId: auth.userId, actorRole: auth.role, action: 'LAYOUT_REVISION_PUBLISHED', entityType: 'LayoutRevision', entityId: revision.id, after: { templateId: layoutId, revision: revision.revision, contractHash } as any, requestId: request.id } })
    return revision
  }, { isolationLevel: 'Serializable' })
  return reply.code(201).send(response(request, asJson(published)))
})
app.post('/api/admin/layout-studio/:layoutId/assign', async (request) => {
  await requireRoles(request, ['SUPER_ADMIN'])
  throw new ApiError('LAYOUT_ASSIGNMENT_DISABLED', 'Live layout assignments are disabled pending native renderer, compatibility validation and rollout approval.', 409)
})
app.post('/api/admin/layout-studio/:layoutId/rollback', async (request, reply) => {
  const auth = await requireRoles(request, ['SUPER_ADMIN'])
  const { layoutId } = request.params as { layoutId: string }
  if (!z.string().uuid().safeParse(layoutId).success) throw new ApiError('VALIDATION_ERROR', 'Invalid layout ID', 422)
  const input = bodyOf(request, z.object({ expectedRowVersion: z.number().int().positive(), revisionId: z.string().uuid() }).strict())
  const restored = await prisma.$transaction(async tx => {
    const [layout, revision, activeAssignments] = await Promise.all([
      tx.layoutTemplate.findUnique({ where: { id: layoutId } }),
      tx.layoutRevision.findFirst({ where: { id: input.revisionId, templateId: layoutId } }),
      tx.layoutAssignment.count({ where: { templateId: layoutId, state: 'ACTIVE', revokedAt: null } }),
    ])
    if (!layout || !revision) throw notFound('Layout or published revision not found')
    if (activeAssignments) throw new ApiError('LAYOUT_ROLLBACK_BLOCKED', 'Revoke or replace active assignments through the approved rollout workflow before restoring a draft.', 409)
    const contract = layoutDraftSchema.parse(revision.contract)
    const changed = await tx.layoutTemplate.updateMany({ where: { id: layoutId, rowVersion: input.expectedRowVersion, state: { not: 'ARCHIVED' } }, data: { mode: contract.mode, preset: contract.preset, profileId: contract.profileId, draftContract: contract as any, state: 'DRAFT', rowVersion: { increment: 1 }, updatedBy: auth.userId } })
    if (!changed.count) throw new ApiError('LAYOUT_REVISION_CONFLICT', 'This layout changed elsewhere. Reload it before rollback.', 409)
    await tx.auditLog.create({ data: { actorId: auth.userId, actorRole: auth.role, action: 'LAYOUT_DRAFT_RESTORED', entityType: 'LayoutTemplate', entityId: layoutId, before: { state: layout.state, rowVersion: layout.rowVersion } as any, after: { state: 'DRAFT', restoredFromRevisionId: revision.id, revision: revision.revision } as any, requestId: request.id } })
    return tx.layoutTemplate.findUniqueOrThrow({ where: { id: layoutId } })
  }, { isolationLevel: 'Serializable' })
  return ok(request, asJson(restored), reply)
})
app.post('/api/admin/layout-studio/:layoutId/archive', async (request, reply) => {
  const auth = await requireRoles(request, ['SUPER_ADMIN'])
  const { layoutId } = request.params as { layoutId: string }
  if (!z.string().uuid().safeParse(layoutId).success) throw new ApiError('VALIDATION_ERROR', 'Invalid layout ID', 422)
  const input = bodyOf(request, z.object({ expectedRowVersion: z.number().int().positive() }).strict())
  const archived = await prisma.$transaction(async tx => {
    const layout = await tx.layoutTemplate.findUnique({ where: { id: layoutId } })
    if (!layout) throw notFound('Layout not found')
    const activeAssignments = await tx.layoutAssignment.count({ where: { templateId: layoutId, state: 'ACTIVE', revokedAt: null } })
    if (activeAssignments) throw new ApiError('LAYOUT_ARCHIVE_BLOCKED', 'Active assignments must be revoked before archiving this layout.', 409)
    const changed = await tx.layoutTemplate.updateMany({ where: { id: layoutId, rowVersion: input.expectedRowVersion, state: { not: 'ARCHIVED' } }, data: { state: 'ARCHIVED', rowVersion: { increment: 1 }, updatedBy: auth.userId } })
    if (!changed.count) throw new ApiError('LAYOUT_REVISION_CONFLICT', 'This layout changed elsewhere. Reload it before archiving.', 409)
    await tx.auditLog.create({ data: { actorId: auth.userId, actorRole: auth.role, action: 'LAYOUT_ARCHIVED', entityType: 'LayoutTemplate', entityId: layoutId, before: { state: layout.state }, after: { state: 'ARCHIVED' }, requestId: request.id } })
    return tx.layoutTemplate.findUniqueOrThrow({ where: { id: layoutId } })
  })
  return ok(request, asJson(archived), reply)
})
app.get('/go/:token', async (request, reply) => {
  const token = String((request.params as { token?: string }).token ?? '')
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw notFound('Tracking link not found')
  const link = await prisma.campaignTrackingLink.findUnique({ where: { token } })
  if (!link || !link.active || (link.expiresAt && link.expiresAt <= new Date())) throw notFound('Tracking link not found')
  let destination: URL
  try { destination = new URL(link.destinationUrl) } catch { throw notFound('Tracking link not found') }
  if (destination.protocol !== 'https:' && !(config.nodeEnv === 'development' && ['localhost', '127.0.0.1'].includes(destination.hostname))) throw notFound('Tracking link not found')
  await prisma.qrScan.create({ data: { eventId: randomUUID(), trackingLinkId: link.id, campaignId: link.campaignId, creativeId: link.creativeId, displayId: link.displayId } })
  return reply.code(302).header('Location', destination.toString()).send()
})
app.get('/api/admin/campaigns/:campaignId/qr-analytics', async (request, reply) => {
  await requireRoles(request, adminRoles)
  const { campaignId } = request.params as { campaignId: string }
  const [completedPlays, qrScans] = await Promise.all([
    prisma.proofOfPlay.count({ where: { campaignId, playbackCompleted: true } }),
    prisma.qrScan.count({ where: { campaignId } }),
  ])
  return ok(request, { completedPlays, qrScans, scanRate: completedPlays === 0 ? null : (qrScans / completedPlays) * 100 }, reply)
})
app.get('/api/public/campaign-packages', async (request, reply) => ok(request, campaignPackages.filter((item) => item.active), reply))
app.post('/api/public/campaign-orders', async (request, reply) => { const input = bodyOf(request, guestOrderInput); const selected = packageFor(input.packageId); if (!selected) throw new ApiError('INVALID_PACKAGE', 'This campaign package is unavailable', 422); const phone = normalizePhone(input.phone); const orderNumber = `OORO-${Date.now().toString(36).toUpperCase()}-${randomSecret(3).toUpperCase()}`; request.log.info({ route: request.url, orderNumber, stage: 'MONGO_INSERT' }, 'creating guest campaign order'); let order; try { order = await createGuestOrder({ orderNumber, name: input.name, email: input.email.toLowerCase(), phone, businessName: input.businessName, gstin: input.gstin, campaignNotes: input.campaignNotes, websiteOrInstagram: input.websiteOrInstagram, packageId: selected.id, city: selected.city, autos: selected.autos, hoursPerDay: selected.hoursPerDay, campaignDurationDays: selected.durationDays, amount: selected.amount, currency: selected.currency }); } catch (error) { request.log.error({ route: request.url, orderNumber, stage: 'MONGO_INSERT', errorType: error instanceof Error ? error.name : 'unknown' }, 'guest order persistence failed'); if (isMongoError(error)) throw new ApiError('GUEST_STORE_UNAVAILABLE', 'Guest checkout storage is temporarily unavailable', 503); throw error } try { request.log.info({ route: request.url, orderNumber, stage: 'RAZORPAY_ORDER_CREATE' }, 'creating Razorpay order'); const razorpay = await createRazorpayOrder(orderNumber, selected.amount, { ooroOrder: order.id.toString(), packageId: selected.id }); await attachRazorpayOrder(orderNumber, razorpay.id); return ok(request, { orderNumber, razorpayOrderId: razorpay.id, keyId: config.razorpayKeyId, amount: razorpay.amount, currency: razorpay.currency, name: input.name, email: input.email.toLowerCase(), phone }, reply) } catch (error) { request.log.warn({ route: request.url, orderNumber, stage: 'RAZORPAY_ORDER_CREATE', errorType: error instanceof Error ? error.name : 'unknown' }, 'Razorpay order creation failed'); await updateGuestOrder(order.id.toString(), { status: error instanceof ApiError && error.code === 'PAYMENT_PROVIDER_NOT_CONFIGURED' ? 'CREATED' : 'PAYMENT_FAILED', emailLastError: error instanceof Error ? error.message : 'Razorpay order failed' }); throw error } })
app.post('/api/public/campaign-orders/verify', async (request, reply) => { const input = bodyOf(request, z.object({ orderNumber: z.string(), razorpayOrderId: z.string(), razorpayPaymentId: z.string(), razorpaySignature: z.string() })); if (!verifyCheckoutSignature(input.razorpayOrderId, input.razorpayPaymentId, input.razorpaySignature)) throw new ApiError('INVALID_PAYMENT_SIGNATURE', 'Payment could not be verified', 400); const order = await findGuestOrderByRazorpayOrder(input.razorpayOrderId); if (!order || order.orderNumber !== input.orderNumber) throw notFound('Order not found'); const paid = await markOrderPaid(input.razorpayOrderId, input.razorpayPaymentId); if (paid?.order && paid.order.emailDeliveryStatus === 'PENDING') { try { const delivery = await sendOrderConfirmation(paid.order); await updateGuestOrder(paid.order._id.toString(), { emailDeliveryStatus: delivery }) } catch (error) { await updateGuestOrder(paid.order._id.toString(), { emailDeliveryStatus: 'FAILED', emailLastError: error instanceof Error ? error.message : 'Email failed' }) } } return ok(request, { orderNumber: paid?.order.orderNumber, status: paid?.order.status, accessToken: paid?.accessToken }, reply) })
app.get('/api/public/campaign-orders/:orderNumber', async (request, reply) => { const { orderNumber } = request.params as { orderNumber: string }; const accessToken = String((request.query as { accessToken?: string }).accessToken ?? request.headers['x-order-access-token'] ?? ''); const order = await findGuestOrder(orderNumber); if (!order || !accessToken || hashSecret(accessToken) !== order.receiptAccessTokenHash) throw unauthorized('Secure order access required'); return ok(request, { orderNumber: order.orderNumber, name: order.name, email: order.email, businessName: order.businessName, packageId: order.packageId, city: order.city, autos: order.autos, hoursPerDay: order.hoursPerDay, campaignDurationDays: order.campaignDurationDays, amount: order.amount, currency: order.currency, status: order.status, paymentCapturedAt: order.paymentCapturedAt, receiptNumber: order.receiptNumber, emailDeliveryStatus: order.emailDeliveryStatus }, reply) })
app.get('/api/public/campaign-orders/:orderNumber/receipt', async (request, reply) => { const { orderNumber } = request.params as { orderNumber: string }; const accessToken = String((request.query as { accessToken?: string }).accessToken ?? request.headers['x-order-access-token'] ?? ''); const order = await findGuestOrder(orderNumber); if (!order || !accessToken || hashSecret(accessToken) !== order.receiptAccessTokenHash) throw unauthorized('Secure receipt access required'); if (order.status !== 'PAID' && order.status !== 'FULFILLED') throw new ApiError('RECEIPT_NOT_READY', 'Receipt is not available', 409); return reply.type('application/pdf').header('Content-Disposition', `attachment; filename="${order.receiptNumber ?? order.orderNumber}.pdf"`).send(receiptPdf(order)) })
app.post('/api/webhooks/razorpay', async (request, reply) => { const signature = request.headers['x-razorpay-signature']; if (typeof signature !== 'string' || !verifyWebhookSignature(String((request as any).rawBody ?? ''), signature)) throw new ApiError('INVALID_WEBHOOK_SIGNATURE', 'Webhook signature could not be verified', 400); const payload = request.body as { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string } }; order?: { entity?: { id?: string } } } }; const eventId = String(request.headers['x-razorpay-event-id'] ?? `${payload.event}-${payload.payload?.payment?.entity?.id ?? payload.payload?.order?.entity?.id ?? randomSecret(8)}`); const existing = await RazorpayWebhookEventModel.findOne({ eventId }); if (existing) return ok(request, { received: true, duplicate: true }, reply); const event = await RazorpayWebhookEventModel.create({ eventId, eventType: payload.event ?? 'unknown', status: 'PROCESSED', processedAt: new Date() }); const payment = payload.payload?.payment?.entity; const orderId = payment?.order_id ?? payload.payload?.order?.entity?.id; if ((payload.event === 'payment.captured' || payload.event === 'order.paid') && orderId) { const paid = await markOrderPaid(orderId, payment?.id ?? ''); if (paid?.order && paid.order.emailDeliveryStatus === 'PENDING') { try { await updateGuestOrder(paid.order._id.toString(), { emailDeliveryStatus: await sendOrderConfirmation(paid.order) }) } catch (error) { await updateGuestOrder(paid.order._id.toString(), { emailDeliveryStatus: 'FAILED', emailLastError: error instanceof Error ? error.message : 'Email failed' }) } } } else if (payload.event === 'payment.failed' && orderId) await markOrderFailed(orderId); return ok(request, { received: true, eventId: event.eventId }, reply) })

app.get('/api/driver/auth/config', async (request, reply) => {
  return ok(request, { emailEnabled: config.driverAuthEmailEnabled, googleEnabled: config.driverAuthGoogleEnabled, phoneEnabled: config.driverAuthPhoneEnabled, googleWebClientId: config.driverAuthGoogleEnabled ? config.googleWebClientId : undefined }, reply)
})

const genericDriverEmailResponse = { message: 'If this email can be used for OORO Driver, a verification code will be sent.' }
app.post('/api/driver/auth/email/request-otp', async (request, reply) => {
  if (!config.driverAuthEmailEnabled) throw notFound('Email authentication is unavailable')
  const email = normalizeDriverEmail(bodyOf(request, z.object({ email: z.string().email().max(254) })).email)
  const now = new Date()
  const existing = await prisma.user.findUnique({ where: { email }, include: { driver: true, authIdentities: { where: { provider: 'email' }, select: { driverId: true } } } })
  const driverId = existing?.authIdentities[0]?.driverId
  const [latest, emailCount, ipCount, accountCount] = await Promise.all([
    prisma.driverEmailOtpChallenge.findFirst({ where: { email, consumedAt: null }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.driverEmailOtpChallenge.count({ where: { email, createdAt: { gte: new Date(now.getTime() - 60 * 60_000) } } }),
    prisma.driverEmailOtpChallenge.count({ where: { requestedIp: request.ip, createdAt: { gte: new Date(now.getTime() - 60 * 60_000) } } }),
    driverId ? prisma.driverEmailOtpChallenge.count({ where: { driverId, createdAt: { gte: new Date(now.getTime() - 60 * 60_000) } } }) : Promise.resolve(0),
  ])
  const eligible = !existing || Boolean(driverId)
  const rateLimited = Boolean(latest && now.getTime() - latest.createdAt.getTime() < 30_000) || emailCount >= 5 || ipCount >= 20 || accountCount >= 5
  if (eligible && !rateLimited) {
    await prisma.driverEmailOtpChallenge.updateMany({ where: { email, consumedAt: null }, data: { consumedAt: now } })
    const code = String(randomInt(100000, 1000000))
    const challenge = await prisma.driverEmailOtpChallenge.create({ data: { email, codeHash: driverEmailOtpHash(email, code), expiresAt: new Date(now.getTime() + 5 * 60_000), requestedIp: request.ip, driverId } })
    try {
      await sendDriverEmailOtp(email, code)
    } catch (error) {
      request.log.error({ err: error, event: 'driver_email_otp_delivery_failed' }, 'driver email OTP delivery failed')
      await prisma.driverEmailOtpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } }).catch(() => undefined)
    }
  }
  return reply.code(202).send(response(request, genericDriverEmailResponse))
})

app.post('/api/driver/auth/email/verify-otp', async (request, reply) => {
  if (!config.driverAuthEmailEnabled) throw notFound('Email authentication is unavailable')
  const input = bodyOf(request, z.object({ email: z.string().email().max(254), code: z.string().regex(/^\d{6}$/) }))
  const email = normalizeDriverEmail(input.email)
  const now = new Date()
  const challenge = await prisma.driverEmailOtpChallenge.findFirst({ where: { email, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: 5 } }, orderBy: { createdAt: 'desc' } })
  if (!challenge) throw unauthorized('Invalid or expired verification code')
  const counted = await prisma.driverEmailOtpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: 5 } }, data: { attempts: { increment: 1 } } })
  if (counted.count !== 1 || driverEmailOtpHash(email, input.code) !== challenge.codeHash) {
    if (challenge.attempts + 1 >= 5) await prisma.driverEmailOtpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: now } })
    throw unauthorized('Invalid or expired verification code')
  }
  const consumed = await prisma.driverEmailOtpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, attempts: { lte: 5 } }, data: { consumedAt: now } })
  if (consumed.count !== 1) throw unauthorized('Invalid or expired verification code')
  let user = await prisma.user.findUnique({ where: { email }, include: { driver: true, authIdentities: { where: { provider: 'email' } } } })
  if (user && !user.authIdentities.length) throw unauthorized('Invalid or expired verification code')
  if (user && !user.driver) throw unauthorized('Invalid or expired verification code')
  if (!user) {
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { phone: null, email, emailVerifiedAt: now, role: 'DRIVER', accountStatus: 'PENDING', driver: { create: {} } }, include: { driver: true, authIdentities: true } })
      if (!created.driver) throw new Error('Driver creation failed')
      await tx.driverAuthIdentity.create({ data: { driverId: created.driver.id, userId: created.id, provider: 'email', subject: email, email, verifiedAt: now } })
      return created
    })
  } else {
    if (user.accountStatus === 'SUSPENDED' || user.accountStatus === 'CLOSED') throw forbidden('Driver account is restricted')
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: user.emailVerifiedAt ?? now } })
  }
  const driver = user.driver!
  const tokens = await issueTokens(user.id, user.role, driver.id, { userAgent: request.headers['user-agent'], ipAddress: request.ip })
  return ok(request, driverAuthResponse(user, driver, tokens), reply)
})

app.post('/api/driver/auth/google', async (request, reply) => {
  if (!config.driverAuthGoogleEnabled) throw notFound('Google authentication is unavailable')
  const { idToken } = bodyOf(request, z.object({ idToken: z.string().min(20).max(16_384) }))
  let verified: { subject: string; email: string }
  try { verified = await verifyGoogleIdToken(idToken) } catch (error) { request.log.warn({ event: 'driver_google_token_rejected', reason: error instanceof Error ? error.message : 'verification_failed' }, 'driver Google token rejected'); throw unauthorized('Google authentication could not be verified') }
  let identity = await prisma.driverAuthIdentity.findUnique({ where: { provider_subject: { provider: 'google', subject: verified.subject } }, include: { user: true, driver: true } })
  if (!identity) {
    const emailOwner = await prisma.user.findUnique({ where: { email: verified.email }, select: { id: true } })
    if (emailOwner) throw new ApiError('GOOGLE_ACCOUNT_LINK_REQUIRED', 'This Google account must be linked from the authenticated driver account', 409)
    try {
      identity = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { phone: null, email: verified.email, emailVerifiedAt: new Date(), role: 'DRIVER', accountStatus: 'PENDING', driver: { create: {} } }, include: { driver: true } })
        if (!user.driver) throw new Error('Driver creation failed')
        return tx.driverAuthIdentity.create({ data: { driverId: user.driver.id, userId: user.id, provider: 'google', subject: verified.subject, email: verified.email, verifiedAt: new Date() }, include: { user: true, driver: true } })
      })
    } catch (error) {
      const raced = await prisma.driverAuthIdentity.findUnique({ where: { provider_subject: { provider: 'google', subject: verified.subject } }, include: { user: true, driver: true } })
      if (!raced) throw error
      identity = raced
    }
  }
  if (identity.user.accountStatus === 'SUSPENDED' || identity.user.accountStatus === 'CLOSED') throw forbidden('Driver account is restricted')
  const tokens = await issueTokens(identity.user.id, identity.user.role, identity.driver.id, { userAgent: request.headers['user-agent'], ipAddress: request.ip })
  return ok(request, driverAuthResponse(identity.user, identity.driver, tokens), reply)
})

app.post('/api/driver/auth/google/link', async (request, reply) => {
  if (!config.driverAuthGoogleEnabled) throw notFound('Google authentication is unavailable')
  const auth = await requireAuth(request); const driver = await driverFrom(auth)
  const { idToken } = bodyOf(request, z.object({ idToken: z.string().min(20).max(16_384) }))
  let verified: { subject: string; email: string }
  try { verified = await verifyGoogleIdToken(idToken) } catch { throw unauthorized('Google account could not be verified') }
  const existing = await prisma.driverAuthIdentity.findUnique({ where: { provider_subject: { provider: 'google', subject: verified.subject } }, select: { driverId: true } })
  if (existing && existing.driverId !== driver.id) throw new ApiError('GOOGLE_ACCOUNT_ALREADY_LINKED', 'This Google account is already linked to another driver', 409)
  const emailOwner = await prisma.user.findUnique({ where: { email: verified.email }, select: { id: true } })
  if (emailOwner && emailOwner.id !== auth.userId) throw new ApiError('GOOGLE_ACCOUNT_LINK_REQUIRED', 'This verified email belongs to another OORO account', 409)
  if (!existing) await prisma.driverAuthIdentity.create({ data: { driverId: driver.id, userId: auth.userId, provider: 'google', subject: verified.subject, email: verified.email, verifiedAt: new Date() } })
  await prisma.user.update({ where: { id: auth.userId }, data: { ...(driver.user.email ? {} : { email: verified.email }), ...(!driver.user.email || normalizeDriverEmail(driver.user.email) === verified.email ? { emailVerifiedAt: new Date() } : {}) } })
  return ok(request, { linked: true, provider: 'google' }, reply)
})

app.post('/api/driver/auth/email/link/request-otp', async (request, reply) => {
  if (!config.driverAuthEmailEnabled) throw notFound('Email authentication is unavailable')
  const auth = await requireAuth(request); const driver = await driverFrom(auth)
  const email = normalizeDriverEmail(bodyOf(request, z.object({ email: z.string().email().max(254) })).email)
  const owner = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (owner && owner.id !== auth.userId) throw new ApiError('EMAIL_ACCOUNT_LINK_REQUIRED', 'This email belongs to another OORO account', 409)
  const now = new Date()
  const latest = await prisma.driverEmailOtpChallenge.findFirst({ where: { email, driverId: driver.id, consumedAt: null }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
  if (latest && now.getTime() - latest.createdAt.getTime() < 30_000) throw new ApiError('OTP_RESEND_COOLDOWN', 'Please wait before requesting another code', 429)
  const code = String(randomInt(100000, 1000000))
  await prisma.driverEmailOtpChallenge.updateMany({ where: { email, driverId: driver.id, consumedAt: null }, data: { consumedAt: now } })
  const challenge = await prisma.driverEmailOtpChallenge.create({ data: { email, codeHash: driverEmailOtpHash(email, code), expiresAt: new Date(now.getTime() + 5 * 60_000), requestedIp: request.ip, driverId: driver.id } })
  try { await sendDriverEmailOtp(email, code) } catch (error) { request.log.error({ err: error, event: 'driver_email_link_delivery_failed' }, 'driver email link delivery failed'); await prisma.driverEmailOtpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } }).catch(() => undefined) }
  return reply.code(202).send(response(request, { message: 'If this email can be linked to your OORO Driver account, a verification code has been sent.' }))
})

app.post('/api/driver/auth/email/link/verify-otp', async (request, reply) => {
  if (!config.driverAuthEmailEnabled) throw notFound('Email authentication is unavailable')
  const auth = await requireAuth(request); const driver = await driverFrom(auth)
  const input = bodyOf(request, z.object({ email: z.string().email().max(254), code: z.string().regex(/^\d{6}$/) })); const email = normalizeDriverEmail(input.email); const now = new Date()
  const challenge = await prisma.driverEmailOtpChallenge.findFirst({ where: { email, driverId: driver.id, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: 5 } }, orderBy: { createdAt: 'desc' } })
  if (!challenge) throw unauthorized('Invalid or expired verification code')
  const counted = await prisma.driverEmailOtpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, attempts: { lt: 5 }, expiresAt: { gt: now } }, data: { attempts: { increment: 1 } } })
  if (counted.count !== 1 || driverEmailOtpHash(email, input.code) !== challenge.codeHash) { if (challenge.attempts + 1 >= 5) await prisma.driverEmailOtpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: now } }); throw unauthorized('Invalid or expired verification code') }
  const consumed = await prisma.driverEmailOtpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, attempts: { lte: 5 } }, data: { consumedAt: now } }); if (consumed.count !== 1) throw unauthorized('Invalid or expired verification code')
  const owner = await prisma.user.findUnique({ where: { email }, select: { id: true } }); if (owner && owner.id !== auth.userId) throw new ApiError('EMAIL_ACCOUNT_LINK_REQUIRED', 'This email belongs to another OORO account', 409)
  await prisma.$transaction(async (tx) => { await tx.user.update({ where: { id: auth.userId }, data: { email, emailVerifiedAt: now } }); await tx.driverAuthIdentity.upsert({ where: { driverId_provider: { driverId: driver.id, provider: 'email' } }, update: { subject: email, email, verifiedAt: now }, create: { driverId: driver.id, userId: auth.userId, provider: 'email', subject: email, email, verifiedAt: now } }) })
  return ok(request, { linked: true, provider: 'email' }, reply)
})

app.post('/api/auth/request-otp', async (request, reply) => {
  if (!config.driverAuthPhoneEnabled) throw notFound('Phone authentication is unavailable')
  const { phone } = bodyOf(request, z.object({ phone: z.string().min(7).max(20) }))
  const latest = await prisma.otpChallenge.findFirst({ where: { phone }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
  if (latest && Date.now() - latest.createdAt.getTime() < 30_000) throw new ApiError('OTP_RESEND_COOLDOWN', 'Please wait before requesting another code', 429)
  const recent = await prisma.otpChallenge.count({where:{phone,createdAt:{gte:new Date(Date.now()-60000)}}}); if(recent>=3) throw new ApiError('OTP_RATE_LIMIT','Please wait before requesting another code',429)
  const stagingTestPhone = config.stagingOtpTestMode && phone === config.stagingOtpTestPhone
  const code = stagingTestPhone ? config.stagingOtpTestCode : config.nodeEnv !== 'production' && config.devMockOtpEnabled ? config.devMockOtp : String(randomInt(100000, 1000000))
  const expiresAt = new Date(Date.now() + config.otpTtlSeconds * 1000)
  const challenge = await prisma.otpChallenge.create({ data: { phone, codeHash: hashOtp(phone, code), expiresAt, provider: stagingTestPhone ? 'staging_test' : config.otpProvider } })
  try {
    const delivery = await deliverOtp(phone, code)
    await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { provider: delivery.provider, providerMessageId: delivery.messageId, deliveryStatus: delivery.status, deliveryUpdatedAt: new Date() } })
  } catch (error) {
    await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { deliveryStatus: 'FAILED', deliveryErrorCode: error instanceof ApiError ? error.code : 'OTP_DELIVERY_UNAVAILABLE', deliveryUpdatedAt: new Date() } }).catch(() => undefined)
    throw error
  }
  return ok(request, { expiresAt, ...(config.nodeEnv !== 'production' && config.devMockOtpEnabled ? { devOtp: code } : {}) }, reply)
})

app.post('/api/auth/verify-otp', async (request, reply) => {
  if (!config.driverAuthPhoneEnabled) throw notFound('Phone authentication is unavailable')
  const { phone, code, name } = bodyOf(request, z.object({ phone: z.string().min(7), code: z.string().length(6), name: z.string().min(1).optional() }))
  const challenge = await prisma.otpChallenge.findFirst({ where: { phone, consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } })
  if(challenge) await prisma.otpChallenge.update({where:{id:challenge.id},data:{attempts:{increment:1}}})
  if (!challenge || challenge.attempts >= 5 || challenge.codeHash !== hashOtp(phone, code)) throw new ApiError('INVALID_OTP', 'Invalid or expired OTP', 401)
  const consumed = await prisma.otpChallenge.updateMany({ where: { id: challenge.id, consumedAt:null, attempts:{lte:5} }, data: { consumedAt: new Date() } }); if(consumed.count!==1) throw unauthorized('Code already used or too many attempts')
  const existingUser = await prisma.user.findUnique({ where: { phone }, select: { role: true } })
  if (existingUser && existingUser.role !== 'DRIVER') throw unauthorized('Driver authentication not permitted for this account')
  const user = await prisma.user.upsert({ where: { phone }, update: { ...(name ? { name } : {}), phoneVerifiedAt: new Date() }, create: { phone, phoneVerifiedAt: new Date(), name, role: 'DRIVER', accountStatus: 'PENDING' } })
  if (user.role !== 'DRIVER') throw unauthorized('Driver authentication not permitted for this account')
  const driver = await prisma.driver.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } })
  const tokens = await issueTokens(user.id, user.role, driver.id)
  return ok(request, { ...tokens, user: { id: user.id, phone: user.phone, role: user.role }, driver: { id: driver.id, onboardingStatus: driver.onboardingStatus } }, reply)
})

app.get('/api/webhooks/whatsapp', async (request, reply) => {
  const query = request.query as { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string }
  if (query['hub.mode'] !== 'subscribe' || !config.whatsappWebhookVerifyToken || query['hub.verify_token'] !== config.whatsappWebhookVerifyToken) throw unauthorized('Webhook verification failed')
  return reply.type('text/plain').send(query['hub.challenge'] ?? '')
})
app.post('/api/webhooks/whatsapp', async (request, reply) => {
  const signature = request.headers['x-hub-signature-256']
  const raw = String((request as any).rawBody ?? '')
  if (!config.whatsappAppSecret || typeof signature !== 'string' || !signature.startsWith('sha256=')) throw unauthorized('Webhook signature required')
  const expected = Buffer.from(`sha256=${createHmac('sha256', config.whatsappAppSecret).update(raw).digest('hex')}`)
  const received = Buffer.from(signature)
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw unauthorized('Webhook signature invalid')
  const payload = request.body as any
  const statuses = (payload?.entry ?? []).flatMap((entry: any) => (entry?.changes ?? []).flatMap((change: any) => change?.value?.statuses ?? []))
  for (const status of statuses) {
    const state = status?.status === 'delivered' ? 'DELIVERED' : status?.status === 'read' ? 'READ' : status?.status === 'failed' ? 'FAILED' : status?.status === 'sent' ? 'SENT' : null
    if (!state || typeof status?.id !== 'string') continue
    await prisma.otpChallenge.updateMany({ where: { provider: 'whatsapp_cloud', providerMessageId: status.id }, data: { deliveryStatus: state, deliveryErrorCode: status?.errors?.[0]?.code ? String(status.errors[0].code) : undefined, deliveryUpdatedAt: new Date() } })
  }
  return ok(request, { received: true }, reply)
})

app.post('/api/auth/admin/login', async (request, reply) => {
  try {
    const { email: rawEmail, password } = bodyOf(request, z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128) }))
    const email = normalizeAdminEmail(rawEmail)
    await enforceAdminLoginRateLimit(email, request.ip)
    const user = await findAdminByEmail(email)
    const validPassword = await verifyPassword(user?.passwordHash, password)
    const locked = Boolean(user?.lockedUntil && user.lockedUntil > new Date())
    if (!user || !validPassword || !assertAdminUser(user) || !user.passwordHash || locked) {
      if (user && assertAdminUser(user) && !locked && user.passwordHash && !validPassword) await markAdminLoginFailure(user.id, user.failedLoginAttempts)
      throw unauthorized('Invalid email or password')
    }
    await Promise.all([resetAdminLoginFailures(user.id), clearAdminLoginRateLimit(email)])
    const tokens = await issueTokens(user.id, user.role, undefined, { userAgent: request.headers['user-agent'], ipAddress: request.ip })
    return ok(request, { ...tokens, user: { id: user.id, email: user.email, role: user.role, name: user.name } }, reply)
  } catch (error) {
    // Log only safe Prisma identifiers for this 503; never log credentials,
    // request bodies, SQL text, connection strings, or raw error messages.
    if (error instanceof Prisma.PrismaClientInitializationError) {
      request.log.error({
        authStoreFailure: 'prisma_initialization',
        prismaErrorCode: error.errorCode ?? 'UNKNOWN',
      }, 'admin authentication store unavailable')
    } else if (error instanceof Prisma.PrismaClientKnownRequestError && ['P1001', 'P2022'].includes(error.code)) {
      const meta = error.meta ?? {}
      request.log.error({
        authStoreFailure: 'prisma_known_request',
        prismaCode: error.code,
        modelName: typeof meta.modelName === 'string' ? meta.modelName : undefined,
        column: typeof meta.column === 'string' ? meta.column : undefined,
      }, 'admin authentication store unavailable')
    }
    throw authStoreError(error)
  }
})

app.post('/api/auth/admin/request-password-reset', async (request, reply) => {
  const { email: rawEmail } = bodyOf(request, z.object({ email: z.string().email().max(254) }))
  const email = normalizeAdminEmail(rawEmail)
  const user = await findAdminByEmail(email)
  if (user && assertAdminUser(user) && user.email) {
    try { await issuePasswordReset(user.id, user.email, user.name) } catch (error) { request.log.error({ err: error }, 'admin password reset email failed') }
  }
  return reply.code(202).send(response(request, { message: 'If the account exists, password reset instructions will be sent.' }))
})

app.post('/api/auth/admin/setup-password', async (request, reply) => {
  const { token, password } = bodyOf(request, z.object({ token: z.string().min(32).max(128), password: z.string().min(1).max(128) }))
  validateAdminPassword(password)
  await consumePasswordToken('setup', token, password)
  return ok(request, { passwordSet: true }, reply)
})

app.post('/api/auth/admin/reset-password', async (request, reply) => {
  const { token, password } = bodyOf(request, z.object({ token: z.string().min(32).max(128), password: z.string().min(1).max(128) }))
  validateAdminPassword(password)
  await consumePasswordToken('reset', token, password)
  return ok(request, { passwordReset: true }, reply)
})

app.post('/api/auth/refresh', async (request, reply) => {
  const { refreshToken } = bodyOf(request, z.object({ refreshToken: z.string().min(20) }))
  const session = await prisma.session.findUnique({ where: { refreshTokenHash: hashSecret(refreshToken) }, include: { user: { include: { driver: true } } } })
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.accountStatus !== 'ACTIVE') throw new ApiError('INVALID_SESSION', 'Refresh session is invalid', 401)
  await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } })
  retu…27702 tokens truncated…g().uuid().optional(), latitude: z.number().optional(), longitude: z.number().optional(), notes: z.string().optional() })); return ok(request, await prisma.safetyIncident.create({ data: { driverId: d.id, occurredAt: new Date(), ...input } }), reply) })
app.post('/api/roadside/requests', async (request, reply) => { const auth = await requireAuth(request); const d = await driverFrom(auth); const input = bodyOf(request, z.object({ issueType: z.string(), vehicleId: z.string().uuid().optional(), latitude: z.number().optional(), longitude: z.number().optional() })); return ok(request, await prisma.roadsideRequest.create({ data: { driverId: d.id, ...input, provider: 'MOCK_PROVIDER' } }), reply) })
app.post('/api/support/tickets', async (request, reply) => { const auth = await requireAuth(request); const d = await driverFrom(auth); const input = bodyOf(request, z.object({ category: z.enum(['GENERAL', 'DISPLAY', 'PAYMENT', 'RIDE', 'SAFETY']), description: z.string().trim().min(10).max(2000), rideId: z.string().uuid().optional(), displayId: z.string().uuid().optional(), vehicleId: z.string().uuid().optional() })); const ticket = await prisma.$transaction(async (tx) => { const created = await tx.supportTicket.create({ data: { driverId: d.id, ...input } }); await tx.auditLog.create({ data: { actorId: auth.userId, actorRole: auth.role, action: 'SUPPORT_TICKET_CREATED', entityType: 'SupportTicket', entityId: created.id, after: { category: created.category, rideId: created.rideId, displayId: created.displayId, vehicleId: created.vehicleId }, requestId: request.id } }); return created }); return ok(request, { id: ticket.id, category: ticket.category, status: ticket.status, createdAt: ticket.createdAt }, reply) })
app.get('/api/agreements/required', async (request, reply) => ok(request, await prisma.agreementVersion.findMany({ where: { required: true }, orderBy: { createdAt: 'desc' }, select: { id: true, type: true, version: true, contentUrl: true, contentHash: true, required: true, createdAt: true } }), reply))
app.get('/api/driver/consents', async (request, reply) => { const auth = await requireAuth(request); const d = await driverFrom(auth); return ok(request, await prisma.driverConsent.findMany({ where: { driverId: d.id }, include: { agreementVersion: { select: { id: true, type: true, version: true, contentUrl: true, contentHash: true, required: true } } }, orderBy: { acceptedAt: 'desc' } }), reply) })
app.post('/api/agreements/:versionId/accept', async (request, reply) => { const auth = await requireAuth(request); const d = await driverFrom(auth); const { versionId } = request.params as { versionId: string }; const agreement = await prisma.agreementVersion.findUnique({ where: { id: versionId } }); if (!agreement) throw notFound('Agreement version not found'); const consent = await prisma.driverConsent.upsert({ where: { driverId_agreementVersionId: { driverId: d.id, agreementVersionId: versionId } }, update: { acceptedAt: new Date(), revokedAt: null }, create: { driverId: d.id, agreementVersionId: versionId } }); await prisma.auditLog.create({ data: { actorId: auth.userId, actorRole: auth.role, action: 'DRIVER_AGREEMENT_ACCEPTED', entityType: 'DriverConsent', entityId: consent.id, after: { agreementType: agreement.type, agreementVersion: agreement.version, contentHash: agreement.contentHash, acceptedAt: consent.acceptedAt }, requestId: request.id } }); return ok(request, { id: consent.id, agreementVersionId: consent.agreementVersionId, acceptedAt: consent.acceptedAt, agreementVersion: agreement.version, contentHash: agreement.contentHash }, reply) })
app.post('/api/agreements/:versionId/revoke', async (request, reply) => { const auth = await requireAuth(request); const d = await driverFrom(auth); const { versionId } = request.params as { versionId: string }; const consent = await prisma.driverConsent.findUnique({ where: { driverId_agreementVersionId: { driverId: d.id, agreementVersionId: versionId } } }); if (!consent) throw notFound('Consent record not found'); const updated = await prisma.driverConsent.update({ where: { id: consent.id }, data: { revokedAt: new Date() } }); await prisma.auditLog.create({ data: { actorId: auth.userId, actorRole: auth.role, action: 'DRIVER_AGREEMENT_REVOKED', entityType: 'DriverConsent', entityId: consent.id, after: { agreementVersionId: versionId, revokedAt: updated.revokedAt }, requestId: request.id } }); return ok(request, { id: updated.id, revokedAt: updated.revokedAt }, reply) })

app.post('/api/admin/displays', async (request, reply) => {
  const auth = await requireRoles(request, ['ADMIN', 'SUPER_ADMIN', 'OPERATIONS'])
  const input = bodyOf(request, z.object({
    screenName: z.string().trim().min(1).max(120),
    screenType: z.string().trim().min(1).max(40),
    city: z.string().trim().min(1).max(100),
    area: z.string().trim().max(100).optional(),
    vehicleId: z.string().trim().optional(),
    notes: z.string().trim().max(1000).optional(),
  }))
  const vehicle = input.vehicleId ? await prisma.vehicle.findFirst({ where: { OR: [...(/^[0-9a-f-]{36}$/i.test(input.vehicleId) ? [{ id: input.vehicleId }] : []), { registrationNumber: input.vehicleId }] } }) : null
  const display = await prisma.display.create({ data: { deviceId: `pending-${randomSecret(8)}`, name: input.screenName, ownershipType: input.screenType, vehicleId: vehicle?.id, inventoryConfig: {create:{city:input.city,coverage:{area:input.area??""}}} } })
  const code = generatePairingCode(); const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
  await prisma.displayPairingCode.create({ data: { displayId: display.id, codeHash: hashSecret(code), codeLast4: code.slice(-4), expiresAt } })
  await prisma.auditLog.create({ data: { actorId: auth.userId, actorRole: auth.role, action: 'DISPLAY_CREATED', entityType: 'Display', entityId: display.id, after: { city: input.city, area: input.area, notes: input.notes } as any, requestId: request.id } })
  return ok(request, { displayId: display.id, pairingCode: code, expiresAt, display }, reply)
})
app.patch('/api/admin/displays/:displayId/assignment', async (request, reply) => {
  const auth = await requirePermission(request, 'device:write')
  const { displayId } = request.params as { displayId: string }
  const input = bodyOf(request, z.object({ vehicleId: z.string().uuid().nullable() }))
  const display = await prisma.display.findUnique({ where: { id: displayId }, select: { id: true, vehicleId: true, state: true } }); if (!display) throw notFound('Display not found')
  const vehicle = input.vehicleId ? await prisma.vehicle.findUnique({ where: { id: input.vehicleId }, include: { driver: { include: { user: true } } } }) : null
  if (input.vehicleId && (!vehicle || vehicle.driver.onboardingStatus !== 'APPROVED' || vehicle.driver.user.accountStatus !== 'ACTIVE')) throw new ApiError('DRIVER_NOT_ELIGIBLE', 'Only an approved active driver vehicle may receive a display', 409)
  const saved = await prisma.$transaction(async (tx) => {
    await tx.displayPairingCode.updateMany({ where: { displayId, consumedAt: null, revokedAt: null }, data: { revokedAt: new Date() } })
    const updated = await tx.display.update({ where: { id: displayId }, data: { vehicleId: input.vehicleId, deviceTokenHash: null, state: 'UNPAIRED' } })
    await tx.auditLog.create({ data: { actorId: auth.userId, actorRole: auth.role, action: input.vehicleId ? 'DISPLAY_ASSIGNED' : 'DISPLAY_UNASSIGNED', entityType: 'Display', entityId: displayId, before: { vehicleId: display.vehicleId, state: display.state }, after: { vehicleId: input.vehicleId, state: updated.state }, requestId: request.id } })
    return updated
  })
  return ok(request, { displayId: saved.id, vehicleId: saved.vehicleId, state: saved.state }, reply)
})
app.delete('/api/admin/displays/:displayId', async (request, reply) => {
  const auth = await requirePermission(request, 'device:write')
  const { displayId } = request.params as { displayId: string }
  const display = await prisma.display.findUnique({ where: { id: displayId }, select: { id: true, state: true, deviceTokenHash: true } })
  if (!display) throw notFound('Screen not found')
  if (display.state === 'DELETED') return ok(request, { displayId, state: 'DELETED', pendingUnpair: false }, reply)
  const result = await prisma.$transaction(async (tx) => {
    const assignments = await tx.displayCampaignAssignment.findMany({ where: { displayId, active: true }, select: { campaignId: true } })
    await tx.displayCampaignAssignment.updateMany({ where: { displayId }, data: { active: false } })
    await tx.inventoryAllocation.updateMany({ where: { screenId: displayId, status: { in: ['RESERVED', 'ACTIVE'] } }, data: { status: 'CANCELLED' } })
    await tx.displayCommand.updateMany({ where: { displayId, commandType: { in: ['REFRESH_MANIFEST', 'SYNC_MANIFEST'] }, status: { in: ['QUEUED', 'DELIVERED'] } }, data: { status: 'CANCELLED', error: 'SUPERSEDED_BY_SCREEN_REMOVAL' } })
    await tx.displayPairingCode.updateMany({ where: { displayId, consumedAt: null, revokedAt: null }, data: { revokedAt: new Date() } })
    let commandId: string | null = null
    const paired = Boolean(display.deviceTokenHash)
    if (paired) {
      const existing = await tx.displayCommand.findFirst({ where: { displayId, commandType: 'UNPAIR', status: { in: ['QUEUED', 'DELIVERED'] } }, orderBy: { createdAt: 'desc' } })
      const command = existing
        ? await tx.displayCommand.update({ where: { id: existing.id }, data: { payload: { deleteAfterUnpair: true }, status: 'QUEUED', deliveredAt: null, acknowledgedAt: null, failedAt: null, error: null, expiresAt: null } })
        : await tx.displayCommand.create({ data: { displayId, commandType: 'UNPAIR', payload: { deleteAfterUnpair: true }, expiresAt: null } })
      commandId = command.id
      await tx.display.update({ where: { id: displayId }, data: { state: 'DISABLED' } })
    } else {
      await tx.display.update({ where: { id: displayId }, data: { state: 'DELETED', deviceTokenHash: null } })
    }
    await tx.auditLog.create({ data: { actorId: auth.userId, actorRole: auth.role, action: 'DISPLAY_DELETE_REQUESTED', entityType: 'Display', entityId: displayId, before: { state: display.state }, after: { state: paired ? 'DISABLED_PENDING_UNPAIR' : 'DELETED', commandId, activeCampaignsRemoved: assignments.length }, requestId: request.id } })
    return { state: paired ? 'DISABLED_PENDING_UNPAIR' : 'DELETED', commandId, pendingUnpair: paired }
  })
  return ok(request, { displayId, ...result }, reply)
})
app.post('/api/admin/displays/:displayId/unpair', async (request, reply) => {
  const auth = await requirePermission(request, 'device:write')
  const { displayId } = request.params as { displayId: string }
  const display = await prisma.display.findUnique({ where: { id: displayId }, select: { id: true, state: true, deviceTokenHash: true } })
  if (!display || display.state === 'DELETED') throw notFound('Screen not found')
  const result = await prisma.$transaction(async (tx) => {
    await tx.displayCampaignAssignment.updateMany({ where: { displayId }, data: { active: false } })
    await tx.inventoryAllocation.updateMany({ where: { screenId: displayId, status: { in: ['RESERVED', 'ACTIVE'] } }, data: { status: 'CANCELLED' } })
    await tx.displayCommand.updateMany({ where: { displayId, commandType: { in: ['REFRESH_MANIFEST', 'SYNC_MANIFEST'] }, status: { in: ['QUEUED', 'DELIVERED'] } }, data: { status: 'CANCELLED', error: 'SUPERSEDED_BY_UNPAIR' } })
    await tx.displayPairingCode.updateMany({ where: { displayId, consumedAt: null, revokedAt: null }, data: { revokedAt: new Date() } })
    let command = null
    if (display.deviceTokenHash) {
      const existing = await tx.displayCommand.findFirst({ where: { displayId, commandType: 'UNPAIR', status: { in: ['QUEUED', 'DELIVERED'] } }, orderBy: { createdAt: 'desc' } })
      command = existing
        ? await tx.displayCommand.update({ where: { id: existing.id }, data: { payload: {}, status: 'QUEUED', deliveredAt: null, acknowledgedAt: null, failedAt: null, error: null, expiresAt: null } })
        : await tx.displayCommand.create({ data: { displayId, commandType: 'UNPAIR', payload: {}, expiresAt: null } })
    }
    const updated = await tx.display.update({ where: { id: displayId }, data: { state: 'UNPAIRED' } })
    await tx.auditLog.create({ data: { actorId: auth.userId, actorRole: auth.role, action: 'DISPLAY_UNPAIR_REQUESTED', entityType: 'Display', entityId: displayId, before: { state: display.state }, after: { state: 'UNPAIRED', commandId: command?.id ?? null, assignmentsRemoved: true }, requestId: request.id } })
    return { state: updated.state, command, pendingDeviceCleanup: Boolean(command) }
  })
  return ok(request, { displayId, ...result }, reply)
})
app.get('/api/admin/drivers', async (request, reply) => { await requirePermission(request, 'driver:read'); return ok(request, asJson(await prisma.driver.findMany({ include: { user: true, vehicles: true, documents: { select: { id: true, documentType: true, status: true, rejectionReason: true } } }, orderBy: { createdAt: 'desc' } })), reply) })
app.post('/api/admin/drivers', async (request, reply) => {
  const actor = await requireRoles(request, ['SUPER_ADMIN'])
  const input = bodyOf(request, z.object({ name: z.string().trim().min(2).max(120), phone: z.string().trim().min(7).max(20), city: z.string().trim().max(120).optional() }))
  const phone = normalizeIndianPhone(input.phone)
  if (!phone) throw new ApiError('INVALID_PHONE', 'Enter a valid 10-digit Indian mobile number', 422)
  const existing = await prisma.user.findUnique({ where: { phone }, include: { driver: true } })
  if (existing && existing.role !== 'DRIVER') throw new ApiError('PHONE_IN_USE', 'This phone number belongs to a non-driver account', 409)
  if (existing?.driver) throw new ApiError('DRIVER_ALREADY_EXISTS', 'A driver profile already exists for this phone number', 409)
  const created = await prisma.$transaction(async tx => {
    const user = existing
      ? await tx.user.update({ where: { id: existing.id }, data: { name: existing.name || input.name } })
      : await tx.user.create({ data: { phone, name: input.name, role: 'DRIVER', accountStatus: 'PENDING' } })
    const driver = await tx.driver.create({ data: { userId: user.id, city: input.city || null, onboardingStatus: 'PROFILE' } })
    await tx.auditLog.create({ data: { actorId: actor.userId, actorRole: actor.role, action: 'DRIVER_PROFILE_CREATED', entityType: 'Driver', entityId: driver.id, after: { onboardingStatus: driver.onboardingStatus, city: driver.city }, requestId: request.id } })
    return { id: driver.id, name: user.name, phone: user.phone, city: driver.city, onboardingStatus: driver.onboardingStatus, accountStatus: user.accountStatus }
  })
  return reply.code(201).send(response(request, created))
})
app.get('/api/admin/drivers/:driverId/review', async (request, reply) => {
  await requireRoles(request, adminRoles); const { driverId } = request.params as { driverId: string }
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, include: { user: true, documents: { select: { id: true, documentType: true, status: true, maskedDocumentNumber: true, rejectionReason: true, expiresAt: true, submittedAt: true, verifiedAt: true, verifiedBy: true } }, vehicles: { include: { displays: true } }, consents: { include: { agreementVersion: true } }, integrations: true } })
  if (!driver) throw notFound('Driver not found')
  return ok(request, asJson(driver), reply)
})
app.get('/api/admin/otp/provider-health', async (request, reply) => {
  await requirePermission(request, 'admin:read')
  const since = new Date(Date.now() - 24 * 60 * 60_000)
  const [recent, statuses, failures] = await Promise.all([
    prisma.otpChallenge.count({ where: { createdAt: { gte: since } } }),
    prisma.otpChallenge.groupBy({ by: ['deliveryStatus'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.otpChallenge.groupBy({ by: ['deliveryErrorCode'], where: { createdAt: { gte: since }, deliveryStatus: 'FAILED', deliveryErrorCode: { not: null } }, _count: { _all: true } }),
  ])
  const completeness = config.otpProvider === 'whatsapp_cloud'
    ? { accessToken: Boolean(config.whatsappAccessToken), phoneNumberId: Boolean(config.whatsappPhoneNumberId), businessAccountId: Boolean(config.whatsappBusinessAccountId), templateName: Boolean(config.whatsappOtpTemplateName), templateLanguage: Boolean(config.whatsappOtpTemplateLanguage), graphApiVersion: /^v\d+\.\d+$/.test(config.whatsappGraphApiVersion) }
    : config.otpProvider === 'msg91'
      ? { authKey: Boolean(config.msg91AuthKey), templateId: Boolean(config.msg91TemplateId) }
      : { deliveryUrl: config.otpDeliveryUrl.startsWith('https://'), deliveryToken: Boolean(config.otpDeliveryToken) }
  return ok(request, { activeProvider: config.otpProvider, configurationComplete: Object.values(completeness).every(Boolean), configuration: completeness, window: '24h', recentRequests: recent, statuses: Object.fromEntries(statuses.map((row) => [row.deliveryStatus, row._count._all])), failureCodes: Object.fromEntries(failures.map((row) => [row.deliveryErrorCode ?? 'UNKNOWN', row._count._all])), rateLimitPolicy: { requestsPerMinute: 3, verificationAttempts: 5, otpTtlSeconds: config.otpTtlSeconds } }, reply)
})
app.get('/api/admin/drivers/:driverId/documents/:documentId/access', async (request, reply) => {
  const auth = await requireRoles(request, ['ADMIN', 'SUPER_ADMIN', 'OPERATIONS']); const { driverId, documentId } = request.params as { driverId: string; documentId: string }
  const document = await prisma.kycDocument.findFirst({ where: { id: documentId, driverId }, select: { id: true, storageKey: true, status: true, documentType: true } })
  if (!document) throw notFound('KYC document not found')
  const expiresAt = new Date(Date.now() + config.documentStorageReadTtlSeconds * 1000)
  const url = await privateDocumentStorage.signedReadUrl(document.storageKey, expiresAt)
  await prisma.auditLog.create({ data: { actorId: auth.userId, actorRole: auth.role, action: 'KYC_DOCUMENT_ACCESSED', entityType: 'KycDocument', entityId: document.id, after: { documentType: document.documentType, status: document.status, expiresAt }, requestId: request.id } })
  return ok(request, { documentId: document.id, url, expiresAt }, reply)
})
app.post('/api/admin/drivers/:driverId/kyc/:documentId/decision', async (request, reply) => {
  const auth = await requireRoles(request, ['ADMIN', 'SUPER_ADMIN', 'OPERATIONS']); const { driverId, documentId } = request.params as { driverId: string; documentId: string }
  const input = bodyOf(request, z.object({ status: z.enum(['VERIFIED', 'REJECTED']), rejectionReason: z.string().trim().max(500).optional() }))
  const document = await prisma.kycDocument.findFirst({ where: { id: documentId, driverId } }); if (!document) throw notFound('KYC document not found')
  if (input.status === 'REJECTED' && !input.rejectionReason) throw new ApiError('REJECTION_REASON_REQUIRED', 'A rejection reason is required', 422)
  if (input.status === 'VERIFIED' && document.scanStatus !== 'CLEAN') throw new ApiError('DOCUMENT_NOT_SCANNED', 'Only malware-scanned documents can be verified', 409)
  const updated = await prisma.kycDocument.update({ where: { id: documentId }, data: { status: input.status, verifiedAt: input.status === 'VERIFIED' ? new Date() : null, verifiedBy: auth.userId, rejectionReason: input.status === 'REJECTED' ? input.rejectionReason : null } })
  await prisma.auditLog.create({ data: { actorId: auth.userId, actorRole: auth.role, action: `KYC_DOCUMENT_${input.status}`, entityType: 'KycDocument', entityId: documentId, before: { status: document.status }, after: { status: updated.status, rejectionReason: updated.rejectionReason }, requestId: request.id } })
  return ok(request, { id: updated.id, status: updated.status, rejectionReason: updated.rejectionReason }, reply)
})
app.post('/api/admin/drivers/:driverId/approval', async (request, reply) => {
  const auth = await requireRoles(request, ['ADMIN', 'SUPER_ADMIN']); const { driverId } = request.params as { driverId: string }
  const input = bodyOf(request, z.object({ decision: z.enum(['APPROVE', 'REJECT', 'CHANGES_REQUESTED', 'UNDER_REVIEW']), reason: z.string().trim().max(500).optional() }))
  if (['REJECT', 'CHANGES_REQUESTED'].includes(input.decision) && !input.reason) throw new ApiError('REJECTION_REASON_REQUIRED', 'A reason is required', 422)
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, include: { user: true, documents: true } }); if (!driver) throw notFound('Driver not found')
  if (input.decision === 'APPROVE') {
    const requiredTypes = ['AADHAAR', 'PAN', 'DRIVING_LICENCE', 'RC']
    const verified = new Set(driver.documents.filter((doc) => doc.status === 'VERIFIED').map((doc) => doc.documentType))
    const missing = requiredTypes.filter((type) => !verified.has(type))
    if (missing.length) throw new ApiError('ONBOARDING_INCOMPLETE', `Required verified documents missing: ${missing.join(', ')}`, 409)
  }
  const updated = await prisma.$transaction(async (tx) => {
    const nextStatus = input.decision === 'APPROVE' ? 'APPROVED' : input.decision === 'REJECT' ? 'REJECTED' : input.decision
    transitionDriverOnboarding(driver.onboardingStatus, nextStatus as any)
    const accountStatus = input.decision === 'APPROVE' ? 'ACTIVE' : 'PENDING'
    const saved = await tx.driver.update({ where: { id: driverId }, data: { onboardingStatus: nextStatus } })
    await tx.user.update({ where: { id: driver.userId }, data: { accountStatus } })
    await tx.driverActivationReview.create({ data: { driverId, decision: nextStatus, reason: input.reason, actorId: auth.userId } })
    await tx.auditLog.create({ data: { actorId: auth.userId, actorRole: auth.role, action: `DRIVER_${nextStatus}`, entityType: 'Driver', entityId: driverId, before: { onboardingStatus: driver.onboardingStatus, accountStatus: driver.user.accountStatus }, after: { onboardingStatus: nextStatus, accountStatus, reason: input.reason }, requestId: request.id } })
    return saved
  })
  return ok(request, { driverId: updated.id, onboardingStatus: updated.onboardingStatus, accountStatus: input.decision === 'APPROVE' ? 'ACTIVE' : 'PENDING', reason: input.reason }, reply)
})
app.get('/api/admin/drivers/:driverId/activation-history', async (request, reply) => { await requireRoles(request, adminRoles); const { driverId } = request.params as { driverId: string }; return ok(request, await prisma.driverActivationReview.findMany({ where: { driverId }, orderBy: { createdAt: 'desc' } }), reply) })
app.post('/api/admin/drivers/:driverId/beneficiaries/:beneficiaryId/decision', async (request, reply) => { const auth = await requireRoles(request, ['ADMIN', 'SUPER_ADMIN', 'FINANCE']); const { driverId, beneficiaryId } = request.params as { driverId: string; beneficiaryId: string }; const input = bodyOf(request, z.object({ status: z.enum(['VERIFIED', 'REJECTED']), reason: z.string().trim().max(500).optional() })); if (input.status === 'REJECTED' && !input.reason) throw new ApiError('REJECTION_REASON_REQUIRED', 'A rejection reason is required', 422); const beneficiary = await prisma.bankBeneficiary.findFirst({ where: { id: beneficiaryId, driverId } }); if (!beneficiary) throw notFound('Beneficiary not found'); const updated = await prisma.bankBeneficiary.update({ where: { id: beneficiaryId }, data: { verificationStatus: input.status, rejectionReason: input.status === 'REJECTED' ? input.reason : null, verifiedAt: input.status === 'VERIFIED' ? new Date() : null } }); await prisma.auditLog.create({ data: { actorId: auth.userId, actorRole: auth.role, action: `BANK_BENEFICIARY_${input.status}`, entityType: 'BankBeneficiary', entityId: beneficiaryId, before: { verificationStatus: beneficiary.verificationStatus }, after: { verificationStatus: updated.verificationStatus, reason: input.reason }, requestId: request.id } }); return ok(request, { id: updated.id, verificationStatus: updated.verificationStatus, rejectionReason: updated.rejectionReason }, reply) })
app.get('/api/admin/drivers/:driverId/duty-sessions', async (request, reply) => { await requireRoles(request, adminRoles); const { driverId } = request.params as { driverId: string }; return ok(request, await prisma.dutySession.findMany({ where: { driverId }, orderBy: { startedAt: 'desc' }, take: 200 }), reply) })
app.post('/api/admin/documents/cleanup', async (request, reply) => {
  const auth = await requireRoles(request, ['ADMIN', 'SUPER_ADMIN', 'OPERATIONS'])
  const expired = await prisma.documentUploadSession.findMany({ where: { status: 'ISSUED', expiresAt: { lt: new Date() } }, select: { id: true, objectKey: true }, take: 500 })
  let deleted = 0
  for (const session of expired) { if (privateDocumentStorage.delete) await privateDocumentStorage.delete(session.objectKey); deleted += 1 }
  if (expired.length) await prisma.documentUploadSession.updateMany({ where: { id: { in: expired.map((session) => session.id) } }, data: { status: 'EXPIRED' } })
  await prisma.auditLog.create({ data: { actorId: auth.userId, actorRole: auth.role, action: 'DOCUMENT_UPLOAD_CLEANUP', entityType: 'DocumentUploadSession', entityId: 'batch', after: { expired: expired.length, deleted }, requestId: request.id } })
  return ok(request, { expired: expired.length, deleted }, reply)
})
app.get('/api/admin/vehicles', async (request, reply) => { await requirePermission(request, 'device:read'); return ok(request, await prisma.vehicle.findMany({ include: { driver: { include: { user: true } }, displays: true } }), reply) })
app.get('/api/admin/displays', async (request, reply) => {
  await requirePermission(request, 'device:read')
  const rows = await prisma.display.findMany({
    // Disabled screens are already removed from live fleet operations. Their
    // UNPAIR command can still finish in the background if the player returns.
    where: { state: { notIn: ['DELETED', 'DISABLED'] } },
    select: {
      id: true, deviceId: true, name: true, ownershipType: true, inventoryConfig: { select: { city: true } }, vehicleId: true,
      state: true, appVersion: true, manifestVersion: true, lastLatitude: true, lastLongitude: true, lastLocationAccuracy: true,
      lastLocationAt: true, lastHeartbeatAt: true, currentCampaignId: true, currentCreativeId: true, currentAssetId: true,
      currentPlaybackState: true, currentPlaybackStartedAt: true, currentPlaybackPositionMs: true, currentExpectedDurationMs: true,
      vehicle: { select: { registrationNumber: true, city: true, area: true, type: true, routeId: true, depotId: true } },
      zoneConfig: { select: { layoutContractVersion: true } },
      layoutAssignments: { where: { revokedAt: null }, orderBy: { assignedAt: 'desc' }, take: 1, select: { id: true, state: true, template: { select: { name: true } }, revision: { select: { revision: true } } } },
      deviceOsDevice: { select: { enrollmentStatus: true, lastSeenAt: true, capabilities: true, inventory: { where: { packageName: 'com.ooro.screenplayer' }, take: 1, select: { versionName: true, versionCode: true, lastSeenAt: true } } } },
      createdAt: true, updatedAt: true,
      heartbeats: { select: { occurredAt: true, receivedAt: true, networkType: true, networkConnected: true, storageFree: true, storageTotal: true, appVersion: true, manifestVersion: true, activeLayout: true, layoutContractVersion: true, playbackState: true, currentCreativeId: true }, orderBy: { receivedAt: 'desc' }, take: 1 },
      proofs: { where: { status: 'VALID', playbackCompleted: true }, select: { creativeId: true, campaignId: true, playbackStartedAt: true, slot: true, status: true }, orderBy: { playbackStartedAt: 'desc' }, take: 1 },
      commands: { select: { id: true, commandType: true, status: true, createdAt: true, deliveredAt: true, acknowledgedAt: true, failedAt: true, expiresAt: true, error: true }, orderBy: { createdAt: 'desc' }, take: 20 },
    },
  })
  const uuid = (value?: string | null) => Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
  const now = new Date()
  const recentVerifiedPlayback = (display: typeof rows[number]) => {
    const proof = display.proofs[0]
    const heartbeat = display.heartbeats[0]
    const heartbeatAt = heartbeat?.receivedAt ?? display.lastHeartbeatAt
    return Boolean(proof && heartbeat && proof.creativeId && proof.creativeId === heartbeat.currentCreativeId && heartbeat.playbackState === 'PLAYING' && heartbeatAt && getDisplayConnectivity(heartbeatAt, now, config.heartbeatOnlineSeconds, config.heartbeatDegradedSeconds) === 'ONLINE' && proof.playbackStartedAt.getTime() <= now.getTime() + 30_000 && now.getTime() - proof.playbackStartedAt.getTime() <= 5 * 60_000)
  }
  const trustedCreativeIds = [...new Set(rows.filter(recentVerifiedPlayback).map(display => display.proofs[0]?.creativeId).filter((id): id is string => uuid(id)))]
  const creativeIds = [...new Set([...trustedCreativeIds, ...rows.map((display) => display.currentCreativeId).filter((id): id is string => uuid(id))])]
  const [creatives, latestOoroRelease] = await Promise.all([
    creativeIds.length ? prisma.creative.findMany({ where: { id: { in: creativeIds } }, select: { id: true, name: true, campaign: { select: { id: true, name: true } }, asset: { select: { url: true, mimeType: true, fileName: true } } } }) : Promise.resolve([]),
    prisma.applicationRelease.findFirst({ where: { packageName: 'com.ooro.screenplayer', approvalStatus: 'APPROVED', application: { allowed: true } }, orderBy: { versionCode: 'desc' }, select: { versionName: true, versionCode: true, sha256: true, certificateSha256: true, minSdk: true } }),
  ])
  const creativeById = new Map(creatives.map((creative) => [creative.id, creative]))
  const latestForDisplay = (display: typeof rows[number]) => {
    const capabilities = display.deviceOsDevice?.capabilities && typeof display.deviceOsDevice.capabilities === 'object' && !Array.isArray(display.deviceOsDevice.capabilities) ? display.deviceOsDevice.capabilities as Record<string, unknown> : {}
    const deviceSdk = typeof capabilities.androidSdkInt === 'number' && Number.isInteger(capabilities.androidSdkInt) ? capabilities.androidSdkInt : null
    const installed = display.deviceOsDevice?.inventory[0]
    if (!installed || !latestOoroRelease) return 'UNKNOWN'
    if (!display.deviceOsDevice?.lastSeenAt || Date.now() - display.deviceOsDevice.lastSeenAt.getTime() > 24 * 60 * 60_000 || !installed.lastSeenAt || Date.now() - installed.lastSeenAt.getTime() > 24 * 60 * 60_000) return 'UNKNOWN'
    if (installed.versionCode >= latestOoroRelease.versionCode) return 'UP_TO_DATE'
    return deviceSdk !== null && isManagedDeviceReleaseCompatible({ currentVersionCode: installed.versionCode, targetVersionCode: latestOoroRelease.versionCode, minSdk: latestOoroRelease.minSdk, deviceSdk }) ? 'UPDATE_AVAILABLE' : 'UNKNOWN'
  }
  return ok(request, asJson(rows.map((display) => ({
    ...display,
    connectivity: getDisplayConnectivity(display.lastHeartbeatAt ?? display.heartbeats[0]?.receivedAt, new Date(), config.heartbeatOnlineSeconds, config.heartbeatDegradedSeconds),
    currentCreative: recentVerifiedPlayback(display) ? creativeById.get(display.proofs[0]!.creativeId!) ?? null : null,
    currentCreativeTrust: recentVerifiedPlayback(display) ? 'VERIFIED_RECENT_PROOF' : 'UNKNOWN',
    latestProof: display.proofs[0] ?? null,
    lastSuccessfulSync: display.commands.find(command => ['SYNC_MANIFEST', 'REFRESH_MANIFEST'].includes(command.commandType) && command.status === 'ACKNOWLEDGED')?.acknowledgedAt ?? null,
    latestCommand: display.commands[0] ? { ...display.commands[0], error: safeCommandError(display.commands[0].error) ?? null } : null,
    currentLayout: display.heartbeats[0]?.activeLayout ?? null,
    currentLayoutVersion: display.heartbeats[0]?.layoutContractVersion ?? null,
    layoutReportStatus: !display.heartbeats[0]?.activeLayout ? 'UNREPORTED' : getDisplayConnectivity(display.heartbeats[0].receivedAt, new Date(), config.heartbeatOnlineSeconds, config.heartbeatDegradedSeconds) === 'ONLINE' ? 'CURRENT' : 'STALE',
    assignedLayout: display.layoutAssignments[0]?.template.name ?? 'FOUR_ZONE',
    assignedLayoutVersion: display.layoutAssignments[0]?.revision.revision ?? display.zoneConfig?.layoutContractVersion ?? null,
    diagnostics: display.heartbeats[0] ? { networkType: display.heartbeats[0].networkType, networkConnected: display.heartbeats[0].networkConnected, storageFreeBytes: display.heartbeats[0].storageFree, storageTotalBytes: display.heartbeats[0].storageTotal, playerState: display.heartbeats[0].playbackState, manifestVersion: display.heartbeats[0].manifestVersion, activeLayout: display.heartbeats[0].activeLayout, layoutContractVersion: display.heartbeats[0].layoutContractVersion, layoutReportedAt: display.heartbeats[0].receivedAt } : null,
    installedPlayer: display.deviceOsDevice?.inventory[0] ?? null,
    playerUpdateStatus: latestForDisplay(display),
    latestApprovedPlayerRelease: latestOoroRelease,
  }))), reply)
})
app.get('/api/admin/displays/:displayId/live-state', async (request, reply) => {
  await requireRoles(request, adminRoles)
  const { displayId } = request.params as { displayId: string }
  const display = await prisma.display.findUnique({ where: { id: displayId }, include: { vehicle: true, heartbeats: { orderBy: { receivedAt: 'desc' }, take: 1 } } })
  if (!display) throw notFound('Display not found')
  const uuid = (value?: string | null) => value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null
  const [campaign, creative, recentEvent, recentProof] = await Promise.all([
    uuid(display.currentCampaignId) ? prisma.campaign.findUnique({ where: { id: display.currentCampaignId! }, select: { id: true, name: true } }) : null,
    uuid(display.currentCreativeId) ? prisma.creative.findUnique({ where: { id: display.currentCreativeId! }, include: { campaign: { select: { id: true, name: true } }, asset: { select: { url: true, mimeType: true, fileName: true } } } }) : null,
    prisma.playbackEvent.findFirst({ where: { displayId, eventType: { in: ['CREATIVE_COMPLETED', 'CREATIVE_FAILED'] } }, orderBy: { occurredAt: 'desc' } }),
    prisma.proofOfPlay.findFirst({ where: { displayId }, orderBy: { playbackStartedAt: 'desc' } }),
  ])
  const heartbeat = display.heartbeats[0]
  const connection = getDisplayConnectivity(heartbeat?.receivedAt, new Date(), config.heartbeatOnlineSeconds, config.heartbeatDegradedSeconds)
  const { deviceTokenHash: _tokenHash, ...safeDisplay } = display
  return ok(request, asJson({ ...safeDisplay, connectivity: connection, lastHeartbeat: heartbeat ?? null, currentCampaign: creative?.campaign ?? campaign, currentCreative: creative, lastProof: recentEvent && (!recentProof || recentEvent.occurredAt > recentProof.playbackStartedAt) ? recentEvent : recentProof }), reply)
})
app.get('/api/admin/displays/:displayId/fleet-detail', async (request, reply) => {
  await requirePermission(request, 'device:read')
  const { displayId } = request.params as { displayId: string }
  const display = await prisma.display.findUnique({
    where: { id: displayId },
    select: {
      id: true, deviceId: true, name: true, state: true, ownershipType: true, vehicleId: true, appVersion: true,
      manifestVersion: true, lastHeartbeatAt: true, currentCampaignId: true, currentCreativeId: true,
      currentAssetId: true, currentPlaybackState: true, currentPlaybackStartedAt: true, currentPlaybackPositionMs: true,
      currentExpectedDurationMs: true, manufacturer: true, model: true, androidVersion: true,
      vehicle: { select: { registrationNumber: true, city: true, area: true } },
      zoneConfig: { select: { layoutContractVersion: true, primaryWidthPercent: true, adHeightPercent: true, qrHeightPercent: true, newsScrollSpeed: true } },
      layoutAssignments: { where: { revokedAt: null }, orderBy: { assignedAt: 'desc' }, take: 1, select: { id: true, state: true, assignedAt: true, template: { select: { id: true, name: true } }, revision: { select: { id: true, revision: true, contractHash: true, publishedAt: true } } } },
      heartbeats: { orderBy: { receivedAt: 'desc' }, take: 50, select: { id: true, occurredAt: true, receivedAt: true, appVersion: true, deviceVersion: true, storageFree: true, storageTotal: true, networkType: true, networkConnected: true, manifestVersion: true, activeLayout: true, layoutContractVersion: true, currentCreativeId: true, playbackState: true, screenState: true, temperature: true, playbackStartedAt: true, playbackPositionMs: true, expectedDurationMs: true, manufacturer: true, model: true, androidVersion: true, batteryLevel: true, chargingState: true } },
      proofs: { orderBy: { playbackStartedAt: 'desc' }, take: 50, select: { id: true, campaignId: true, creativeId: true, assetId: true, scheduleItemId: true, slot: true, playbackStartedAt: true, playbackEndedAt: true, expectedDuration: true, actualDuration: true, playbackCompleted: true, status: true, invalidReason: true, manifestVersion: true, playerVersion: true } },
      playbackEvents: { orderBy: { occurredAt: 'desc' }, take: 50, select: { id: true, campaignId: true, creativeId: true, assetId: true, eventType: true, occurredAt: true, receivedAt: true, duration: true, manifestVersion: true, playerVersion: true, errorCode: true } },
      commands: { orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, commandType: true, status: true, createdAt: true, deliveredAt: true, acknowledgedAt: true, failedAt: true, cancelledAt: true, expiresAt: true, error: true } },
      deviceOsDevice: { select: {
        id: true, enrollmentStatus: true, lastSeenAt: true, capabilities: true,
        inventory: { where: { packageName: 'com.ooro.screenplayer' }, orderBy: { lastSeenAt: 'desc' }, take: 1, select: { versionName: true, versionCode: true, certificateSha256: true, lastSeenAt: true } },
        deploymentTargets: { orderBy: { updatedAt: 'desc' }, take: 20, select: {
          id: true, state: true, lastErrorCode: true, lastErrorMessage: true, updatedAt: true,
          campaign: { select: { id: true, name: true, state: true, release: { select: { id: true, packageName: true, versionName: true, versionCode: true, sha256: true, certificateSha256: true, minSdk: true, approvalStatus: true } } } },
          attempts: { orderBy: { attemptNumber: 'desc' }, take: 1, select: { state: true, checksumVerified: true, errorCode: true, completedAt: true } },
        } },
      } },
    },
  })
  if (!display) throw notFound('Display not found')
  const { manifest: desiredManifest } = await buildDisplayManifest(displayId)
  const capabilityData = display.deviceOsDevice?.capabilities && typeof display.deviceOsDevice.capabilities === 'object' && !Array.isArray(display.deviceOsDevice.capabilities) ? display.deviceOsDevice.capabilities as Record<string, unknown> : {}
  const playerManagement = {
    deviceOwner: capabilityData.deviceOwner === true ? 'CONFIRMED' : capabilityData.deviceOwner === false ? 'UNSUPPORTED' : 'UNCONFIRMED',
    silentInstall: capabilityData.silentInstall === true ? 'CONFIRMED' : capabilityData.silentInstall === false ? 'UNSUPPORTED' : 'UNCONFIRMED',
  }
  const commands = display.commands.map(command => ({ ...command, error: safeCommandError(command.error) ?? null }))
  const latestHeartbeat = display.heartbeats[0]
  const cacheIsFresh = Boolean(latestHeartbeat && getDisplayConnectivity(latestHeartbeat.receivedAt, new Date(), config.heartbeatOnlineSeconds, config.heartbeatDegradedSeconds) === 'ONLINE')
  const manifestState = { desiredVersion: desiredManifest.version, validUntil: desiredManifest.expiresAt, primaryItems: desiredManifest.items.length, sponsoredItemAvailable: Boolean(desiredManifest.sponsoredItem), deviceCachedVersion: latestHeartbeat?.manifestVersion ?? null, activeLayout: latestHeartbeat?.activeLayout ?? null, layoutContractVersion: latestHeartbeat?.layoutContractVersion ?? null, lastReportedAt: latestHeartbeat?.receivedAt ?? null, layoutReportStatus: !latestHeartbeat?.activeLayout ? 'UNREPORTED' : cacheIsFresh ? 'CURRENT' : 'STALE', cacheMatchesServer: cacheIsFresh ? latestHeartbeat?.manifestVersion === desiredManifest.version : null }
  return ok(request, asJson({ ...display, commands, playerManagement, manifestState, connectivityThresholds: { onlineSeconds: config.heartbeatOnlineSeconds, staleSeconds: config.heartbeatDegradedSeconds } }), reply)
})
app.get('/api/admin/displays/:displayId/player-releases', async (request, reply) => {
  await requirePermission(request, 'device:read')
  const { displayId } = request.params as { displayId: string }
  const managed = await prisma.managedDevice.findUnique({ where: { displayId }, select: { id: true, enrollmentStatus: true, capabilities: true, inventory: { where: { packageName: 'com.ooro.screenplayer' }, select: { versionCode: true, versionName: true }, take: 1 } } })
  if (!managed) return ok(request, { management: 'UNENROLLED', releases: [] }, reply)
  const capabilities = managed.capabilities && typeof managed.capabilities === 'object' && !Array.isArray(managed.capabilities) ? managed.capabilities as Record<string, unknown> : {}
  const deviceSdk = typeof capabilities.androidSdkInt === 'number' && Number.isInteger(capabilities.androidSdkInt) ? capabilities.androidSdkInt : null
  const releases = await prisma.applicationRelease.findMany({ where: { packageName: 'com.ooro.screenplayer', approvalStatus: 'APPROVED', application: { allowed: true } }, orderBy: { versionCode: 'desc' }, take: 25, select: { id: true, applicationId: true, packageName: true, versionCode: true, versionName: true, minSdk: true, sha256: true, certificateSha256: true, approvalStatus: true, application: { select: { allowed: true } } } })
  const compatible = deviceSdk === null ? [] : releases.filter(release => isManagedDeviceReleaseCompatible({ currentVersionCode: managed.inventory[0]?.versionCode, targetVersionCode: release.versionCode, minSdk: release.minSdk, deviceSdk }))
  return ok(request, asDeviceOsJson({ managedDeviceId: managed.id, enrollmentStatus: managed.enrollmentStatus, deviceSdk, compatibility: deviceSdk === null ? 'UNVERIFIED' : 'VERIFIED', silentInstall: capabilities.silentInstall === true ? 'CONFIRMED' : capabilities.silentInstall === false ? 'UNSUPPORTED' : 'UNCONFIRMED', releases: compatible }), reply)
})
app.post('/api/admin/displays/:displayId/player-release', async (request, reply) => {
  const auth = await requireRoles(request, deviceOsDeploymentRoles)
  const { displayId } = request.params as { displayId: string }
  const input = bodyOf(request, z.object({ releaseId: z.string().uuid() }))
  const headerKey = request.headers['idempotency-key']
  if (typeof headerKey !== 'string' || headerKey.trim().length < 8 || headerKey.trim().length > 200) throw new ApiError('IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key must be between 8 and 200 characters', 422)
  const idempotencyKey = headerKey.trim()
  const [display, managed] = await Promise.all([
    prisma.display.findUnique({ where: { id: displayId }, select: { id: true, name: true, state: true } }),
    prisma.managedDevice.findUnique({ where: { displayId }, include: { inventory: { where: { packageName: 'com.ooro.screenplayer' }, take: 1 } } }),
  ])
  if (!display || ['DELETED', 'DISABLED'].includes(display.state)) throw notFound('Screen not found')
  if (!managed || managed.enrollmentStatus !== 'ENROLLED' || managed.revokedAt) throw new ApiError('DEVICEOS_NOT_ENROLLED', 'Screen must have an enrolled DeviceOS agent before an update can be requested', 409)
  const release = await prisma.applicationRelease.findUnique({ where: { id: input.releaseId }, include: { application: true } })
  if (!release) throw notFound('Approved OORO Screen Player release not found')
  const capabilities = managed.capabilities && typeof managed.capabilities === 'object' && !Array.isArray(managed.capabilities) ? managed.capabilities as Record<string, unknown> : {}
  const deviceSdk = typeof capabilities.androidSdkInt === 'number' && Number.isInteger(capabilities.androidSdkInt) ? capabilities.androidSdkInt : null
  if (deviceSdk === null) throw new ApiError('DEVICE_COMPATIBILITY_UNVERIFIED', 'The screen has not reported its Android SDK version; release compatibility cannot be verified', 409)
  assertApprovedScreenPlayerRelease({ packageName: release.packageName, approvalStatus: release.approvalStatus, versionCode: release.versionCode, versionName: release.versionName, sha256: release.sha256, signingIdentity: release.certificateSha256, minSdk: release.minSdk, deviceSdk })
  if (!release.application.allowed || release.applicationId !== release.application.id) throw new ApiError('APPLICATION_NOT_ALLOWED', 'OORO Screen Player application is not allowlisted', 409)
  if (!isManagedDeviceReleaseCompatible({ currentVersionCode: managed.inventory[0]?.versionCode, targetVersionCode: release.versionCode, minSdk: release.minSdk, deviceSdk })) throw new ApiError('RELEASE_DEVICE_INCOMPATIBLE', 'Release is not compatible with this screen or would downgrade it', 409)
  const deployment = await createDeviceOsCampaign(prisma, { name: `Fleet update · ${display.name} · ${release.versionName}`, applicationId: release.applicationId, releaseId: release.id, targetingMode: 'DEVICES', deviceIds: [managed.id], idempotencyKey, createdBy: auth.userId })
  return ok(request, asDeviceOsJson({ ...deployment, silentInstall: capabilities.silentInstall === true ? 'CONFIRMED' : capabilities.silentInstall === false ? 'UNSUPPORTED' : 'UNCONFIRMED' }), reply)
})
app.get('/api/admin/displays/live-map', async (request, reply) => { await requireRoles(request, adminRoles); const now = new Date(); const rows = await prisma.display.findMany({ where: { lastLatitude: { not: null }, lastLongitude: { not: null }, lastLocationAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } }, select: { id: true, name: true, deviceId: true, vehicleId: true, vehicle: { select: { registrationNumber: true, city: true, area: true, type: true, routeId: true, depotId: true } }, lastLatitude: true, lastLongitude: true, lastLocationAccuracy: true, lastLocationAt: true, lastHeartbeatAt: true, currentCampaignId: true, currentCreativeId: true, currentAssetId: true, currentPlaybackState: true, currentPlaybackStartedAt: true, currentPlaybackPositionMs: true, currentExpectedDurationMs: true, manifestVersion: true } }); return ok(request, asJson(rows.map((display) => ({ ...display, connectivity: getDisplayConnectivity(display.lastHeartbeatAt ?? undefined, now, config.heartbeatOnlineSeconds, config.heartbeatDegradedSeconds) }))), reply) })
app.get('/api/admin/displays/:displayId/location-history', async (request, reply) => { await requireRoles(request, adminRoles); const { displayId } = request.params as { displayId: string }; const query = request.query as { from?: string; to?: string; limit?: string }; const limit = boundedLocationLimit(query.limit); const from = query.from ? new Date(query.from) : new Date(Date.now() - 24 * 60 * 60 * 1000); const to = query.to ? new Date(query.to) : new Date(); if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw new ApiError('VALIDATION_ERROR', 'Invalid history range', 422); const points = await prisma.displayLocationEvent.findMany({ where: { displayId, occurredAt: { gte: from, lte: to } }, orderBy: { occurredAt: 'desc' }, take: limit }); return ok(request, asJson(points.reverse()), reply) })
app.get('/api/admin/orders', async (request, reply) => { await requireRoles(request, ['ADMIN', 'SUPER_ADMIN', 'OPERATIONS', 'FINANCE']); const query = request.query as { status?: string; search?: string; skip?: string; take?: string }; const orders = await listGuestOrders({ status: query.status, search: query.search?.trim(), skip: Math.min(Number(query.skip ?? 0) || 0, 100000), take: Math.min(Number(query.take ?? 50) || 50, 100) }); return ok(request, orders, reply) })
app.get('/api/admin/orders/:orderNumber', async (request, reply) => { await requireRoles(request, ['ADMIN', 'SUPER_ADMIN', 'OPERATIONS', 'FINANCE']); const { orderNumber } = request.params as { orderNumber: string }; const order = await findGuestOrder(orderNumber); if (!order) throw notFound('Order not found'); return ok(request, order, reply) })
app.post('/api/admin/orders/:orderNumber/create-campaign', async (request, reply) => { const auth = await requireRoles(request, ['ADMIN', 'SUPER_ADMIN', 'OPERATIONS']); const { orderNumber } = request.params as { orderNumber: string }; const order = await findGuestOrder(orderNumber); if (!order) throw notFound('Order not found'); if (order.status !== 'PAID' && order.status !== 'FULFILLED') throw new ApiError('ORDER_NOT_PAID', 'Only paid orders can create campaigns', 409); if (order.campaignId) return ok(request, await prisma.campaign.findUnique({ where: { id: order.campaignId } }), reply); const campaign = await prisma.$transaction(async (tx) => { const created = await tx.campaign.create({ data: { name: `${order.businessName} — Tirupati`, status: 'CREATIVE_REQUIRED', timezone: 'Asia/Kolkata', priority: 0 } }); await updateGuestOrder(order._id.toString(), { campaignId: created.id }); await tx.auditLog.create({ data: { actorId: auth.userId, actorRole: auth.role, action: 'CAMPAIGN_CREATED_FROM_ORDER', entityType: 'Campaign', entityId: created.id, after: { orderNumber } as any, requestId: request.id } }); return created }); return ok(request, campaign, reply) })
app.get('/api/admin/rides', async (request, reply) => { await requireRoles(request, adminRoles); return ok(request, asJson(await prisma.ride.findMany({ orderBy: { createdAt: 'desc' }, take: 500, include: { verification: true, driver: { include: { user: true } } } })), reply) })
app.get('/api/admin/verifications', async (request, reply) => { await requireRoles(request, adminRoles); return ok(request, await prisma.rideVerification.findMany({ orderBy: { rideId: 'desc' }, include: { ride: true } }), reply) })
app.get('/api/admin/fraud', async (request, reply) => { await requireRoles(request, adminRoles); return ok(request, await prisma.fraudSignal.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }), reply) })
app.get('/api/admin/proof-of-play', async (request, reply) => {
 await requireRoles(request, adminRoles)
 const q = z.object({ campaignId:z.string().optional(),creativeId:z.string().optional(),displayId:z.string().uuid().optional(),vehicleId:z.string().uuid().optional(),routeId:z.string().uuid().optional(),from:z.coerce.date().optional(),to:z.coerce.date().optional(),success:z.enum(['true','false']).optional(),skip:z.coerce.number().int().min(0).max(100000).default(0) }).parse(request.query)
 const where = { campaignId:q.campaignId,creativeId:q.creativeId,displayId:q.displayId,playbackStartedAt:{gte:q.from,lte:q.to},playbackCompleted:q.success===undefined?undefined:q.success==='true',display:{vehicleId:q.vehicleId,...(q.routeId?{vehicle:{routeId:q.routeId}}:{})} }
 const [items,total] = await Promise.all([prisma.proofOfPlay.findMany({where,orderBy:{playbackStartedAt:'desc'},take:50,skip:q.skip,include:{display:{select:{name:true,vehicleId:true}}}}),prisma.proofOfPlay.count({where})])
 return ok(request,{items,total,skip:q.skip,take:50},reply)
})
app.get('/api/admin/earnings', async (request, reply) => { await requirePermission(request, 'finance:read'); return ok(request, asJson(await prisma.earningEntry.findMany({ orderBy: { createdAt: 'desc' }, take: 500 })), reply) })
app.get('/api/admin/payouts', async (request, reply) => { await requirePermission(request, 'finance:read'); return ok(request, asJson(await prisma.payout.findMany({ orderBy: { createdAt: 'desc' }, take: 500 })), reply) })
app.post('/api/admin/drivers/:driverId/restrict', async (request, reply) => { const auth = await requireRoles(request, ['ADMIN','SUPER_ADMIN']); const { driverId } = request.params as { driverId: string }; const driver = await prisma.driver.findUnique({ where: { id: driverId } }); if (!driver) throw notFound('Driver not found'); await prisma.$transaction(async (tx) => { await tx.user.update({ where: { id: driver.userId }, data: { accountStatus: 'SUSPENDED' } }); await tx.driver.update({ where: { id: driverId }, data: { onboardingStatus: 'SUSPENDED' } }); await tx.auditLog.create({ data: { actorId: auth.userId, actorRole: auth.role, action: 'DRIVER_SUSPENDED', entityType: 'Driver', entityId: driverId, requestId: request.id } }) }); return ok(request, { suspended: true }, reply) })
app.post('/api/admin/drivers/:driverId/reactivate', async (request, reply) => { const auth = await requireRoles(request, ['ADMIN','SUPER_ADMIN']); const { driverId } = request.params as { driverId: string }; const driver = await prisma.driver.findUnique({ where: { id: driverId } }); if (!driver) throw notFound('Driver not found'); transitionDriverOnboarding(driver.onboardingStatus, 'APPROVED'); await prisma.$transaction(async (tx) => { await tx.user.update({ where: { id: driver.userId }, data: { accountStatus: 'ACTIVE' } }); await tx.driver.update({ where: { id: driverId }, data: { onboardingStatus: 'APPROVED' } }); await tx.auditLog.create({ data: { actorId: auth.userId, actorRole: auth.role, action: 'DRIVER_REACTIVATED', entityType: 'Driver', entityId: driverId, requestId: request.id } }) }); return ok(request, { reactivated: true }, reply) })
app.get('/api/admin/displays/:displayId/commands', async (request, reply) => {
  await requirePermission(request, 'device:read')
  const { displayId } = request.params as { displayId: string }
  const display = await prisma.display.findUnique({ where: { id: displayId }, select: { id: true } })
  if (!display) throw notFound('Screen not found')
  const now = new Date()
  await prisma.displayCommand.updateMany({ where: { displayId, status: { in: ['QUEUED', 'DELIVERED'] }, expiresAt: { lte: now } }, data: { status: 'EXPIRED', failedAt: now, error: 'Command expired before acknowledgement' } })
  const commands = await prisma.displayCommand.findMany({ where: { displayId }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, displayId: true, commandType: true, status: true, createdAt: true, deliveredAt: true, acknowledgedAt: true, failedAt: true, cancelledAt: true, expiresAt: true, error: true } })
  return ok(request, asJson(commands.map(command => ({ ...command, error: safeCommandError(command.error) ?? null }))), reply)
})
app.post('/api/admin/displays/:displayId/commands', async (request, reply) => {
  const auth = await requirePermission(request, 'device:write')
  const { displayId } = request.params as { displayId: string }
  const input = bodyOf(request, z.object({ commandType: z.enum(['SYNC_MANIFEST', 'REFRESH_MANIFEST', 'HEALTH_CHECK', 'RESTART_PLAYER']), idempotencyKey: z.string().trim().min(8).max(200) }))
  const display = await prisma.display.findUnique({ where: { id: displayId } })
  if (!display || ['DELETED', 'DISABLED'].includes(display.state)) throw notFound('Screen not found')
  if (!display.deviceTokenHash || display.state === 'UNPAIRED') throw new ApiError('DISPLAY_UNPAIRED', 'Pair this screen before sending device commands', 409)
  const requested = { commandType: input.commandType, payload: null }
  const existing = await prisma.displayCommand.findUnique({ where: { displayId_idempotencyKey: { displayId, idempotencyKey: input.idempotencyKey } } })
  if (existing) {
    if (!sameIdempotentCommand(existing, requested)) throw new ApiError('COMMAND_IDEMPOTENCY_CONFLICT', 'Idempotency key was used for a different command', 409)
    return ok(request, existing, reply)
  }
  try {
    const command = await prisma.$transaction(async tx => {
      const created = await tx.displayCommand.create({ data: { displayId, idempotencyKey: input.idempotencyKey, commandType: input.commandType, expiresAt: commandExpiresAt() } })
      await tx.auditLog.create({ data: { actorId: auth.userId, actorRole: auth.role, action: 'DISPLAY_COMMAND_QUEUED', entityType: 'DisplayCommand', entityId: created.id, after: { commandType: input.commandType, idempotencyKey: input.idempotencyKey, expiresAt: created.expiresAt } as any, requestId: request.id } })
      return created
    })
    return ok(request, command, reply)
  } catch (error: any) {
    if (error?.code !== 'P2002') throw error
    const duplicate = await prisma.displayCommand.findUnique({ where: { displayId_idempotencyKey: { displayId, idempotencyKey: input.idempotencyKey } } })
    if (!duplicate || !sameIdempotentCommand(duplicate, requested)) throw new ApiError('COMMAND_IDEMPOTENCY_CONFLICT', 'Idempotency key was used for a different command', 409)
    return ok(request, duplicate, reply)
  }
})
app.post('/api/admin/displays/:displayId/commands/:commandId/cancel', async (request, reply) => {
  const auth = await requirePermission(request, 'device:write')
  const { displayId, commandId } = request.params as { displayId: string; commandId: string }
  const command = await prisma.displayCommand.findFirst({ where: { id: commandId, displayId } })
  if (!command) throw notFound('Command not found')
  if (command.status !== 'QUEUED') throw new ApiError('COMMAND_STATE_CONFLICT', 'Only commands not yet delivered to the screen can be cancelled', 409)
  const cancelled = await prisma.$transaction(async tx => {
    const updated = await tx.displayCommand.updateMany({ where: { id: commandId, displayId, status: 'QUEUED' }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
    if (updated.count !== 1) throw new ApiError('COMMAND_STATE_CONFLICT', 'Command was delivered before cancellation completed', 409)
    const saved = await tx.displayCommand.findUniqueOrThrow({ where: { id: commandId } })
    await tx.auditLog.create({ data: { actorId: auth.userId, actorRole: auth.role, action: 'DISPLAY_COMMAND_CANCELLED', entityType: 'DisplayCommand', entityId: commandId, before: { status: command.status } as any, after: { status: saved.status, cancelledAt: saved.cancelledAt } as any, requestId: request.id } })
    return saved
  })
  return ok(request, cancelled, reply)
})

registerOperations(app)
registerAdminManagement(app)
registerAssetRoutes(app)
registerNetworkOperations(app)

app.setErrorHandler((error, request, reply) => {
  const mongoFailure = isMongoError(error)
  const prismaCode = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined
  const databaseUnavailable = error instanceof Prisma.PrismaClientInitializationError || ['P1001', 'P1002'].includes(prismaCode ?? '')
  const databaseSchemaDrift = ['P2021', 'P2022'].includes(prismaCode ?? '')
  // Keep full request correlation inside server logs; do not expose raw SQL,
  // connection strings or Prisma's internal error text to browser clients.
  request.log.error({ err: error, prismaCode, requestId: request.id }, 'request failed')
  const status = error instanceof ApiError ? error.statusCode
    : error instanceof z.ZodError ? 422
    : ['P2034', 'P2002'].includes(prismaCode ?? '') ? 409
    : mongoFailure || databaseUnavailable || databaseSchemaDrift ? 503 : 500
  const code = error instanceof ApiError ? error.code
    : mongoFailure ? 'GUEST_STORE_UNAVAILABLE'
    : databaseUnavailable ? 'DATABASE_UNAVAILABLE'
    : databaseSchemaDrift ? 'DATABASE_SCHEMA_MISMATCH'
    : 'INTERNAL_ERROR'
  const message = error instanceof ApiError ? error.message
    : mongoFailure ? 'Order database unavailable'
    : databaseUnavailable ? 'Database temporarily unavailable. Contact support with the request ID.'
    : databaseSchemaDrift ? 'Database schema requires operator attention. Contact support with the request ID.'
    : status === 500 ? 'Internal server error'
    : error instanceof Error ? error.message : 'Request failed'
  reply.status(status).send({ data: null, error: { code, message }, requestId: request.id })
})

export { app }
