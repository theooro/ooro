import { webPrisma } from "@/lib/web-prisma";

type BusinessAccount = { id: string; name: string; email: string; onboardingData: unknown };

/** Backfills a pending review for Business accounts created before review gating. */
export async function ensureBusinessReview(account: BusinessAccount) {
  const membership = await webPrisma.organizationMember.findFirst({ where: { userId: account.id }, include: { organization: true } });
  if (membership?.organization.type === "BUSINESS") return membership.organization;
  const saved = account.onboardingData && typeof account.onboardingData === "object" && !Array.isArray(account.onboardingData) ? account.onboardingData as Record<string, unknown> : {};
  const organizationName = String(saved.businessName ?? account.name).trim() || account.name;
  return webPrisma.$transaction(async tx => {
    const organization = await tx.organization.create({ data: {
      name: organizationName,
      type: "BUSINESS",
      website: String(saved.website ?? "").trim() || null,
      domain: account.email.split("@")[1]?.toLowerCase(),
      verificationStatus: "PENDING_REVIEW",
      members: { create: { userId: account.id, role: "OWNER" } },
    } });
    const request = await tx.verificationRequest.create({ data: { organizationId: organization.id, status: "PENDING_REVIEW", metadata: { applicantName: account.name, email: account.email, ...saved } } });
    await tx.verificationHistory.create({ data: { verificationRequestId: request.id, fromStatus: "UNVERIFIED", toStatus: "PENDING_REVIEW", notes: "Business account moved into the organization review flow" } });
    return organization;
  });
}
