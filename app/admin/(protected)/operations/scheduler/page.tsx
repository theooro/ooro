import { redirect } from "next/navigation";

// Historical campaign date windows remain stored for audit, but new delivery
// is controlled by campaign state and an explicit device quota.
export default function DeprecatedSchedulerPage() {
  redirect("/admin/campaigns");
}
