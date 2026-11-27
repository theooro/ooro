import { canAdmin } from "@/apps/api/src/domain/admin-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { AdminAuthError, getAuthenticatedAdmin, requireAdminPermission } from "@/lib/auth/backend-session";
import { webPrisma } from "@/lib/web-prisma";
import { withoutCampaignDeliveryDates } from "@/lib/campaign-delivery-presentation";
import { safeDestination } from "@/apps/api/src/domain/qr-destination";
import { getDisplayConnectivity } from "@/apps/api/src/domain/display-health";
import { campaignDateInTimezone, campaignDateWindow, DEFAULT_CAMPAIGN_TIMEZONE } from "@/apps/api/src/domain/campaign-date-window";
import { THREE_ZONE_AD_SPONSOR_QR_V1 } from "@/apps/api/src/domain/presentation-layout";

export const dynamic = "force-dynamic";
const offerSchema = z.object({ brandName: z.string().trim().max(120).optional(), offerTitle: z.string().trim().max(160).optional(), offerSubtitle: z.string().trim().max(240).optional(), offerValue: z.string().trim().max(120).optional(), ctaType: z.string().trim().max(40).optional(), ctaLabel: z.string().trim().max(80).optional(), ctaUrl: z.string().trim().max(2048).optional() }).strict();
const updateSchema = z.object({ status: z.enum(["DRAFT", "APPROVED", "REJECTED", "ACTIVE", "PAUSED", "STOPPED", "COMPLETED"]).optional(), deliverySlot: z.enum(["MAIN", "SPONSORED"]).optional(), layout: z.enum(["FULLSCREEN_AD", "FOUR_ZONE", "FOUR_ZONE_V3", "SPLIT_50_25_25", THREE_ZONE_AD_SPONSOR_QR_V1]).nullable().optional(), screenIds: z.array(z.string().uuid()).max(1000).optional(), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), timezone: z.literal(DEFAULT_CAMPAIGN_TIMEZONE).optional(), offer: offerSchema.optional() }).strict();
const safe = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? Number(item) : item));
function errorResponse(error: unknown) { const status = error instanceof AdminAuthError ? error.status : 500; return NextResponse.json({ error: { message: status === 500 ? "Admin campaign service unavailable" : "Admin access required" } }, { status }); }
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!canAdmin(admin.role, "campaign:read")) throw new AdminAuthError("ADMIN_ACCESS_DENIED", 403);
    const { id } = await params;
    const campaign = await webPrisma.campaign.findUnique({
      where: { id },
      include: {
        creatives: { include: { asset: true }, orderBy: { displayOrder: "asc" } },
        assignments: {
          where: { active: true },
          include: {
            display: {
              select: {
                id: true, name: true, state: true, manifestVersion: true, lastHeartbeatAt: true,
                currentCampaignId: true, currentCreativeId: true, currentPlaybackState: true, currentPlaybackStartedAt: true,
                commands: { where: { commandType: { in: ["SYNC_MANIFEST", "REFRESH_MANIFEST"] }, payload: { path: ["campaignId"], equals: id } }, orderBy: { createdAt: "desc" }, take: 1, select: { status: true, createdAt: true, deliveredAt: true, acknowledgedAt: true, error: true } },
                proofs: { where: { campaignId: id }, orderBy: { playbackStartedAt: "desc" }, take: 1, select: { creativeId: true, playbackStartedAt: true, playbackEndedAt: true, actualDuration: true, playbackCompleted: true, status: true } },
              },
            },
          },
        },
      },
    });
    if (!campaign) return NextResponse.json({ error: { message: "Campaign not found" } }, { status: 404 });
    const [completedPlays, qrScans] = await Promise.all([
      webPrisma.proofOfPlay.count({ where: { campaignId: id, playbackCompleted: true } }),
      webPrisma.qrScan.count({ where: { campaignId: id } }),
    ]);
    const assignments = campaign.assignments.map(assignment => ({ ...assignment, display: { ...assignment.display, connectivity: getDisplayConnectivity(assignment.display.lastHeartbeatAt ?? undefined) } }));
    const campaignPublic = withoutCampaignDeliveryDates(campaign);
    const timezone = DEFAULT_CAMPAIGN_TIMEZONE;
    return NextResponse.json({ data: safe({ ...campaignPublic, startDate: campaignDateInTimezone(campaign.startsAt, timezone), endDate: campaign.endsAt ? campaignDateInTimezone(new Date(campaign.endsAt.getTime() - 1), timezone) : null, timezone, assignments, analytics: { completedPlays, qrScans, scanRate: completedPlays === 0 ? null : (qrScans / completedPlays) * 100 } }) });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdminPermission("campaign:update"); const { id } = await params; const parsed = updateSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: { message: "Invalid campaign update." } }, { status: 422 }); const input = parsed.data;
    if (input.status === "APPROVED" || input.status === "REJECTED") await requireAdminPermission("campaign:approve");
    if (["ACTIVE", "PAUSED", "STOPPED", "COMPLETED"].includes(input.status ?? "")) await requireAdminPermission("campaign:schedule");
    if (input.deliverySlot) await requireAdminPermission("campaign:schedule");
    const campaign = await webPrisma.campaign.findUnique({ where: { id }, include: { creatives: { where: { status: "APPROVED" }, select: { type: true, asset: { select: { active: true, url: true, checksum: true } } } } } }); if (!campaign) return NextResponse.json({ error: { message: "Campaign not found" } }, { status: 404 }); if (campaign.status === "ARCHIVED") return NextResponse.json({ error: { code: "CAMPAIGN_ARCHIVED", message: "Archived campaigns are read-only." } }, { status: 409 });
    const deliverySlot = input.deliverySlot ?? campaign.deliverySlot;
    const timezone = DEFAULT_CAMPAIGN_TIMEZONE;
    const startDate = input.startDate ?? campaignDateInTimezone(campaign.startsAt, timezone);
    const endDate = input.endDate ?? (campaign.endsAt ? campaignDateInTimezone(new Date(campaign.endsAt.getTime() - 1), timezone) : null);
    let dateWindow: ReturnType<typeof campaignDateWindow> | null = null;
    if (startDate && endDate) {
      try { dateWindow = campaignDateWindow(startDate, endDate, timezone); }
      catch (error) { return NextResponse.json({ error: { code: error instanceof Error ? error.message : "CAMPAIGN_DATE_INVALID", message: "Choose valid inclusive campaign dates and a valid timezone." } }, { status: 422 }); }
    } else if (input.startDate || input.endDate || input.status === "ACTIVE") {
      return NextResponse.json({ error: { code: "CAMPAIGN_DATE_RANGE_REQUIRED", message: "Set both a start date and an end date before activating a campaign." } }, { status: 422 });
    }
    if (deliverySlot === "SPONSORED" && (!campaign.creatives.length || campaign.creatives.some(creative => creative.type.toUpperCase() !== "IMAGE"))) return NextResponse.json({ error: { code: "SPONSOR_IMAGE_REQUIRED", message: "A sponsored slot requires an approved image creative; video is not supported in this fixed slot." } }, { status: 422 });
    const hasDeliverableCreative = campaign.creatives.some(creative => creative.asset?.active && Boolean(creative.asset.url) && /^[a-f0-9]{64}$/i.test(creative.asset.checksum ?? ""));
    if (input.status === "ACTIVE") { if (!(["APPROVED", "ACTIVE", "PAUSED"].includes(campaign.status))) return NextResponse.json({error:{code:"CAMPAIGN_APPROVAL_REQUIRED",message:"Only an approved campaign can enter delivery."}},{status:409}); if (!hasDeliverableCreative) return NextResponse.json({error:{code:"APPROVED_CREATIVE_REQUIRED",message:"An approved creative with an active, checksummed asset is required before delivery."}},{status:409}); if (!["INTERNAL_TEST", "PAID", "FUNDED"].includes(campaign.commercialFundingStatus)) return NextResponse.json({error:{code:"CAMPAIGN_PAYMENT_REQUIRED",message:"Campaign funding must be verified before delivery."}},{status:409}); }
    const current = (campaign.metadata && typeof campaign.metadata === "object" ? campaign.metadata : {}) as Record<string, unknown>; const requestedScreenIds = input.screenIds ? [...new Set(input.screenIds)] : undefined;
    if (input.offer?.ctaUrl && !safeDestination(input.offer.ctaUrl, false)) return NextResponse.json({ error: { code: "UNSAFE_QR_DESTINATION", message: "QR destination must use HTTPS." } }, { status: 422 });
    const nextMetadata: Record<string, unknown> = { ...current, offer: input.offer ?? current.offer ?? {}, deliveryTarget: { mode: "MANUAL_SCREENS" } };
    if (input.layout !== undefined) {
      if (input.layout === null) delete nextMetadata.presentationLayout;
      else nextMetadata.presentationLayout = input.layout;
    }
    const metadata = nextMetadata as Prisma.InputJsonValue;
    if (requestedScreenIds) { const eligibleDisplays = await webPrisma.display.count({ where: { id: { in: requestedScreenIds }, state: { notIn: ["DISABLED", "BLOCKED", "MAINTENANCE", "UNPAIRED", "DELETED"] } } }); if (eligibleDisplays !== requestedScreenIds.length) return NextResponse.json({ error: { code: "DISPLAY_NOT_ELIGIBLE", message: "One or more selected screens are unavailable." } }, { status: 422 }); }
    const existingAssignments = await webPrisma.displayCampaignAssignment.findMany({ where: { campaignId: id, active: true }, select: { displayId: true } }); const targetDisplayIds = requestedScreenIds ?? existingAssignments.map(item => item.displayId); const commandIds = [...new Set(targetDisplayIds)];
    if (input.status === "ACTIVE") {
      if (!commandIds.length) return NextResponse.json({ error: { code: "DELIVERY_TARGET_REQUIRED", message: "Assign at least one compatible screen before activating delivery." } }, { status: 422 });
      const compatibleTargets = await webPrisma.display.count({ where: { id: { in: commandIds }, state: { notIn: ["DISABLED", "BLOCKED", "MAINTENANCE", "UNPAIRED", "DELETED"] }, supportsDeliveryQuota: true } });
      if (compatibleTargets !== commandIds.length) return NextResponse.json({ error: { code: "PLAYER_AUTHORIZATION_SUPPORT_REQUIRED", message: "Every selected screen must run a player that supports authenticated campaign grants." } }, { status: 409 });
    }
    const updated = await webPrisma.$transaction(async tx => { if (requestedScreenIds) { await tx.displayCampaignAssignment.updateMany({ where: { campaignId: id }, data: { active: false } }); const existing = await tx.displayCampaignAssignment.findMany({ where: { campaignId: id, displayId: { in: requestedScreenIds } }, select: { id: true, displayId: true } }); const existingByDisplay = new Map(existing.map(item => [item.displayId, item.id])); for (const displayId of requestedScreenIds) { const assignmentId = existingByDisplay.get(displayId); const grant = { offlinePlaysAuthorized: null, unlimitedOfflineAuthorized: true, offlineQuotaRevision: { increment: 1 } }; if (assignmentId) await tx.displayCampaignAssignment.update({ where: { id: assignmentId }, data: { active: true, ...grant } }); else await tx.displayCampaignAssignment.create({ data: { campaignId: id, displayId, active: true, offlinePlaysAuthorized: null, offlinePlaysConsumed: 0, unlimitedOfflineAuthorized: true } }); } } else if (input.status === "ACTIVE") { await tx.displayCampaignAssignment.updateMany({ where: { campaignId: id, active: true }, data: { offlinePlaysAuthorized: null, unlimitedOfflineAuthorized: true, offlineQuotaRevision: { increment: 1 } } }); } const result = await tx.campaign.update({ where: { id }, data: { deliverySlot, status: input.status, ...(input.layout === undefined ? {} : { layout: input.layout ?? "FOUR_ZONE" }), startsAt: dateWindow?.startsAt, endsAt: dateWindow?.endsAt, timezone: dateWindow ? timezone : undefined, campaignCenterLat: null, campaignCenterLng: null, radiusKm: null, offlinePlaysPerDisplay: null, unlimitedOfflineDelivery: true, metadata } }); if (commandIds.length) { await tx.displayCommand.createMany({ data: commandIds.map(displayId => ({ displayId, commandType: "SYNC_MANIFEST", payload: { campaignId: id, status: input.status }, expiresAt: null })) }); } await tx.auditLog.create({ data: { actorId: admin.userId, actorRole: admin.role, action: input.layout !== undefined ? "CAMPAIGN_LAYOUT_UPDATED" : input.deliverySlot ? "CAMPAIGN_DELIVERY_SLOT_UPDATED" : input.status === "PAUSED" || input.status === "STOPPED" ? "CAMPAIGN_PAUSED" : input.status === "APPROVED" ? "CAMPAIGN_APPROVED" : input.status === "COMPLETED" ? "CAMPAIGN_ENDED" : requestedScreenIds ? "SCREENS_ASSIGNED" : "CAMPAIGN_UPDATED", entityType: "Campaign", entityId: id, before: { status: campaign.status, deliverySlot: campaign.deliverySlot, layout: campaign.layout, startsAt: campaign.startsAt, endsAt: campaign.endsAt, timezone: campaign.timezone }, after: { status: input.status, deliverySlot, layout: input.layout ?? (current.presentationLayout as string | undefined) ?? "SCREEN_ASSIGNED", startDate, endDate, timezone, screenCount: commandIds.length, deliveryPolicy: "UNMETERED_CACHED_PLAYBACK" } } }); return result; });
    return NextResponse.json({ data: safe({ ...withoutCampaignDeliveryDates(updated), startDate, endDate, timezone, syncRequested: commandIds.length, commandType: commandIds.length && input.status ? "SYNC_MANIFEST" : null }) });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdminPermission("campaign:update");
    const { id } = await params;
    const campaign = await webPrisma.campaign.findUnique({ where: { id } });
    if (!campaign) return NextResponse.json({ error: { message: "Campaign not found." } }, { status: 404 });
    if (campaign.status === "ARCHIVED") return NextResponse.json({ data: { id, status: "ARCHIVED", alreadyArchived: true } });
    const result = await webPrisma.$transaction(async tx => {
      const assignments = await tx.displayCampaignAssignment.findMany({ where: { campaignId: id, active: true }, select: { displayId: true } });
      await tx.displayCampaignAssignment.updateMany({ where: { campaignId: id }, data: { active: false } });
      await tx.displayCommand.createMany({ data: assignments.map(({ displayId }) => ({ displayId, commandType: "SYNC_MANIFEST", payload: { campaignId: id, status: "ARCHIVED" }, expiresAt: null })) });
      const archived = await tx.campaign.update({ where: { id }, data: { status: "ARCHIVED" } });
      await tx.auditLog.create({ data: { actorId: admin.userId, actorRole: admin.role, action: "CAMPAIGN_ARCHIVED", entityType: "Campaign", entityId: id, before: { status: campaign.status }, after: { status: "ARCHIVED", activeScreens: assignments.length, historicalSchedulesPreserved: true } } });
      return archived;
    });
    return NextResponse.json({ data: { id: result.id, status: result.status, activeScreens: 0 } });
  } catch (error) {
    const status = error instanceof AdminAuthError ? error.status : 503;
    const message = error instanceof AdminAuthError
      ? status === 401 ? "Your admin session expired. Sign in again and retry." : status === 403 ? "Your account does not have permission to manage campaigns." : "Admin authentication is temporarily unavailable. Retry shortly."
      : "Campaign could not be removed. Please retry.";
    return NextResponse.json({ error: { message } }, { status });
  }
}
