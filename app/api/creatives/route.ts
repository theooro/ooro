import { NextResponse } from "next/server";
import { webPrisma } from "@/lib/web-prisma";
import { currentCreativeSubmissionAccess } from "@/lib/creative-submission-access";

export async function GET() {
  const { context, permission } = await currentCreativeSubmissionAccess();
  if (!context) return NextResponse.json({ error: { message: "Sign in to view creatives" } }, { status: 401, headers: { "cache-control": "no-store" } });
  try {
    const [campaigns, submissions] = await Promise.all([
      webPrisma.campaign.findMany({ where: { OR: [{ ownerEmail: context.email }, { userId: context.account.id }] }, include: { creatives: { include: { asset: true } } }, orderBy: { updatedAt: "desc" } }),
      context.organization ? webPrisma.creativeSubmission.findMany({ where: { organizationId: context.organization.id }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
    ]);
    const campaignCreatives = campaigns.flatMap(campaign => campaign.creatives.filter(creative => creative.asset).map(creative => ({ creativeId: creative.id, campaignId: campaign.id, campaignName: campaign.name, submission: false, name: creative.name, type: creative.type, status: creative.status, asset: creative.asset ? { id: creative.asset.id, fileName: creative.asset.fileName, mimeType: creative.asset.mimeType, size: typeof creative.asset.sizeBytes === "bigint" ? Number(creative.asset.sizeBytes) : creative.asset.sizeBytes, checksum: creative.asset.checksum, url: creative.asset.url, width: creative.asset.width, height: creative.asset.height, durationSeconds: creative.asset.durationSeconds } : null })));
    const creativeSubmissions = submissions.map(submission => ({ creativeId: submission.id, campaignId: null, campaignName: null, submission: true, name: submission.fileName, type: submission.type, status: submission.status, submittedAt: submission.createdAt, asset: { id: submission.id, fileName: submission.fileName, mimeType: submission.mimeType, size: Number(submission.sizeBytes), checksum: submission.checksum, url: submission.url, width: submission.width, height: submission.height, durationSeconds: submission.durationSeconds } }));
    return NextResponse.json({ data: [...creativeSubmissions, ...campaignCreatives], uploadPermission: permission }, { headers: { "cache-control": "no-store" } });
  } catch { return NextResponse.json({ error: { message: "Creative service unavailable" } }, { status: 503 }); }
}
