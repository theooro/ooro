import { NextResponse } from "next/server";
import { webContext } from "@/lib/web-owner";
import { webPrisma } from "@/lib/web-prisma";

export async function POST(request: Request) {
  const context = await webContext(); if (!context) return NextResponse.json({ error: { message: "Sign in before continuing" } }, { status: 401 });
  if (context.account.accountType !== "BUSINESS") return NextResponse.json({ error: { message: "This onboarding flow is not available for this account" } }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const businessName = String(body?.businessName ?? "").trim(); const category = String(body?.category ?? "").trim(); const city = String(body?.city ?? "").trim(); const address = String(body?.address ?? "").trim(); const goals = Array.isArray(body?.goals) ? body.goals.map(String).filter(Boolean) : [];
  const step = Number(body?.step);
  if (step === 1 || step === 2) { const previous = context.account.onboardingData && typeof context.account.onboardingData === "object" && !Array.isArray(context.account.onboardingData) ? context.account.onboardingData as Record<string, unknown> : {}; await webPrisma.webAccount.update({ where: { id: context.account.id }, data: { onboardingStatus: "IN_PROGRESS", onboardingStep: step, onboardingData: JSON.parse(JSON.stringify({ ...previous, ...body })) } }); return NextResponse.json({ data: { status: "IN_PROGRESS", step } }); }
  if (businessName.length < 2 || category.length < 2 || city.length < 2 || address.length < 2 || !goals.length) return NextResponse.json({ error: { message: "Complete your business, location and advertising goal details." } }, { status: 422 });
  const website = String(body?.website ?? "").trim();
  const social = String(body?.social ?? "").trim();
  const application = { businessName, category, website, social, city, address, goals };
  const membership = await webPrisma.organizationMember.findFirst({ where: { userId: context.account.id }, include: { organization: true } });
  if (membership?.organization.type === "BUSINESS" && membership.organization.verificationStatus === "VERIFIED") return NextResponse.json({ error: { message: "Your business account is already approved. Contact OORO support if your organization details need to change." } }, { status: 409 });
  const result = await webPrisma.$transaction(async tx => {
    const organization = membership?.organization.type === "BUSINESS"
      ? await tx.organization.update({ where: { id: membership.organization.id }, data: { name: businessName, website: website || null, verificationStatus: "PENDING_REVIEW", verifiedAt: null, verifiedBy: null } })
      : await tx.organization.create({ data: { name: businessName, type: "BUSINESS", website: website || null, domain: context.email.split("@")[1]?.toLowerCase(), verificationStatus: "PENDING_REVIEW", members: { create: { userId: context.account.id, role: "OWNER" } } } });
    const existingRequest = await tx.verificationRequest.findFirst({ where: { organizationId: organization.id, status: { in: ["PENDING_REVIEW", "NEEDS_INFORMATION", "REJECTED"] } }, orderBy: { requestedAt: "desc" } });
    const verificationRequest = existingRequest
      ? await tx.verificationRequest.update({ where: { id: existingRequest.id }, data: { status: "PENDING_REVIEW", requestedAt: new Date(), reviewedAt: null, reviewerId: null, notes: null, metadata: { applicantName: context.account.name, email: context.email, phone: context.account.phone, ...application } } })
      : await tx.verificationRequest.create({ data: { organizationId: organization.id, status: "PENDING_REVIEW", metadata: { applicantName: context.account.name, email: context.email, phone: context.account.phone, ...application } } });
    await tx.verificationHistory.create({ data: { verificationRequestId: verificationRequest.id, fromStatus: existingRequest?.status ?? "UNVERIFIED", toStatus: "PENDING_REVIEW", notes: "Business advertising access application submitted" } });
    await tx.webAccount.update({ where: { id: context.account.id }, data: { name: businessName, onboardingStatus: "COMPLETED", onboardingStep: 4, onboardingCompletedAt: new Date(), onboardingData: { ...application, reviewStatus: "PENDING_REVIEW" } } });
    return organization;
  });
  return NextResponse.json({ data: { next: "/verification", organizationId: result.id, verificationStatus: result.verificationStatus } }, { status: 200 });
}
