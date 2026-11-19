import { NextResponse } from "next/server";
import { validateCampaignContinuation } from "@/apps/api/src/domain/campaign-transition";
import { webPrisma } from "@/lib/web-prisma";
import { webOwnerEmail } from "@/lib/web-owner";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerEmail = await webOwnerEmail();
  if (!ownerEmail) return NextResponse.json({ error: { message: "Sign in to continue this campaign" } }, { status: 401 });
  const { id } = await params;
  try {
    const campaign = await webPrisma.campaign.findFirst({ where: { id, ownerEmail }, include: { creatives: { where: { status: "APPROVED" }, include: { asset: true }, take: 1 }, assignments: { where: { active: true }, select: { id: true } } } });
    if (!campaign) return NextResponse.json({ error: { message: "Campaign not found" } }, { status: 404 });
    if (campaign.status === "SCHEDULED") return NextResponse.json({ error: { code: "LEGACY_SCHEDULE_REVIEW_REQUIRED", message: "This legacy scheduled campaign was not converted. An administrator must review its approval, funding, assignment, and quota before changing state." } }, { status: 409 });
    if (campaign.status === "ACTIVE") return NextResponse.json({ error: { code: "ADMIN_STATE_REQUIRED", message: "Campaign delivery is controlled by OORO approval and campaign state." } }, { status: 409 });
    const metadata = campaign.metadata && typeof campaign.metadata === "object" && !Array.isArray(campaign.metadata) ? campaign.metadata as Record<string, unknown> : {};
    const validationError = validateCampaignContinuation({ status: campaign.status, hasCreative: Boolean(campaign.creatives[0]?.asset), activeDisplayCount: campaign.assignments.length, budget: metadata.budget });
    if (validationError) return NextResponse.json({ error: { message: validationError } }, { status: 422 });
    const updated = await webPrisma.campaign.update({ where: { id: campaign.id }, data: { status: "READY" } });
    return NextResponse.json({ data: { id: updated.id, status: updated.status, name: updated.name, transition: "READY_FOR_OORO_REVIEW", deliveryQueued: false } });
  } catch { return NextResponse.json({ error: { message: "Campaign could not continue" } }, { status: 503 }); }
}
