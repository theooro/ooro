import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminPermission, AdminAuthError } from "@/lib/auth/backend-session";
import { webPrisma } from "@/lib/web-prisma";
import { addApprovedSubmissionToCampaign } from "@/apps/api/src/domain/creative-submission-scheduling";

const inputSchema = z.object({ submissionId: z.string().uuid(), campaignId: z.string().uuid() }).strict();
export async function POST(request: Request) {
  try {
    const admin = await requireAdminPermission("campaign:schedule");
    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: { message: "Choose a creative submission and campaign." } }, { status: 422 });
    const result = await webPrisma.$transaction(tx => addApprovedSubmissionToCampaign(tx, { ...parsed.data, admin }), { isolationLevel: "Serializable" });
    if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.statusCode });
    return NextResponse.json({ data: { ...result, scheduled: true, campaignDeliveryRulesApply: true, note: "Campaign delivery still follows its existing approval, payment, targeting, date, assignment and quota checks." } }, { status: 201 });
  } catch (error) {
    const status = error instanceof AdminAuthError ? error.status : 503;
    return NextResponse.json({ error: { message: error instanceof AdminAuthError ? "Campaign scheduling permission is required." : "Submission could not be added to the campaign." } }, { status });
  }
}
