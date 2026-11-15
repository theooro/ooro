import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Check, Clock3, MonitorPlay } from "lucide-react";
import type { Metadata } from "next";
import { webContext } from "@/lib/web-owner";
import { ensureNetworkReview } from "@/lib/ensure-network-review";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function NetworkStatusPage() {
  const context = await webContext();
  if (!context) redirect("/login");
  if (context.account.accountType !== "NETWORK") redirect("/welcome");
  if (context.account.onboardingStatus !== "COMPLETED") redirect("/onboarding/network");
  const organization = context.organization ?? await ensureNetworkReview(context.account);
  const saved = context.account.onboardingData;
  const application = saved && typeof saved === "object" && !Array.isArray(saved) ? saved as Record<string, unknown> : {};
  const date = typeof application.applicationSubmittedAt === "string" ? new Date(application.applicationSubmittedAt) : context.account.onboardingCompletedAt;
  const submitted = date && Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "Received";
  const role = String(application.role ?? "Network applicant").replaceAll("_", " ").toLowerCase();
  const reviewStatus = organization.verificationStatus;
  const approved = reviewStatus === "VERIFIED";

  return <main className="min-h-screen bg-[#f7f7f5] px-5 py-10 sm:px-8 sm:py-16"><div className="mx-auto max-w-3xl">
    <p className="app-eyebrow">OORO / FLEET NETWORK</p>
    <div className="mt-4 flex flex-wrap items-start justify-between gap-5"><div><h1 className="max-w-2xl text-3xl font-medium tracking-[-.04em] sm:text-4xl">{approved ? "Your network application is approved." : reviewStatus === "NEEDS_INFORMATION" || reviewStatus === "REJECTED" ? "Your application needs an update." : "Your fleet application is in review."}</h1><p className="mt-4 max-w-xl text-sm leading-6 text-neutral-600">{approved ? "The review is complete. OORO operations will contact you separately about vehicle eligibility, equipment and installation." : reviewStatus === "NEEDS_INFORMATION" || reviewStatus === "REJECTED" ? "Please update your application so the network team can continue its review." : "We’ve received your details. Our network team will check operating areas, vehicle fit and installation availability before confirming next steps."}</p></div><span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${approved ? "border-lime-300 bg-lime-50 text-lime-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>{approved ? <Check size={14}/> : <Clock3 size={14}/>} {reviewStatus.replaceAll("_", " ")}</span></div>
    <section className="mt-8 rounded-xl border border-neutral-200 bg-white p-5 sm:p-7" aria-labelledby="application-progress">
      <h2 id="application-progress" className="text-lg font-medium">What happens next</h2>
      <ol className="mt-5 grid gap-3 sm:grid-cols-3">
        {[{ title: "Application received", detail: `Submitted ${submitted}.`, done: true }, { title: "Operations review", detail: approved ? "Network details reviewed by OORO." : "We assess fleet details and local availability.", done: approved }, { title: "Next steps", detail: "Vehicle eligibility and installation are confirmed separately.", done: false }].map((step, i) => <li key={step.title} className="rounded-lg border border-neutral-200 bg-[#fafaf8] p-4"><span className={`grid h-7 w-7 place-items-center rounded-full text-xs ${step.done ? "bg-[#dfff00] text-black" : "bg-neutral-200 text-neutral-600"}`}>{step.done ? <Check size={14}/> : `0${i + 1}`}</span><h3 className="mt-4 text-sm font-medium">{step.title}</h3><p className="mt-1 text-xs leading-5 text-neutral-500">{step.detail}</p></li>)}
      </ol>
    </section>
    <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-5 sm:p-7"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-lg bg-neutral-100"><MonitorPlay size={18}/></span><div><p className="text-sm font-medium">Application summary</p><p className="mt-1 text-xs text-neutral-500">For {role} review</p></div></div><dl className="mt-5 grid gap-x-8 gap-y-4 border-t border-neutral-200 pt-5 text-sm sm:grid-cols-2"><div><dt className="text-xs text-neutral-500">Vehicle</dt><dd className="mt-1 font-medium">{String(application.vehicleType || "Not provided")}{application.registration ? ` · ${String(application.registration)}` : ""}</dd></div><div><dt className="text-xs text-neutral-500">City</dt><dd className="mt-1 font-medium">{String(application.city || "Not provided")}</dd></div><div className="sm:col-span-2"><dt className="text-xs text-neutral-500">Operating areas</dt><dd className="mt-1 font-medium">{String(application.operatingAreas || "Not provided")}</dd></div></dl></section>
    <p className="mt-5 max-w-2xl text-xs leading-5 text-neutral-500">Application review does not pair or activate a screen. OORO operations will separately confirm eligibility, equipment and installation with you.</p>
    <div className="mt-7 flex flex-wrap gap-3"><Link href="/onboarding/network" className="inline-flex items-center gap-2 rounded-lg bg-black px-5 py-3 text-sm font-medium text-white">Update application<ArrowRight size={15}/></Link><Link href="/settings" className="rounded-lg border border-neutral-300 bg-white px-5 py-3 text-sm font-medium">Account settings</Link></div>
  </div></main>;
}
