import { webPrisma } from "@/lib/web-prisma";

type NetworkAccount = { id: string; name: string; email: string; phone: string | null; onboardingData: unknown };

/** Moves previously completed fleet applications into the operator review queue. */
export async function ensureNetworkReview(account: NetworkAccount) {
  const membership = await webPrisma.organizationMember.findFirst({ where: { userId: account.id }, include: { organization: true } });
  if (membership?.organization.type === "NETWORK") return membership.organization;
  const saved = account.onboardingData && typeof account.onboardingData === "object" && !Array.isArray(account.onboardingData) ? account.onboardingData as Record<string, unknown> : {};
  return webPrisma.$transaction(async tx => {
    const organization = await tx.organization.create({ data: { name: String(saved.name ?? account.name), type: "NETWORK", verificationStatus: "PENDING_REVIEW", members: { create: { userId: account.id, role: "OWNER" } } } });
    const request = await tx.verificationRequest.create({ data: { organizationId: organization.id, status: "PENDING_REVIEW", metadata: { applicantName: account.name, email: account.email, phone: account.phone, ...saved } } });
    await tx.verificationHistory.create({ data: { verificationRequestId: request.id, fromStatus: "UNVERIFIED", toStatus: "PENDING_REVIEW", notes: "Existing fleet network application moved into the operator review queue" } });
    return organization;
  });
}
