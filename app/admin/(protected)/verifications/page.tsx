import { PageHeader } from "@/components/app/app-ui";
import { VerificationQueue } from "@/components/admin/verification-queue";
export default function AdminVerificationsPage() { return <div className="space-y-8"><PageHeader eyebrow="Operations" title="Verification queue" description="Review business, brand, agency and fleet network applications. Decisions are recorded with review history."/><VerificationQueue/></div>; }
