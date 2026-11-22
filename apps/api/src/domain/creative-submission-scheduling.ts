import type { Prisma } from '@prisma/client'

export function creativeSubmissionSchedulingPermission(status: string, scheduledCreativeId: string | null | undefined) {
  if (status === 'ARCHIVED') return { allowed: false, code: 'CREATIVE_SUBMISSION_ARCHIVED' }
  if (status !== 'APPROVED') return { allowed: false, code: 'CREATIVE_SUBMISSION_NOT_APPROVED' }
  if (scheduledCreativeId) return { allowed: false, code: 'CREATIVE_SUBMISSION_ALREADY_SCHEDULED' }
  return { allowed: true, code: 'CREATIVE_SUBMISSION_READY_TO_SCHEDULE' }
}

type Tx = Prisma.TransactionClient
type AdminActor = { userId: string; role: string }

export async function addApprovedSubmissionToCampaign(tx: Tx, input: { submissionId: string; campaignId: string; admin: AdminActor }) {
  const submission = await tx.creativeSubmission.findUnique({ where: { id: input.submissionId } })
  if (!submission) return { ok: false as const, code: 'CREATIVE_SUBMISSION_NOT_FOUND', statusCode: 404, message: 'Creative submission is unavailable.' }
  const permission = creativeSubmissionSchedulingPermission(submission.status, submission.scheduledCreativeId)
  if (!permission.allowed) return { ok: false as const, code: permission.code, statusCode: permission.code === 'CREATIVE_SUBMISSION_ARCHIVED' ? 404 : 409, message: permission.code === 'CREATIVE_SUBMISSION_ARCHIVED' ? 'Creative submission is unavailable.' : permission.code === 'CREATIVE_SUBMISSION_ALREADY_SCHEDULED' ? 'This submission has already been added to a campaign.' : 'Only approved submissions can be added to a campaign.' }
  const campaign = await tx.campaign.findUnique({ where: { id: input.campaignId }, select: { id: true, name: true, status: true, creatives: { where: { status: { not: 'ARCHIVED' } }, select: { displayOrder: true } } } })
  if (!campaign || campaign.status === 'ARCHIVED') return { ok: false as const, code: 'CAMPAIGN_UNAVAILABLE', statusCode: 404, message: 'Choose an available campaign.' }
  const creative = await tx.creative.create({ data: { campaignId: campaign.id, name: submission.fileName, type: submission.type, status: 'APPROVED', durationSeconds: submission.durationSeconds ?? 10, displayOrder: campaign.creatives.reduce((max, item) => Math.max(max, item.displayOrder), -1) + 1, asset: { create: { fileName: submission.fileName, storageKey: submission.storageKey, url: submission.url, checksum: submission.checksum, mimeType: submission.mimeType, sizeBytes: submission.sizeBytes, width: submission.width, height: submission.height, durationSeconds: submission.durationSeconds } } } })
  const linked = await tx.creativeSubmission.updateMany({ where: { id: submission.id, status: 'APPROVED', scheduledCreativeId: null }, data: { scheduledCreativeId: creative.id } })
  if (linked.count !== 1) throw new Error('Submission changed while it was being scheduled.')
  await tx.auditLog.create({ data: { actorId: input.admin.userId, actorRole: input.admin.role, action: 'CREATIVE_SUBMISSION_ADDED_TO_CAMPAIGN', entityType: 'CreativeSubmission', entityId: submission.id, before: { status: submission.status, campaignId: null }, after: { status: submission.status, campaignId: campaign.id, creativeId: creative.id, campaignStatus: campaign.status } } })
  return { ok: true as const, creativeId: creative.id, campaignId: campaign.id, campaignName: campaign.name, status: 'APPROVED' as const, campaignDeliveryRulesApply: true as const }
}
