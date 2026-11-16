import { DeviceOsDashboard } from "@/components/admin/deviceos-page";
import { getAuthenticatedAdmin } from "@/lib/auth/backend-session";
import { deviceOsDeploymentRoles, deviceOsReleaseRoles, deviceOsWriteRoles } from "@/apps/api/src/domain/admin-auth";
export default async function Page() {
  const admin = await getAuthenticatedAdmin({ refreshSession: false });
  return <DeviceOsDashboard canEnroll={deviceOsWriteRoles.includes(admin.role)} canRelease={deviceOsReleaseRoles.includes(admin.role)} canDeploy={deviceOsDeploymentRoles.includes(admin.role)}/>;
}
