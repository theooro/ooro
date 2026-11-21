import { creativeSubmissionPermission } from "@/apps/api/src/domain/creative-submission";
import { webContext } from "@/lib/web-owner";
import { webPrisma } from "@/lib/web-prisma";

export async function currentCreativeSubmissionAccess() {
  const context = await webContext();
  if (!context) return { context: null, permission: creativeSubmissionPermission({}) };
  const agencyProfile = context.account.accountType === "AGENCY" && context.organization?.type === "AGENCY"
    ? await webPrisma.agencyProfile.findUnique({ where: { organizationId: context.organization.id }, select: { applicationStatus: true } })
    : null;
  return {
    context,
    permission: creativeSubmissionPermission({
      accountType: context.account.accountType,
      organizationType: context.organization?.type,
      verificationStatus: context.organization?.verificationStatus,
      agencyApplicationStatus: agencyProfile?.applicationStatus,
    }),
  };
}
