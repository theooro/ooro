import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminAuthError, requireAdminPermission } from "@/lib/auth/backend-session";
import { webPrisma } from "@/lib/web-prisma";

const inputSchema = z.object({
  durationSeconds: z.number().int().min(1).max(45).optional(),
  deliverySlot: z.enum(["MAIN", "SPONSORED"]).optional(),
}).strict().refine(value => value.durationSeconds !== undefined || value.deliverySlot !== undefined);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; creativeId: string }> }) {
  try {
    const admin = await requireAdminPermission("campaign:schedule");
    const { id: campaignId, creativeId } = await params;
    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: { message: "Choose a play length (10–45 seconds) or delivery placement." } }, { status: 422 });
    const result = await webPrisma.$transaction(async tx => {
      const creative = await tx.creative.findFirst({ where: { id: creativeId, campaignId, status: { not: "ARCHIVED" } }, include: { campaign: { select: { status: true, deliverySlot: true, assignments: { where: { active: true }, select: { displayId: true } } } } } });
      if (!creative || creative.campaign.status === "ARCHIVED") return { error: "CREATIVE_NOT_FOUND" as const };
      const slot = parsed.data.deliverySlot;
      if (slot === "SPONSORED" && creative.type.toUpperCase() !== "IMAGE") return { error: "SPONSORED_IMAGE_REQUIRED" as const };
      if (parsed.data.durationSeconds !== undefined && creative.type.toUpperCase() === "VIDEO") return { error: "VIDEO_DURATION_FIXED" as const };
      const updated = await tx.creative.update({ where: { id: creativeId }, data: { durationSeconds: parsed.data.durationSeconds, deliverySlot: slot } });
      const displayIds = creative.campaign.assignments.map(item => item.displayId);
      if (displayIds.length) await tx.displayCommand.createMany({ data: displayIds.map(displayId => ({ displayId, commandType: "REFRESH_MANIFEST", expiresAt: null })) });
      await tx.auditLog.create({ data: { actorId: admin.userId, actorRole: admin.role, action: "CAMPAIGN_CREATIVE_DELIVERY_UPDATED", entityType: "Creative", entityId: creativeId, before: { durationSeconds: creative.durationSeconds, deliverySlot: creative.deliverySlot ?? creative.campaign.deliverySlot }, after: { durationSeconds: updated.durationSeconds, deliverySlot: updated.deliverySlot, manifestRefreshQueued: displayIds.length } } });
      return { creativeId, durationSeconds: updated.durationSeconds, deliverySlot: updated.deliverySlot ?? creative.campaign.deliverySlot, manifestRefreshQueued: displayIds.length };
    }, { isolationLevel: "Serializable" });
    if ("error" in result) return NextResponse.json({ error: { code: result.error, message: result.error === "VIDEO_DURATION_FIXED" ? "Video duration is fixed to the verified file duration and cannot exceed 45 seconds." : "Choose an available creative; sponsored placement accepts images only." } }, { status: 422 });
    return NextResponse.json({ data: result });
  } catch (error) {
    const status = error instanceof AdminAuthError ? error.status : 503;
    return NextResponse.json({ error: { message: error instanceof AdminAuthError ? "Campaign scheduling permission is required." : "Creative settings could not be saved." } }, { status });
  }
}
