import { NextResponse } from "next/server";
import { webPrisma } from "@/lib/web-prisma";
import { webOwnerEmail } from "@/lib/web-owner";

const retired = () => NextResponse.json({ error: { code: "DATE_BASED_DELIVERY_RETIRED", message: "Date-based inventory reservations are retired. Campaign delivery is authorized by campaign state and per-screen quota." } }, { status: 410 });

// Date-window inventory holds cannot authorize state-based campaign delivery.
// Keep release support for historical holds without deleting their audit rows.
export async function POST(_request: Request) { return retired(); }
export async function PATCH(_request: Request) { return retired(); }

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerEmail = await webOwnerEmail();
  if (!ownerEmail) return NextResponse.json({ error: { message: "Sign in to release legacy inventory holds" } }, { status: 401 });
  const { id } = await params;
  try {
    const campaign = await webPrisma.campaign.findFirst({ where: { id, ownerEmail }, select: { id: true } });
    if (!campaign) return NextResponse.json({ error: { message: "Campaign not found" } }, { status: 404 });
    const result = await webPrisma.inventoryAllocation.updateMany({ where: { campaignId: id, status: "HELD" }, data: { status: "CANCELLED", expiresAt: null } });
    return NextResponse.json({ data: { released: result.count, historicalAllocationsPreserved: true } });
  } catch { return NextResponse.json({ error: { message: "Legacy inventory holds could not be released" } }, { status: 503 }); }
}
