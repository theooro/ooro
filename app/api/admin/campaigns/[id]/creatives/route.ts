import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminPermission, AdminAuthError } from "@/lib/auth/backend-session";
import { webPrisma } from "@/lib/web-prisma";

const inputSchema = z.object({ creativeIds: z.array(z.string().uuid()).min(1).max(24) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdminPermission("campaign:schedule");
    const { id: campaignId } = await params;
    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: { message: "Select at least one approved library creative." } }, { status: 422 });
    const creativeIds = [...new Set(parsed.data.creativeIds)];
    if (creativeIds.length !== parsed.data.creativeIds.length) return NextResponse.json({ error: { message: "A creative can only be selected once." } }, { status: 422 });
    const result = await webPrisma.$transaction(async tx => {
      const campaign = await tx.campaign.findUnique({ where: { id: campaignId }, include: { creatives: { include: { asset: true }, orderBy: { displayOrder: "desc" }, take: 1 }, assignments: { where: { active: true }, select: { displayId: true } } } });
      if (!campaign || campaign.status === "ARCHIVED") return { error: "CAMPAIGN_UNAVAILABLE" as const };
      const sources = await tx.creative.findMany({ where: { id: { in: creativeIds }, status: "APPROVED" }, include: { asset: true } });
      if (sources.length !== creativeIds.length || sources.some(item => !item.asset?.active || !item.asset.url || !/^[a-f0-9]{64}$/i.test(item.asset.checksum ?? ""))) return { error: "APPROVED_VERIFIED_CREATIVE_REQUIRED" as const };
      sources.sort((a, b) => creativeIds.indexOf(a.id) - creativeIds.indexOf(b.id));
      const current = await tx.creative.findMany({ where: { campaignId, status: { not: "ARCHIVED" } }, select: { displayOrder: true, asset: { select: { storageKey: true } } } });
      const existingKeys = new Set(current.map(item => item.asset?.storageKey).filter(Boolean));
      if (sources.some(item => existingKeys.has(item.asset!.storageKey))) return { error: "CREATIVE_ALREADY_ATTACHED" as const };
      let displayOrder = Math.max(-1, ...current.map(item => item.displayOrder));
      const attached = [];
      for (const source of sources) {
        displayOrder += 1;
        const clone = await tx.creative.create({ data: {
          campaignId, name: source.name, type: source.type, status: "APPROVED",
          durationSeconds: source.durationSeconds, displayOrder, brandName: source.brandName,
          promotionalText: source.promotionalText, qrEnabled: source.qrEnabled,
          qrTargetUrl: source.qrTargetUrl, qrLabel: source.qrLabel, qrVersion: source.qrVersion,
          asset: { create: { fileName: source.asset!.fileName, storageKey: source.asset!.storageKey, url: source.asset!.url, checksum: source.asset!.checksum, mimeType: source.asset!.mimeType, sizeBytes: source.asset!.sizeBytes, width: source.asset!.width, height: source.asset!.height, durationSeconds: source.asset!.durationSeconds, active: true } },
        } });
        attached.push({ sourceCreativeId: source.id, creativeId: clone.id });
      }
      const displayIds = campaign.assignments.map(item => item.displayId);
      if (displayIds.length) await tx.displayCommand.createMany({ data: displayIds.map(displayId => ({ displayId, commandType: "REFRESH_MANIFEST", expiresAt: null })) });
      await tx.auditLog.create({ data: { actorId: admin.userId, actorRole: admin.role, action: "CAMPAIGN_LIBRARY_CREATIVES_ATTACHED", entityType: "Campaign", entityId: campaignId, after: { attached, manifestRefreshQueued: displayIds.length } } });
      return { attached, manifestRefreshQueued: displayIds.length };
    }, { isolationLevel: "Serializable" });
    if ("error" in result && result.error) {
      const messages: Record<string, [number, string]> = {
        CAMPAIGN_UNAVAILABLE: [404, "Choose an available campaign."],
        APPROVED_VERIFIED_CREATIVE_REQUIRED: [422, "Only approved creatives with verified active assets can be added."],
        CREATIVE_ALREADY_ATTACHED: [409, "One or more selected assets are already in this campaign."],
      };
      const [status, message] = messages[result.error] ?? [409, "The selected library creatives could not be attached."];
      return NextResponse.json({ error: { code: result.error, message } }, { status });
    }
    return NextResponse.json({ data: { ...result, campaignId, campaignDeliveryRulesApply: true } }, { status: 201 });
  } catch (error) {
    const status = error instanceof AdminAuthError ? error.status : 503;
    return NextResponse.json({ error: { message: error instanceof AdminAuthError ? "Campaign scheduling permission is required." : "Library creatives could not be added." } }, { status });
  }
}
