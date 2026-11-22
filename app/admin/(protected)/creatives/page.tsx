import { CreativeLibrary } from "@/components/admin/creative-library";
import { canAdmin } from "@/apps/api/src/domain/admin-auth";
import { getAuthenticatedAdmin } from "@/lib/auth/backend-session";
import { redirect } from "next/navigation";
export default async function Page() { const admin = await getAuthenticatedAdmin(); if (!canAdmin(admin.role, "creative:write")) redirect("/unauthorized"); return <CreativeLibrary canManage canSchedule={canAdmin(admin.role, "campaign:schedule")}/>; }
