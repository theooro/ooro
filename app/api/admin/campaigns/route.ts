import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { canAdmin } from "@/apps/api/src/domain/admin-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminAuthError, getAuthenticatedAdmin } from "@/lib/auth/backend-session";
import { webPrisma } from "@/lib/web-prisma";
import { withoutCampaignDeliveryDates } from "@/lib/campaign-delivery-presentation";
import { campaignDateWindow, DEFAULT_CAMPAIGN_TIMEZONE } from "@/apps/api/src/domain/campaign-date-window";

export const dynamic = "force-dynamic";
const offerSchema = z.object({ brandName: z.string().trim().max(120).optional(), offerTitle: z.string().trim().max(160).optional(), offerSubtitle: z.string().trim().max(240).optional(), offerValue: z.string().trim().max(120).optional(), ctaType: z.string().trim().max(40).optional(), ctaLabel: z.string().trim().max(80).optional(), ctaUrl: z.string().trim().max(2048).optional() }).strict();
const createSchema = z.object({ name: z.string().trim().min(1).max(160), advertiser: z.string().trim().max(160).optional(), campaignType: z.literal("INTERNAL_TEST").default("INTERNAL_TEST"), deliverySlot: z.enum(["MAIN", "SPONSORED"]).default("MAIN"), offlinePlaysPerDisplay: z.number().int().positive().max(1000000).optional(), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), timezone: z.string().min(1).max(64).default(DEFAULT_CAMPAIGN_TIMEZONE), centerLat: z.number().finite().min(-90).max(90).optional(), centerLng: z.number().finite().min(-180).max(180).optional(), radiusKm: z.number().finite().positive().max(500).optional(), layout: z.string().max(64).default("AD_NAV_OFFER"), offer: offerSchema.optional() }).strict();
const safe = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? Number(item) : item));
function errorResponse(error: unknown, requestId = randomUUID()) {
  const authError = error instanceof AdminAuthError;
  const prismaCode = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
  const databaseDown = error instanceof Prisma.PrismaClientInitializationError || prismaCode === "P1001" || prismaCode === "P1002";
  const schemaDrift = prismaCode === "P2021" || prismaCode === "P2022";
  const status = authError ? error.status : databaseDown || schemaDrift ? 503 : 500;
  const code = authError ? error.code : databaseDown ? "DATABASE_UNAVAILABLE" : schemaDrift ? "DATABASE_SCHEMA_MISMATCH" : "CAMPAIGN_SERVICE_ERROR";
  const message = authError
    ? status === 502 ? "Admin authentication service is unavailable. Retry when the backend is healthy." : "Admin access required"
    : databaseDown ? "Campaign database is unavailable. Contact the operator with this request ID."
    : schemaDrift ? "Campaign database schema needs operator attention. Contact support with this request ID."
    : "Campaign service failed. Contact support with this request ID.";
  // Do not print Prisma messages, SQL or connection strings into shared logs.
  console.error("[admin/campaigns] failed", {
    requestId,
    errorType: error instanceof Error ? error.name : "unknown",
    ...(prismaCode ? { prismaCode } : {}),
  });
  return NextResponse.json({ error: { code, message }, requestId }, {
    status, headers: { "x-request-id": requestId, "cache-control": "no-store" },
  });
}
export async function GET() {
  try { const admin = await getAuthenticatedAdmin(); if (!canAdmin(admin.role, "campaign:read")) throw new AdminAuthError("ADMIN_ACCESS_DENIED", 403); const campaigns = await webPrisma.campaign.findMany({ where: { status: { not: "ARCHIVED" } }, orderBy: { updatedAt: "desc" }, include: { creatives: { where: { status: { not: "ARCHIVED" } }, include: { asset: true }, orderBy: [{ status: "asc" }, { displayOrder: "asc" }] }, assignments: { where: { active: true }, select: { displayId: true } } } }); return NextResponse.json({ data: safe(campaigns.map(raw => { const campaign = withoutCampaignDeliveryDates(raw); return { ...campaign, startDate: raw.startsAt ? new Intl.DateTimeFormat("en-CA", { timeZone: raw.timezone || DEFAULT_CAMPAIGN_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(raw.startsAt) : null, endDate: raw.endsAt ? new Intl.DateTimeFormat("en-CA", { timeZone: raw.timezone || DEFAULT_CAMPAIGN_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(raw.endsAt.getTime() - 1)) : null, timezone: raw.timezone || DEFAULT_CAMPAIGN_TIMEZONE, selectedScreens: campaign.assignments.length, creativeCount: campaign.creatives.length, approvedCreativeCount: campaign.creatives.filter(item => item.status === "APPROVED").length, pendingCreativeCount: campaign.creatives.filter(item => item.status === "PENDING_REVIEW").length, creative: campaign.creatives.find(item => item.status === "APPROVED") ?? campaign.creatives[0] ?? null }; })) }); } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try { const admin = await getAuthenticatedAdmin(); if (!canAdmin(admin.role, "campaign:create")) throw new AdminAuthError("ADMIN_ACCESS_DENIED", 403); const parsed = createSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: { message: "Provide a campaign name, start date, end date, and valid delivery authorization." } }, { status: 422 }); const input = parsed.data; let dateWindow; try { dateWindow = campaignDateWindow(input.startDate, input.endDate, input.timezone); } catch (error) { return NextResponse.json({ error: { code: error instanceof Error ? error.message : "CAMPAIGN_DATE_INVALID", message: "Choose valid inclusive campaign dates and a valid timezone." } }, { status: 422 }); } const metadata = { campaignType: "INTERNAL_TEST", target: { mode: input.centerLat !== undefined && input.centerLng !== undefined ? "RADIUS" : "MANUAL_SCREENS", centerLat: input.centerLat, centerLng: input.centerLng, radiusKm: input.radiusKm }, advertiser: input.advertiser ?? "", offer: input.offer ?? {} }; const campaign = await webPrisma.$transaction(async tx => { const created = await tx.campaign.create({ data: { name: input.name, status: "DRAFT", deliverySlot: input.deliverySlot, startsAt: dateWindow.startsAt, endsAt: dateWindow.endsAt, timezone: input.timezone, layout: input.layout, offlinePlaysPerDisplay: input.offlinePlaysPerDisplay, campaignCenterLat: input.centerLat, campaignCenterLng: input.centerLng, radiusKm: input.radiusKm, commercialFundingStatus: "INTERNAL_TEST", metadata } }); await tx.auditLog.create({ data: { actorId: admin.userId, actorRole: admin.role, action: "CAMPAIGN_CREATED", entityType: "Campaign", entityId: created.id, after: { name: created.name, status: created.status, campaignType: "INTERNAL_TEST", deliverySlot: input.deliverySlot, startDate: input.startDate, endDate: input.endDate, timezone: input.timezone } } }); return created; }); return NextResponse.json({ data: safe({ ...withoutCampaignDeliveryDates(campaign), startDate: input.startDate, endDate: input.endDate, timezone: input.timezone }) }, { status: 201 }); } catch (error) { return errorResponse(error); }
}
