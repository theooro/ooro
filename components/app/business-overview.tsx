"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EmptyState, PageHeader, SectionCard, StatusBadge } from "./app-ui";

type Campaign = { id: string; name: string; status: string };
type CreativeAnalytics = { id: string; name: string; brandName: string | null; status: string; verifiedPlays: number; completedPlays: number; qrScans: number };
type AnalyticsCampaign = { id: string; name: string; status: string; creativeCount: number; verifiedPlays: number; creatives: CreativeAnalytics[] };
type AnalyticsData = { campaigns: AnalyticsCampaign[]; summary: { campaigns: number; creatives: number; verifiedPlays: number; qrScans: number } };

export function BusinessAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = () => {
    setLoading(true); setError("");
    void fetch("/api/analytics", { cache: "no-store" })
      .then(async response => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error?.message || "Analytics could not be loaded");
        setData(payload?.data ?? null);
      })
      .catch(caught => setError(caught instanceof Error ? caught.message : "Analytics could not be loaded"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  return <div className="space-y-8">
    <PageHeader title="Analytics" description="Verified playback and QR engagement for campaigns and creatives owned by your account. Brand accounts see data from their verified organisation only." />
    {error ? <div role="alert" className="flex items-center justify-between gap-4 border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}<button type="button" onClick={load} className="font-medium underline">Retry</button></div> : loading || !data ? <p className="border border-neutral-200 bg-white p-5 text-sm text-neutral-500">Loading your campaign analytics…</p> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        ["Campaigns", data.summary.campaigns],
        ["Your creatives", data.summary.creatives],
        ["Verified plays", data.summary.verifiedPlays],
        ["QR scans", data.summary.qrScans],
      ].map(([label, value]) => <div className="border border-neutral-200 bg-white p-5" key={label}><p className="text-xs text-neutral-500">{label}</p><p className="mt-3 text-3xl font-medium">{Number(value).toLocaleString("en-IN")}</p></div>)}</div>
      {data.campaigns.length ? <div className="space-y-5">{data.campaigns.map(campaign => <SectionCard key={campaign.id} title={campaign.name} description={`${campaign.status.replaceAll("_", " ")} · ${campaign.creativeCount} creative${campaign.creativeCount === 1 ? "" : "s"}`}>
        {campaign.creatives.length ? <div className="divide-y divide-neutral-100">{campaign.creatives.map(creative => <div key={creative.id} className="grid gap-3 py-4 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center">
          <div className="min-w-0"><p className="truncate text-sm font-medium">{creative.name}</p><p className="mt-1 text-xs text-neutral-500">{creative.brandName || "Campaign creative"} · {creative.status.replaceAll("_", " ")}</p></div>
          <Metric label="Verified plays" value={creative.verifiedPlays}/>
          <Metric label="Completed plays" value={creative.completedPlays}/>
          <Metric label="QR scans" value={creative.qrScans}/>
        </div>)}</div> : <p className="text-sm text-neutral-500">No creatives are attached to this campaign yet.</p>}
        <Link href={`/campaigns/${campaign.id}`} className="mt-4 inline-block text-sm underline underline-offset-4">Open campaign details</Link>
      </SectionCard>)}</div> : <EmptyState title="No creative analytics yet." description="Campaign and creative results will appear here when OORO records playback or QR engagement." action={<Link href="/campaigns/new" className="inline-flex rounded-md bg-black px-4 py-2.5 text-sm font-medium text-white">Plan a campaign</Link>} />}
    </>}
  </div>;
}

export function BusinessReports() { return <BusinessCampaignSummary title="Reports" description="Campaign reporting based on verified delivery events."/>; }
function BusinessCampaignSummary({ title, description }: { title: string; description: string }) { const [campaigns, setCampaigns] = useState<Campaign[]>([]); useEffect(() => { void fetch("/api/campaigns", { cache: "no-store" }).then(response => response.ok ? response.json() : null).then(payload => setCampaigns(Array.isArray(payload?.data) ? payload.data : [])).catch(() => setCampaigns([])); }, []); return <div className="space-y-8"><PageHeader title={title} description={description}/><SectionCard title="Campaigns">{campaigns.length ? <div className="divide-y">{campaigns.map(campaign => <Link href={`/campaigns/${campaign.id}`} className="flex items-center justify-between gap-4 py-4 first:pt-0" key={campaign.id}><span className="font-medium">{campaign.name}</span><StatusBadge>{campaign.status.replaceAll("_", " ")}</StatusBadge></Link>)}</div> : <EmptyState title="No campaigns yet." description="Create a campaign to see its status here."/>}</SectionCard></div>; }

function Metric({ label, value }: { label: string; value: number }) { return <div className="min-w-24 sm:text-right"><p className="text-[11px] text-neutral-500">{label}</p><p className="mt-1 text-sm font-medium">{value.toLocaleString("en-IN")}</p></div>; }
