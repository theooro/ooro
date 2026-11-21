import { NextResponse } from "next/server";
import { probeCreative } from "@/lib/creative-probe";
import { currentCreativeSubmissionAccess } from "@/lib/creative-submission-access";
import { pendingCreativeSubmissionState } from "@/apps/api/src/domain/creative-submission";
import { storeCreative } from "@/lib/creative-storage";
import { hasExpectedCreativeSignature } from "@/lib/creative-validation";
import { validateCreativeUploadInput } from "@/lib/creative-upload-policy";
import { webPrisma } from "@/lib/web-prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { context, permission } = await currentCreativeSubmissionAccess();
  if (!context) return NextResponse.json({ error: { code: "AUTH_REQUIRED", message: "Sign in before submitting a creative." } }, { status: 401 });
  if (!permission.allowed) return NextResponse.json({ error: { code: permission.code, message: permission.message } }, { status: 403 });
  if (!context.organization) return NextResponse.json({ error: { code: "ORGANIZATION_REQUIRED", message: permission.message } }, { status: 403 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: { code: "CREATIVE_FILE_REQUIRED", message: "Choose an image or video file to submit." } }, { status: 422 });
  const input = validateCreativeUploadInput({ mimeType: file.type, size: file.size, fileName: file.name });
  if (!input.valid) return NextResponse.json({ error: { code: input.code, message: input.message } }, { status: 422 });
  const fileName = input.fileName;

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!hasExpectedCreativeSignature(bytes, file.type)) return NextResponse.json({ error: { code: "CREATIVE_CONTENT_TYPE_MISMATCH", message: "The file contents do not match the selected image or video type." } }, { status: 422 });
    const media = await probeCreative(bytes, file.type);
    const stored = await storeCreative(bytes, fileName, file.type);
    const state = pendingCreativeSubmissionState();
    const submission = await webPrisma.creativeSubmission.create({ data: {
      organizationId: context.organization.id,
      submitterUserId: context.account.id,
      submitterEmail: context.email,
      fileName,
      type: file.type.startsWith("video/") ? "VIDEO" : "IMAGE",
      status: state.status,
      storageKey: stored.storageKey,
      url: stored.url,
      checksum: stored.checksum,
      mimeType: file.type,
      sizeBytes: BigInt(stored.size),
      width: media.width,
      height: media.height,
      durationSeconds: media.durationSeconds ?? 10,
    } });
    return NextResponse.json({ data: {
      id: submission.id,
      fileName: submission.fileName,
      type: submission.type,
      status: submission.status,
      submittedAt: submission.createdAt,
      campaignId: null,
      scheduled: state.scheduled,
      playbackEligible: state.playbackEligible,
    } }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CREATIVE_UPLOAD_FAILURE";
    const status = message === "CREATIVE_PROBE_FAILED" || message === "CREATIVE_CONTENT_TYPE_MISMATCH" ? 422 : 503;
    const code = message === "CREATIVE_PROBE_UNAVAILABLE" ? "MEDIA_PROCESSING_UNAVAILABLE" : message === "OBJECT_STORAGE_NOT_CONFIGURED" ? "STORAGE_NOT_CONFIGURED" : /^R2_UPLOAD_FAILED_/.test(message) ? "MEDIA_STORAGE_UNAVAILABLE" : message === "CREATIVE_PROBE_FAILED" ? "CREATIVE_MEDIA_INVALID" : "CREATIVE_SUBMISSION_UNAVAILABLE";
    const safeMessage = code === "STORAGE_NOT_CONFIGURED" ? "Creative uploads are temporarily unavailable. Please contact OORO support." : code === "MEDIA_PROCESSING_UNAVAILABLE" ? "Video processing is temporarily unavailable. Please try again later." : code === "CREATIVE_MEDIA_INVALID" ? "The selected file could not be read as valid media." : "Creative could not be submitted. Please retry.";
    return NextResponse.json({ error: { code, message: safeMessage } }, { status, headers: { "cache-control": "no-store" } });
  }
}
