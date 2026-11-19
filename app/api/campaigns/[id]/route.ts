import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { webPrisma } from "@/lib/web-prisma";
import { webContext, webOwnerEmail } from "@/lib/web-owner";
import { advertiserCampaignScope } from "@/lib/advertiser-campaign-scope";
import { hasRemovedCampaignTiming } from "@/lib/campaign-draft-validation";
import { withoutCampaignDeliveryDates } from "@/lib/campaign-delivery-presentation";

type CampaignPatch = { name?: string; description?: string; goal?: string; audience?: string; city?: string; area?: string; media?: string; budget?: number; currency?: string; metadata?: Record<string, unknown>; status?: "DRAFT"; campaignCenterLat?: number | null; campaignCenterLng?: number | null; radiusKm?: number | null; forecastSnapshot?: Record<string, unknown>; forecastGeneratedAt?: string; forecastExpiresAt?: string; forecastVersion?: string; deliveryTier?: "STANDARD" | "PREMIUM_PLUS" };

async function identity() { return webOwnerEmail(); }

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await webContext(); const email = context?.email ?? await identity(); if (!email) return NextResponse.json({ error: { message: "Sign in to view campaigns" } }, { status: 401 });
  const { id } = await params;
  try {
    const campaign = await webPrisma.campaign.findUnique({ where: { id }, include: { creatives: { where: { status: "APPROVED" }, orderBy: { displayOrder: "asc" }, include: { asset: true } } } });
    if (!campaign) return NextResponse.json({ error: { message: "Campaign not found" } }, { status: 404 });
    const scope = context ? await advertiserCampaignScope(context) : { ownerEmail: email };
    const access = await webPrisma.campaign.findFirst({ where: { AND: [{ id }, scope] }, select: { id: true } });
    if (!access) return NextResponse.json({ error: { message: "You do not have access to this campaign" } }, { status: 403 });
    const campaignPublic = withoutCampaignDeliveryDates(campaign);
    const serializable = JSON.parse(JSON.stringify({ ...campaignPublic, pricingSnapshot: campaign.pricingSnapshot ? { customerType: (campaign.pricingSnapshot as Record<string, unknown>).customerType, plan: (campaign.pricingSnapshot as Record<string, unknown>).plan, budget: (campaign.pricingSnapshot as Record<string, unknown>).budget } : null }, (_key, value) => typeof value === "bigint" ? Number(value) : value));
    return NextResponse.json({ data: serializable });
  } catch { return NextResponse.json({ error: { message: "Campaign service unavailable" } }, { status: 503 }); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await webContext(); const email = context?.email ?? await identity(); if (!email) return NextResponse.json({ error: { message: "Sign in to update campaigns" } }, { status: 401 });
  const { id } = await params; const input = await request.json().catch(() => null) as CampaignPatch | null;
  if (hasRemovedCampaignTiming(input)) return NextResponse.json({ error: { code: "CAMPAIGN_TIMING_REMOVED", message: "Campaign delivery is controlled by approval, state, and authorized quota; campaign dates and daily windows are no longer accepted." } }, { status: 422 });
  try {
    const existing = await webPrisma.campaign.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: { message: "Campaign not found" } }, { status: 404 });
    if (existing.userId !== context?.account.id && existing.ownerEmail !== email) return NextResponse.json({ error: { message: "You do not have access to this campaign" } }, { status: 403 });
    const target = input?.metadata?.target;
    const citywide = Boolean(target && typeof target === "object" && (target as Record<string, unknown>).mode === "CITYWIDE");
    const existingMetadata = existing.metadata as Record<string, unknown> | null;
    const campaign = await webPrisma.campaign.update({ where: { id }, data: {
      name: input?.name?.trim() || undefined, description: typeof input?.description === "string" ? input.description : undefined,
      status: input?.status,
      layout: typeof input?.media === "string" ? input.media : undefined,
      campaignCenterLat: citywide ? null : input?.campaignCenterLat, campaignCenterLng: citywide ? null : input?.campaignCenterLng, radiusKm: citywide ? null : input?.radiusKm,
      forecastSnapshot: citywide ? Prisma.DbNull : input?.forecastSnapshot ? JSON.parse(JSON.stringify(input.forecastSnapshot)) : undefined, forecastGeneratedAt: citywide ? null : input?.forecastGeneratedAt ? new Date(input.forecastGeneratedAt) : undefined, forecastExpiresAt: citywide ? null : input?.forecastExpiresAt ? new Date(input.forecastExpiresAt) : undefined, forecastVersion: citywide ? null : input?.forecastVersion, acceptedForecastVersion: citywide ? null : undefined, acceptedForecastAt: citywide ? null : undefined, deliveryTier: input?.deliveryTier,
      metadata: input?.metadata ? { ...(existingMetadata ?? {}), ...input.metadata, goal: input.goal, audience: input.audience, city: input.city, area: input.area, media: input.media, ...(citywide ? { budget: null } : input.budget === undefined ? {} : { budget: input.budget }), currency: input.currency } : undefined,
    } });
    return NextResponse.json({ data: withoutCampaignDeliveryDates(campaign) });
  } catch { return NextResponse.json({ error: { message: "Campaign could not be updated" } }, { status: 503 }); }
}
