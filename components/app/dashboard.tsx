"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight, CalendarDays, CircleHelp, FileImage, MapPin, Plus, Radio, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState, PrimaryButton, SectionCard, StatusBadge } from "./app-ui";

type Campaign = { id: string; name: string; status: string; startsAt?: string | null; endsAt?: string | null };

const nextSteps = [
  { icon: MapPin, title: "Choose an area", detail: "Pick a Bengaluru neighbourhood for your campaign.", href: "/campaigns/new" },
  { icon: CalendarDays, title: "Set your dates and budget", detail: "Build a plan. OORO confirms availability before booking.", href: "/campaigns/new" },
  { icon: FileImage, title: "Add your creative", detail: "Upload artwork now or add it to a saved campaign later.", href: "/creatives" },
];

export function Dashboard() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/campaigns", { cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Unable to load campaigns");
        const payload = await response.json();
        if (active) setCampaigns(payload?.data ?? []);
      })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const activeCount = campaigns.filter(item => ["SCHEDULED", "LIVE", "ACTIVE"].includes(item.status)).length;
  const reviewCount = campaigns.filter(item => ["DRAFT", "PENDING_REVIEW", "SUBMITTED"].includes(item.status)).length;

  return <div className="space-y-7 sm:space-y-9">
    <header className="flex flex-col gap-5 border-b border-neutral-200 pb-7 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="app-eyebrow">OORO workspace</p>
        <h1 className="mt-2 text-3xl font-medium tracking-[-.045em] sm:text-4xl">Campaigns, made clearer.</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-neutral-600">Plan local screen advertising, keep creative and review status together, then follow delivery from one place.</p>
      </div>
      <PrimaryButton href="/campaigns/new"><Plus className="mr-2" size={16}/>Plan a campaign<ArrowUpRight className="ml-3" size={15}/></PrimaryButton>
    </header>

    <section className="grid gap-3 sm:grid-cols-3" aria-label="Workspace summary">
      <div className="flex items-center gap-4 rounded-xl border border-neutral-200 bg-white p-5"><span className="grid h-10 w-10 place-items-center rounded-lg bg-[#f2f4d8]"><Radio size={18}/></span><div><p className="text-xs text-neutral-500">Active campaigns</p><p className="mt-1 text-2xl font-semibold tracking-tight">{loading ? "—" : activeCount}</p></div></div>
      <div className="flex items-center gap-4 rounded-xl border border-neutral-200 bg-white p-5"><span className="grid h-10 w-10 place-items-center rounded-lg bg-neutral-100"><Sparkles size={18}/></span><div><p className="text-xs text-neutral-500">In planning or review</p><p className="mt-1 text-2xl font-semibold tracking-tight">{loading ? "—" : reviewCount}</p></div></div>
      <Link href="/campaigns" className="group flex items-center justify-between gap-4 rounded-xl border border-neutral-200 bg-white p-5 transition hover:border-neutral-400"><div><p className="text-xs text-neutral-500">Your workspace</p><p className="mt-1 text-sm font-medium">View all campaigns</p></div><ArrowRight size={17} className="transition group-hover:translate-x-1"/></Link>
    </section>

    <div className="grid gap-5 xl:grid-cols-[1.45fr_.8fr]">
      <SectionCard title="Your campaigns" description="See each plan’s current status and continue where you left off.">
        {loadError ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p>Campaigns could not load.</p><button type="button" onClick={() => window.location.reload()} className="mt-2 font-medium underline underline-offset-4">Try again</button></div> : loading ? <div className="space-y-3 py-3" aria-label="Loading campaigns"><div className="h-12 animate-pulse rounded-lg bg-neutral-100"/><div className="h-12 animate-pulse rounded-lg bg-neutral-100"/></div> : campaigns.length ? <div className="divide-y divide-neutral-200">{campaigns.slice(0, 5).map(campaign => <Link href={`/campaigns/${campaign.id}`} key={campaign.id} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-1"><div className="min-w-0"><p className="truncate text-sm font-medium">{campaign.name}</p><p className="mt-1 text-xs text-neutral-500">{campaign.startsAt ? new Date(campaign.startsAt).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "Dates to be confirmed"}</p></div><StatusBadge>{campaign.status.replaceAll("_", " ")}</StatusBadge></Link>)}</div> : <EmptyState title="Your first campaign starts with a plan." description="Choose an area, dates and budget. We’ll review inventory and confirm the next steps with you." action={<PrimaryButton href="/campaigns/new">Build your first plan<ArrowRight className="ml-3" size={15}/></PrimaryButton>}/>}
      </SectionCard>

      <SectionCard title="A simple way to start" description="You can save a plan before uploading artwork.">
        <ol className="space-y-4">{nextSteps.map((step, index) => <li key={step.title} className="flex gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-neutral-200 bg-[#fafaf8]"><step.icon size={16}/></span><div><Link href={step.href} className="text-sm font-medium underline decoration-transparent underline-offset-4 hover:decoration-current">{index + 1}. {step.title}</Link><p className="mt-1 text-xs leading-5 text-neutral-500">{step.detail}</p></div></li>)}</ol>
        <div className="mt-5 rounded-lg bg-[#f4f5e8] p-3.5 text-xs leading-5 text-neutral-700"><CircleHelp size={14} className="mr-2 inline-block align-[-2px]"/>A plan is a request, not a confirmed booking. OORO reviews screen availability and terms before launch.</div>
        <Link href="/campaigns/new" className="mt-5 inline-flex items-center gap-2 text-sm font-medium">Start planning<ArrowRight size={15}/></Link>
      </SectionCard>
    </div>
  </div>;
}
