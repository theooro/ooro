import { NextResponse } from "next/server";
import { requireAdminPermission, AdminAuthError } from "@/lib/auth/backend-session";
import { webPrisma } from "@/lib/web-prisma";
import { safeDestination } from "@/apps/api/src/domain/qr-destination";

const safe = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? Number(item) : item));

export async function GET() {
  try {
    // One shared review queue for ADMIN and SUPER_ADMIN. Other staff roles do
    // not need access to submitted files or submitter contact details.
    await requireAdminPermission("creative:write");
    const [creatives, submissions] = await Promise.all([
      webPrisma.creative.findMany({ where: { status: { not: "ARCHIVED" }, campaign: { status: { not: "ARCHIVED" } } }, include: { asset: true, campaign: { select: { id: true, name: true, status: true } } }, orderBy: { displayOrder: "asc" } }),
      webPrisma.creativeSubmission.findMany({ where: { status: { not: "ARCHIVED" } }, include: { organization: { select: { id: true, name: true, type: true } }, scheduledCreative: { include: { campaign: { select: { id: true, name: true, status: true } } } } }, orderBy: { createdAt: "desc" } }),
    ]);
    const standalone = submissions.map(item => ({
      id: item.id, kind: "SUBMISSION", name: item.fileName, type: item.type, status: item.status,
      brandName: null, promotionalText: null, qrEnabled: false, qrTargetUrl: null, qrLabel: null, qrVersion: 0,
      campaign: item.scheduledCreative?.campaign ?? null, submissionOrganization: item.organization, submittedByEmail: item.submitterEmail,
      scheduledCreativeId: item.scheduledCreativeId,
      createdAt: item.createdAt, reviewedAt: item.reviewedAt,
      asset: { url: item.url, mimeType: item.mimeType, width: item.width, height: item.height, durationSeconds: item.durationSeconds, checksum: item.checksum, sizeBytes: item.sizeBytes },
    }));
    return NextResponse.json({ data: safe([...standalone, ...creatives.map(item => ({ ...item, kind: "CAMPAIGN_CREATIVE" }))]) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof AdminAuthError ? "Creative review access required" : "Creative library unavailable" } }, { status: error instanceof AdminAuthError ? error.status : 503, headers: { "cache-control": "no-store" } });
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await requireAdminPermission("creative:write");
    const body = await request.json().catch(() => null) as { creativeId?: string } | null;
    const creativeId = body?.creativeId?.trim();
    if (!creativeId) return NextResponse.json({ error: { message: "Creative id is required." } }, { status: 422 });
    const previous = await webPrisma.creative.findUnique({ where: { id: creativeId }, include: { campaign: { select: { status: true } } } });
    if (!previous || previous.status === "ARCHIVED") return NextResponse.json({ error: { message: "Creative not found." } }, { status: 404 });
    const result = await webPrisma.$transaction(async tx => {
      const archived = await tx.creative.update({ where: { id: creativeId }, data: { status: "ARCHIVED" } });
      const targets = await tx.displayCampaignAssignment.findMany({ where: { campaignId: previous.campaignId, active: true }, select: { displayId: true } });
      await tx.displayCommand.createMany({ data: targets.map(target => ({ displayId: target.displayId, commandType: "REFRESH_MANIFEST", expiresAt: null })) });
      await tx.auditLog.create({ data: { actorId: admin.userId, actorRole: admin.role, action: "CREATIVE_ARCHIVED", entityType: "Creative", entityId: creativeId, before: { status: previous.status }, after: { status: "ARCHIVED", manifestRefreshQueued: targets.length } } });
      return { archived, manifestRefreshQueued: targets.length };
    });
    return NextResponse.json({ data: { id: result.archived.id, status: result.archived.status, manifestRefreshQueued: result.manifestRefreshQueued } });
  } catch (error) {
    const status = error instanceof AdminAuthError ? error.status : 503;
    return NextResponse.json({ error: { message: error instanceof AdminAuthError ? "Admin access required" : "Creative could not be removed. Please retry." } }, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdminPermission("creative:write");
    const body = await request.json() as { creativeId?: string; submissionId?: string; status?: string; brandName?: string | null; promotionalText?: string | null; qrEnabled?: boolean; qrTargetUrl?: string | null; qrLabel?: string | null };
    if (!body.creativeId && !body.submissionId) return NextResponse.json({ error: { message: "Creative id is required." } }, { status: 422 });
    if (body.brandName != null && body.brandName.trim().length > 120) return NextResponse.json({ error: { message: "Brand name must be 120 characters or fewer." } }, { status: 422 });
    if (body.promotionalText != null && body.promotionalText.trim().length > 120) return NextResponse.json({ error: { message: "Promotional text must be 120 characters or fewer." } }, { status: 422 });
    if (body.status !== undefined && !["APPROVED", "REJECTED", "ARCHIVED", "PENDING_REVIEW"].includes(body.status)) return NextResponse.json({ error: { message: "Select a valid review status." } }, { status: 422 });

    if (body.submissionId) {
      if (!body.status || !["APPROVED", "REJECTED", "PENDING_REVIEW"].includes(body.status)) return NextResponse.json({ error: { message: "Choose a valid submission review status." } }, { status: 422 });
      const previous = await webPrisma.creativeSubmission.findUnique({ where: { id: body.submissionId } });
      if (!previous || previous.status === "ARCHIVED") return NextResponse.json({ error: { message: "Creative submission not found." } }, { status: 404 });
      if (previous.scheduledCreativeId) return NextResponse.json({ error: { code: "CREATIVE_SUBMISSION_ALREADY_SCHEDULED", message: "This approved submission is already attached to a campaign. Manage its campaign creative to change delivery." } }, { status: 409 });
      const reviewedAt = body.status === "PENDING_REVIEW" ? null : new Date();
      const submission = await webPrisma.$transaction(async tx => {
        const changed = await tx.creativeSubmission.updateMany({ where: { id: previous.id, status: previous.status, scheduledCreativeId: null }, data: { status: body.status!, reviewerId: admin.userId, reviewerRole: admin.role, reviewedAt } });
        if (changed.count !== 1) throw new Error("Submission changed while it was being reviewed.");
        const updated = await tx.creativeSubmission.findUniqueOrThrow({ where: { id: previous.id } });
        await tx.auditLog.create({ data: { actorId: admin.userId, actorRole: admin.role, action: "CREATIVE_SUBMISSION_REVIEWED", entityType: "CreativeSubmission", entityId: previous.id, before: { status: previous.status }, after: { status: body.status } } });
        return updated;
      });
      return NextResponse.json({ data: safe({ id: submission.id, status: submission.status, campaignId: null, scheduled: false, playbackEligible: false }) });
    }

    if (body.qrEnabled && !body.qrTargetUrl?.trim()) return NextResponse.json({ error: { message: "A QR destination is required when QR is enabled." } }, { status: 422 });
    if (body.qrTargetUrl && !safeDestination(body.qrTargetUrl, false)) return NextResponse.json({ error: { message: "QR destination must be HTTPS." } }, { status: 422 });
    const creative = await webPrisma.$transaction(async tx => {
      const previous = await tx.creative.findUniqueOrThrow({ where: { id: body.creativeId! } });
      const metadataChanged = body.brandName !== undefined || body.promotionalText !== undefined;
      const updated = await tx.creative.update({ where: { id: body.creativeId! }, data: {
        status: body.status,
        ...(metadataChanged ? { brandName: body.brandName?.trim() || null, promotionalText: body.promotionalText?.trim() || null } : {}),
        ...(body.qrEnabled === undefined ? {} : { qrEnabled: body.qrEnabled, qrTargetUrl: body.qrTargetUrl?.trim() || null, qrLabel: body.qrLabel?.trim() || null, qrVersion: { increment: 1 } }),
      } });
      const targets = await tx.displayCampaignAssignment.findMany({ where: { campaignId: previous.campaignId, active: true } });
      await tx.displayCommand.createMany({ data: targets.map(target => ({ displayId: target.displayId, commandType: "REFRESH_MANIFEST" as const, expiresAt: null })) });
      await tx.auditLog.create({ data: { actorId: admin.userId, actorRole: admin.role, action: body.qrEnabled !== undefined ? "CREATIVE_QR_UPDATED" : metadataChanged ? "CREATIVE_PROMOTION_UPDATED" : "CREATIVE_REVIEWED", entityType: "Creative", entityId: previous.id, before: { status: previous.status }, after: { status: body.status } } });
      return updated;
    });
    return NextResponse.json({ data: safe(creative) });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof AdminAuthError ? "Admin access required" : "Creative could not be updated" } }, { status: error instanceof AdminAuthError ? error.status : 503 });
  }
}
