import { PlanAccess } from "@/components/marketing/advertiser-journeys";
import { VerificationPanel } from "@/components/verification/verification-panel";
import { BackButton } from "@/components/app/back-button";
import type { Metadata } from "next";
export const metadata: Metadata = { robots: { index: false, follow: false } };
export default function VerificationPage() { return <main className="min-h-screen bg-[#f7f7f5] px-5 py-12 sm:px-8"><div className="mx-auto max-w-5xl"><div className="flex flex-wrap items-center gap-4"><BackButton fallbackHref="/dashboard"/><a href="/dashboard" className="text-sm font-medium">Workspace</a></div><div className="mt-12 sm:mt-16"><p className="app-eyebrow">OORO commercial access</p><h1 className="mt-3 text-3xl font-medium tracking-[-.04em] sm:text-4xl">Your application and access status.</h1><p className="mt-4 max-w-2xl text-sm leading-6 text-neutral-600">We review business, brand and agency accounts before campaign creation is enabled. You can follow the review here; campaign actions unlock after approval.</p><div className="mt-8 space-y-6"><VerificationPanel/><PlanAccess/></div></div></div></main>; }
