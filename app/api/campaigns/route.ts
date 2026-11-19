import { NextResponse } from "next/server";
import { advertiserCampaignScope } from "@/lib/advertiser-campaign-scope";
import { webPrisma } from "@/lib/web-prisma";
import { webOwnerEmail } from "@/lib/web-owner";
import { MIN_SELF_SERVE_BUDGET_RUPEES } from "@/lib/campaign-policy";
import { webContext } from "@/lib/web-owner";
import { hasRemovedCampaignTiming, validateAdvertiserCampaignDraft, type AdvertiserCampaignDraft } from "@/lib/campaign-draft-validation";
import { withoutCampaignDeliveryDates } from "@/lib/campaign-delivery-presentation";

type CampaignInput = AdvertiserCampaignDraft;

async function owner() {
  return webOwnerEmail();
}

export async function GET() {
  const email = await owner();
  if (!email) return NextResponse.json({ error: { message: "Sign in to view campaigns" } }, { status: 401 });
  try {
    const context = await webContext();
    if (context?.account.accountType === "NETWORK" || context?.account.accountType === "EXPLORER") return NextResponse.json({ error: { code: "ADVERTISER_ACCESS_REQUIRED", message: "This account does not have advertiser campaign access." } }, { status: 403 });
    if (context?.account.accountType === "BRAND" && (!context.organization || context.organization.verificationStatus !== "VERIFIED")) return NextResponse.json({ error: { code: "BRAND_VERIFICATION_REQUIRED", message: "Your Brand account is awaiting verification." } }, { status: 403 });
    if (context?.account.accountType === "AGENCY" && (!context.organization || context.organization.verificationStatus !== "VERIFIED")) return NextResponse.json({ error: { code: "AGENCY_APPROVAL_REQUIRED", message: "Your Agency application is being reviewed." } }, { status: 403 });
    if (context?.account.accountType === "BUSINESS" && (!context.organization || context.organization.type !== "BUSINESS" || context.organization.verificationStatus !== "VERIFIED")) return NextResponse.json({ error: { code: "BUSINESS_APPROVAL_REQUIRED", message: "Your Business account is being reviewed. Campaign access opens after approval." } }, { status: 403 });
    const campaigns = await webPrisma.campaign.findMany({ where: context ? await advertiserCampaignScope(context) : { ownerEmail: email }, orderBy: { updatedAt: "desc" } });
    return NextResponse.json({ data: campaigns.map(withoutCampaignDeliveryDates) });
  } catch (error) { console.error("[campaigns] list failed", error); return NextResponse.json({ error: { code: "CAMPAIGN_SERVICE_UNAVAILABLE", message: "Campaign service unavailable" } }, { status: 503 }); }
}

export async function POST(request: Request) {
  const email = await owner();
  if (!email) return NextResponse.json({ error: { message: "Sign in to save campaigns" } }, { status: 401 });
  const input = await request.json().catch(() => null) as CampaignInput | null;
  if (hasRemovedCampaignTiming(input)) return NextResponse.json({ error: { code: "CAMPAIGN_TIMING_REMOVED", message: "Campaign delivery is controlled by approval, state, and authorized quota; campaign dates and daily windows are no longer accepted." } }, { status: 422 });
  // Public advertisers may submit campaign drafts, but cannot authorize
  // scheduling through a client-supplied status. Payment, approval, inventory
  // reservation and activation are separate server-controlled workflows.
  if (input?.status && input.status !== "DRAFT") return NextResponse.json({ error: { code: "CAMPAIGN_APPROVAL_REQUIRED", message: "Campaigns can only be submitted as drafts. OORO must approve and authorize delivery." } }, { status: 422 });
  const error = validateAdvertiserCampaignDraft(input, input?.status === "DRAFT");
  if (error) return NextResponse.json({ error: { message: error } }, { status: 422 });
  try {
    const context = await webContext();
    // Match read permissions: a network/explorer account or unapproved
    // agency/brand must not write advertiser campaigns through this route.
    if (context?.account.accountType === "NETWORK" || context?.account.accountType === "EXPLORER") return NextResponse.json({ error: { code: "ADVERTISER_ACCESS_REQUIRED", message: "This account does not have advertiser campaign access." } }, { status: 403 });
    if (context?.account.accountType === "BRAND" && (!context.organization || context.organization.verificationStatus !== "VERIFIED")) return NextResponse.json({ error: { code: "BRAND_VERIFICATION_REQUIRED", message: "Your Brand account is awaiting verification." } }, { status: 403 });
    if (context?.account.accountType === "AGENCY" && (!context.organization || context.organization.verificationStatus !== "VERIFIED")) return NextResponse.json({ error: { code: "AGENCY_APPROVAL_REQUIRED", message: "Your Agency application is being reviewed." } }, { status: 403 });
    if (context?.account.accountType === "BUSINESS" && (!context.organization || context.organization.type !== "BUSINESS" || context.organization.verificationStatus !== "VERIFIED")) return NextResponse.json({ error: { code: "BUSINESS_APPROVAL_REQUIRED", message: "Your Business account is being reviewed. Campaign access opens after approval." } }, { status: 403 });
    const forecastSettings = await webPrisma.forecastSetting.findUnique({ where: { key: "DEFAULT" } });
    const isSelfServe = !context?.organization || context.organization.type === "CONSUMER";
    if (input?.budget !== undefined && isSelfServe && input.budget < (forecastSettings?.minimumSelfServeBudget ?? MIN_SELF_SERVE_BUDGET_RUPEES)) return NextResponse.json({ error: { code: "MINIMUM_BUDGET", message: `Minimum OORO campaign budget is ₹${forecastSettings?.minimumSelfServeBudget ?? MIN_SELF_SERVE_BUDGET_RUPEES}.` } }, { status: 422 });
    const requestedPlan = input?.pricingPlanId ? await webPrisma.pricingPlan.findFirst({ where: { id: input.pricingPlanId, active: true } }) : null;
    if (input?.pricingPlanId && !requestedPlan) return NextResponse.json({ error: { message: "Pricing plan is unavailable" } }, { status: 422 });
    const verifiedPrivate = Boolean(context?.organization && context.organization.verificationStatus === "VERIFIED" && ["BRAND", "AGENCY"].includes(context.organization.type));
    if (requestedPlan && ((requestedPlan.customerType === "SELF_SERVE" && !requestedPlan.isPublic) || (requestedPlan.customerType !== "SELF_SERVE" && (!verifiedPrivate || requestedPlan.customerType !== context?.organization?.type)))) return NextResponse.json({ error: { message: "This pricing plan is not available for your account" } }, { status: 403 });
    const rateOverride = requestedPlan && requestedPlan.customerType !== "SELF_SERVE" && context?.organization?.id
      ? await webPrisma.organizationPricingOverride.findFirst({ where: { organizationId: context.organization.id, pricingPlanId: requestedPlan.id, effectiveFrom: { lte: new Date() }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }] }, orderBy: { effectiveFrom: "desc" } })
      : null;
    const rate = requestedPlan?.customerType === "SELF_SERVE" ? requestedPlan.impressionRate : (rateOverride?.customRate ?? requestedPlan?.autoDayRate);
    const metadata = { goal: input!.goal, audience: input!.audience, city: input!.city, area: input!.area, media: input!.media, budget: input!.budget, currency: input!.currency, ...input!.metadata };
    const campaign = await webPrisma.campaign.create({ data: {
      ownerEmail: email, userId: context?.account.id, name: input!.name!.trim(), description: input!.description?.trim(), status: "DRAFT",
      layout: String(input!.media ?? "OORO Auto Screens"),
      campaignCenterLat: input!.campaignCenterLat, campaignCenterLng: input!.campaignCenterLng, radiusKm: input!.radiusKm,
      forecastSnapshot: input!.forecastSnapshot ? JSON.parse(JSON.stringify(input!.forecastSnapshot)) : undefined, forecastGeneratedAt: input!.forecastGeneratedAt ? new Date(input!.forecastGeneratedAt) : undefined, forecastExpiresAt: input!.forecastExpiresAt ? new Date(input!.forecastExpiresAt) : undefined, forecastVersion: input!.forecastVersion,
      deliveryTier: requestedPlan ? (requestedPlan.deliveryTier === "PREMIUM_PLUS" ? "PREMIUM_PLUS" : "STANDARD") : (input!.deliveryTier ?? (String(input!.metadata?.deliveryTier ?? "STANDARD") === "PREMIUM_PLUS" ? "PREMIUM_PLUS" : "STANDARD")), pricingPlanId: requestedPlan?.id, effectiveRate: rate, pricingSource: requestedPlan ? (requestedPlan.customerType === "SELF_SERVE" ? "PUBLIC_SELF_SERVE" : requestedPlan.deliveryTier === "PREMIUM_PLUS" ? "PREMIUM_PLUS" : rateOverride ? "ORGANIZATION_OVERRIDE" : "VERIFIED_PLAN") : undefined, pricingSnapshot: requestedPlan ? { customerType: requestedPlan.customerType, plan: requestedPlan.name, commitmentMonths: requestedPlan.commitmentMonths, deliveryTier: requestedPlan.deliveryTier, impressionRate: requestedPlan.impressionRate, autoDayRate: requestedPlan.autoDayRate, effectiveRate: rate, customPricing: Boolean(rateOverride), budget: input!.budget ?? null } : undefined,
      metadata,
    } });
    return NextResponse.json({ data: withoutCampaignDeliveryDates(campaign) }, { status: 201 });
  } catch { return NextResponse.json({ error: { message: "Campaign could not be saved" } }, { status: 503 }); }
}
