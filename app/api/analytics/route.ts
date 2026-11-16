import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { webPrisma } from "@/lib/web-prisma";
import { webContext, webOwnerEmail } from "@/lib/web-owner";
import { advertiserCampaignScope } from "@/lib/advertiser-campaign-scope";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await webContext();
  const ownerEmail = context?.email ?? await webOwnerEmail();
  if (!ownerEmail) return NextResponse.json({ error: { message: "Sign in to view analytics" } }, { status: 401 });

  try {
    if (context && context.account.accountType === "BRAND") {
      if (context.organization?.type !== "BRAND" || context.organization.verificationStatus !== "VERIFIED") {
        return NextResponse.json({ error: { code: "BRAND_VERIFICATION_REQUIRED", message: "Brand analytics are available after organisation verification." } }, { status: 403 });
      }
    }

    // Campaigns and all playback joins are restricted to this account or its verified brand.
    const campaignWhere: Prisma.CampaignWhereInput = context ? await advertiserCampaignScope(context) : { ownerEmail };
    const campaigns = await webPrisma.campaign.findMany({
      where: campaignWhere,
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, status: true, creatives: { select: { id: true, name: true, status: true, brandName: true } } },
    });
    const campaignIds = campaigns.map(campaign => campaign.id);
    const [verifiedProofs, completedProofs, scans] = campaignIds.length ? await Promise.all([
      webPrisma.proofOfPlay.groupBy({ by: ["campaignId", "creativeId"], where: { campaignId: { in: campaignIds }, creativeId: { not: null }, status: "VERIFIED" }, _count: { _all: true } }),
      webPrisma.proofOfPlay.groupBy({ by: ["campaignId", "creativeId"], where: { campaignId: { in: campaignIds }, creativeId: { not: null }, playbackCompleted: true }, _count: { _all: true } }),
      webPrisma.qrScan.groupBy({ by: ["campaignId", "creativeId"], where: { campaignId: { in: campaignIds } }, _count: { _all: true } }),
    ]) : [[], [], []];

    const key = (campaignId: string, creativeId: string) => `${campaignId}:${creativeId}`;
    const countMap = (rows: Array<{ campaignId: string | null; creativeId: string | null; _count: { _all: number } }>) => new Map(rows.flatMap(row => row.campaignId && row.creativeId ? [[key(row.campaignId, row.creativeId), row._count._all] as const] : []));
    const verifiedByCreative = countMap(verifiedProofs);
    const completedByCreative = countMap(completedProofs);
    const scansByCreative = countMap(scans);
    const rows = campaigns.map(campaign => {
      const creatives = campaign.creatives.map(creative => ({
        id: creative.id,
        name: creative.name,
        brandName: creative.brandName,
        status: creative.status,
        verifiedPlays: verifiedByCreative.get(key(campaign.id, creative.id)) ?? 0,
        completedPlays: completedByCreative.get(key(campaign.id, creative.id)) ?? 0,
        qrScans: scansByCreative.get(key(campaign.id, creative.id)) ?? 0,
      }));
      return { id: campaign.id, name: campaign.name, status: campaign.status, creativeCount: creatives.length, verifiedPlays: creatives.reduce((sum, creative) => sum + creative.verifiedPlays, 0), creatives };
    });
    const creativeRows = rows.flatMap(campaign => campaign.creatives);
    return NextResponse.json({ data: {
      campaigns: rows,
      summary: {
        campaigns: rows.length,
        creatives: creativeRows.length,
        verifiedPlays: creativeRows.reduce((sum, creative) => sum + creative.verifiedPlays, 0),
        qrScans: creativeRows.reduce((sum, creative) => sum + creative.qrScans, 0),
      },
    } }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: { message: "Analytics service unavailable" } }, { status: 503 });
  }
}
