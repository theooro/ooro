import type { Prisma } from "@prisma/client";
import { webPrisma } from "@/lib/web-prisma";
import type { webContext } from "@/lib/web-owner";

type WebContext = NonNullable<Awaited<ReturnType<typeof webContext>>>;

export async function advertiserCampaignScope(context: WebContext): Promise<Prisma.CampaignWhereInput> {
  const scope: Prisma.CampaignWhereInput[] = [{ ownerEmail: context.email }, { userId: context.account.id }];
  if (context.account.accountType !== "BRAND" || context.organization?.type !== "BRAND" || context.organization.verificationStatus !== "VERIFIED") {
    return { OR: scope };
  }

  const memberships = await webPrisma.organizationMember.findMany({ where: { organizationId: context.organization.id }, select: { userId: true } });
  const userIds = memberships.map(member => member.userId);
  if (userIds.length) {
    const accounts = await webPrisma.webAccount.findMany({ where: { id: { in: userIds } }, select: { email: true } });
    const emails = [...new Set([context.email, ...accounts.map(account => account.email)])];
    scope.push({ ownerEmail: { in: emails } }, { userId: { in: userIds } });
  }
  return { OR: scope };
}
