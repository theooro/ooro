import { NextResponse } from "next/server";
import { webContext } from "@/lib/web-owner";
import { webPrisma } from "@/lib/web-prisma";
import { normalizeIndianPhone } from "@/apps/api/src/domain/phone";

export async function POST(request: Request) {
  const context = await webContext(); if (!context) return NextResponse.json({ error: { message: "Sign in before continuing" } }, { status: 401 });
  if (context.account.accountType !== "NETWORK") return NextResponse.json({ error: { message: "This onboarding flow is not available for this account" } }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null; const phone = normalizeIndianPhone(String(body?.phone ?? ""));
  const role = String(body?.role ?? "").trim(); const vehicleType = String(body?.vehicleType ?? "").trim(); const registration = String(body?.registration ?? "").trim(); const city = String(body?.city ?? "").trim(); const operatingAreas = String(body?.operatingAreas ?? "").trim();
  if (!phone || !["DRIVER", "VEHICLE_OWNER", "FLEET_OPERATOR"].includes(role) || !vehicleType || !city || !operatingAreas || (role !== "FLEET_OPERATOR" && !registration)) return NextResponse.json({ error: { message: !phone ? "Enter a valid phone number." : "Complete your network application details." } }, { status: 422 });
  const application = { role, vehicleType, registration, city, operatingAreas, fleetSize: String(body?.fleetSize ?? ""), name: String(body?.name ?? context.account.name), whatsapp: String(body?.whatsapp ?? phone), operatingDays: String(body?.operatingDays ?? ""), operatingHours: String(body?.operatingHours ?? ""), screenInstallation: body?.screenInstallation === true, reviewStatus: "PENDING_REVIEW", applicationSubmittedAt: new Date().toISOString() };
  const membership = await webPrisma.organizationMember.findFirst({ where: { userId: context.account.id }, include: { organization: true } });
  if (membership?.organization.type === "NETWORK" && membership.organization.verificationStatus === "VERIFIED") return NextResponse.json({ error: { message: "Your network application is already approved. Contact OORO operations to change vehicle details." } }, { status: 409 });
  await webPrisma.$transaction(async tx => {
    const organization = membership?.organization.type === "NETWORK"
      ? await tx.organization.update({ where: { id: membership.organization.id }, data: { name: application.name, verificationStatus: "PENDING_REVIEW", verifiedAt: null, verifiedBy: null } })
      : await tx.organization.create({ data: { name: application.name, type: "NETWORK", verificationStatus: "PENDING_REVIEW", members: { create: { userId: context.account.id, role: "OWNER" } } } });
    const previous = await tx.verificationRequest.findFirst({ where: { organizationId: organization.id, status: { in: ["PENDING_REVIEW", "NEEDS_INFORMATION", "REJECTED"] } }, orderBy: { requestedAt: "desc" } });
    const verificationRequest = previous
      ? await tx.verificationRequest.update({ where: { id: previous.id }, data: { status: "PENDING_REVIEW", requestedAt: new Date(), reviewedAt: null, reviewerId: null, notes: null, metadata: { applicantName: context.account.name, email: context.email, phone, ...application } } })
      : await tx.verificationRequest.create({ data: { organizationId: organization.id, status: "PENDING_REVIEW", metadata: { applicantName: context.account.name, email: context.email, phone, ...application } } });
    await tx.verificationHistory.create({ data: { verificationRequestId: verificationRequest.id, fromStatus: previous?.status ?? "UNVERIFIED", toStatus: "PENDING_REVIEW", notes: "Fleet network application submitted" } });
    await tx.webAccount.update({ where: { id: context.account.id }, data: { phone, onboardingStatus: "COMPLETED", onboardingStep: 5, onboardingCompletedAt: new Date(), onboardingData: application } });
  });
  return NextResponse.json({ data: { next: "/network/status", reviewStatus: "PENDING_REVIEW" } });
}
