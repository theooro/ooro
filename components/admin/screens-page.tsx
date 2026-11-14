"use client";
import Link from "next/link";
import { Plus, Search, Unplug } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog, PageHeader, PrimaryButton, SectionCard } from "@/components/app/app-ui";
import { AdminSubnav, ConnectivityStatus, HealthBanner, LiveCreativePreview, RelativeTime } from "./admin-ui";
import { deviceCommandRepository, isMockDeviceData, screenRepository } from "@/lib/admin/repositories";
import type { ConnectivityStatus as Connectivity, Screen } from "@/lib/admin/types";

type FleetView = "ALL" | "ATTENTION" | "PLAYING";

export function ScreensPage({ canManage = false }: { canManage?: boolean }) {
  const [screens, setScreens] = useState<Screen[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Connectivity | "">("");
  const [updateStatus, setUpdateStatus] = useState<Screen["playerUpdateStatus"] | "">("");
  const [fleetView, setFleetView] = useState<FleetView>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [unpairing, setUnpairing] = useState<Screen | null>(null);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [page, setPage] = useState(0);

  const load = () => {
    setLoading(true);
    setError("");
    screenRepository.listScreens().then(setScreens).catch(caught => setError(caught instanceof Error ? caught.message : "Unable to load screen fleet.")).finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    const refresh = window.setInterval(load, 60_000);
    const tick = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => { window.clearInterval(refresh); window.clearInterval(tick); };
  }, []);
  useEffect(() => setPage(0), [query, status, updateStatus, fleetView]);

  const filtered = useMemo(() => screens.filter(screen => {
    const text = `${screen.screenName} ${screen.screenId} ${screen.deviceId} ${screen.vehicleId ?? ""} ${screen.vehicleIdentifier ?? ""} ${screen.city} ${screen.area}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase())) && (!status || (screen.connectivity ?? "NEVER_CONNECTED") === status) && (!updateStatus || screen.playerUpdateStatus === updateStatus) &&
      (fleetView === "ALL" || (fleetView === "ATTENTION" ? needsAttention(screen) : screen.playbackState === "PLAYING" && hasVerifiedCreative(screen, clock)));
  }), [clock, fleetView, query, screens, status, updateStatus]);
  const live = screens.filter(screen => screen.playbackState === "PLAYING" && hasVerifiedCreative(screen, clock));
  const attentionCount = screens.filter(needsAttention).length;
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);
  useEffect(() => setPage(current => Math.min(current, pageCount - 1)), [pageCount]);

  async function queueUnpair() {
    if (!unpairing || busy) return;
    setBusy(true);
    setError("");
    try {
      if (isMockDeviceData) {
        await deviceCommandRepository.createCommand(unpairing.screenId, "UNPAIR");
      } else {
        const response = await fetch(`/api/admin/screens/${unpairing.screenId}/unpair`, { method: "POST" });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error?.message ?? "Unable to unpair screen.");
        setScreens(current => current.map(screen => screen.screenId === unpairing.screenId ? { ...screen, pairingStatus: "UNPAIRED" } : screen));
      }
      setNotice(`${unpairing.screenName} is removed from campaign delivery. Its local credential clears the next time it connects.`);
      setUnpairing(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to queue unpair request.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="space-y-7">
    <PageHeader title="Screen fleet" description="See which screens need attention, what each has recently verified, and where to take action." action={<PrimaryButton href="/admin/screens/new"><Plus size={15} className="mr-2"/>Add screen</PrimaryButton>}/>
    <HealthBanner mock={isMockDeviceData}/>
    <AdminSubnav/>
    <section aria-label="Fleet overview" className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Quick fleet filters">
        {([["ALL", "All screens", screens.length], ["ATTENTION", "Needs attention", attentionCount], ["PLAYING", "Verified playing", live.length]] as const).map(([value, label, count]) => <button key={value} type="button" aria-pressed={fleetView === value} onClick={() => setFleetView(value)} className={`min-h-10 rounded-lg border px-3 py-2 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black ${fleetView === value ? "border-[var(--brand-yellow)] bg-[var(--brand-yellow)] font-medium text-black" : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400"}`}>
          {label}<span className="ml-2 tabular-nums opacity-70">{loading || error ? "—" : count}</span>
        </button>)}
      </div>
      <p className="text-xs leading-5 text-neutral-500">“Needs attention” includes offline or stale screens, player errors, and available updates.</p>
    </section>
    <SectionCard title={fleetView === "ALL" ? "Screens" : fleetView === "ATTENTION" ? "Screens needing attention" : "Verified playing now"} description="Playback is verified only when a recent device report matches proof-of-play. Offline or stale screens are never shown as live.">
      {notice && <p role="status" className="mb-4 rounded-xl border border-lime-200 bg-lime-50 px-4 py-3 text-sm text-lime-950">{notice}</p>}
      {error ? <div role="alert" className="flex items-center justify-between gap-4 py-12 text-sm"><span className="text-red-700">{error}</span><button type="button" onClick={load} className="underline underline-offset-4">Retry</button></div> : <>
        <div className="mb-5 flex flex-col gap-3 lg:flex-row">
          <label className="relative min-w-0 flex-1"><span className="mb-1.5 block text-xs font-medium text-neutral-600">Find a screen</span><Search size={15} className="absolute left-3 top-[2.65rem] text-neutral-400"/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, screen ID, vehicle, city or area" className="min-h-11 w-full rounded-xl border border-neutral-300 bg-white py-2.5 pl-9 pr-3 text-base outline-none focus:border-black focus:ring-2 focus:ring-black/10 sm:text-sm"/></label>
          <label className="lg:w-48"><span className="mb-1.5 block text-xs font-medium text-neutral-600">Connection</span><select value={status} onChange={event => setStatus(event.target.value as Connectivity | "")} className="min-h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-base outline-none focus:border-black focus:ring-2 focus:ring-black/10 sm:text-sm"><option value="">Any status</option><option value="ONLINE">Online</option><option value="STALE">Stale</option><option value="OFFLINE">Offline</option><option value="NEVER_CONNECTED">Never connected</option></select></label>
          <label className="lg:w-48"><span className="mb-1.5 block text-xs font-medium text-neutral-600">Player update</span><select value={updateStatus} onChange={event => setUpdateStatus(event.target.value as Screen["playerUpdateStatus"] | "")} className="min-h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-base outline-none focus:border-black focus:ring-2 focus:ring-black/10 sm:text-sm"><option value="">Any version status</option><option value="UPDATE_AVAILABLE">Update available</option><option value="UP_TO_DATE">Up to date</option><option value="UNKNOWN">Unverified</option></select></label>
          {(query || status || updateStatus || fleetView !== "ALL") && <button type="button" onClick={() => { setQuery(""); setStatus(""); setUpdateStatus(""); setFleetView("ALL"); }} className="self-end rounded-lg px-3 py-2.5 text-sm font-medium text-neutral-600 underline underline-offset-4 hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">Clear filters</button>}
        </div>
        {loading ? <div role="status" aria-live="polite" className="py-12 text-center text-sm text-neutral-500">Loading screen fleet…</div> : filtered.length ? <>
          <p className="mb-3 text-xs text-neutral-500" aria-live="polite">Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length} screens</p>
          <div className="grid gap-3 md:hidden">{visible.map(screen => <ScreenCard key={screen.screenId} screen={screen} clock={clock} canManage={canManage} onUnpair={setUnpairing}/>)}</div>
          <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[1430px] border-collapse text-left"><thead><tr className="border-y border-neutral-200 text-[10px] uppercase tracking-[.12em] text-neutral-400">{["Screen", "Latest verified play", "Connection / check-in", "App / update", "Layout / version", "Last sync", "Proof / command", ...(canManage ? ["Actions"] : [])].map(label => <th className="px-3 py-3 font-medium first:pl-0" key={label}>{label}</th>)}</tr></thead><tbody className="divide-y divide-neutral-100">{visible.map(screen => <ScreenRow key={screen.screenId} screen={screen} clock={clock} canManage={canManage} onUnpair={setUnpairing}/>)}</tbody></table></div>
          {pageCount > 1 && <nav aria-label="Screen fleet pages" className="mt-5 flex items-center justify-between border-t border-neutral-200 pt-5 text-sm"><button type="button" disabled={page === 0} onClick={() => setPage(current => Math.max(0, current - 1))} className="rounded-lg px-3 py-2 font-medium hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40">Previous</button><span className="text-neutral-500">{page * pageSize + 1}–{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length}</span><button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage(current => Math.min(pageCount - 1, current + 1))} className="rounded-lg px-3 py-2 font-medium hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40">Next</button></nav>}
        </> : <div className="py-12 text-center"><p className="text-sm font-medium">{screens.length ? "No screens match these filters." : "No screens connected yet."}</p><p className="mt-2 text-sm text-neutral-500">{screens.length ? "Try a different search or status." : "Add your first OORO screen to begin building the network."}</p>{!screens.length && <div className="mt-5"><PrimaryButton href="/admin/screens/new"><Plus size={15} className="mr-2"/>Add screen</PrimaryButton></div>}</div>}
      </>}
    </SectionCard>
    {unpairing && <ConfirmDialog title={`Unpair ${unpairing.screenName}?`} description="The screen is removed from campaign delivery immediately. Its local player credential is cleared the next time it connects; history is preserved." confirmLabel={busy ? "Unpairing…" : "Unpair now"} tone="danger" onClose={() => !busy && setUnpairing(null)} onConfirm={() => void queueUnpair()}/>}
  </div>;
}

function isVerified(screen: Screen, clock: number) {
  const age = screen.lastHeartbeatAt ? clock - new Date(screen.lastHeartbeatAt).getTime() : Number.POSITIVE_INFINITY;
  return screen.connectivity === "ONLINE" && age >= -30_000 && age <= 120_000;
}
function hasVerifiedCreative(screen: Screen, clock: number) { return isVerified(screen, clock) && screen.currentCreativeTrust === "VERIFIED_RECENT_PROOF"; }
function needsAttention(screen: Screen) { return ["STALE", "OFFLINE", "NEVER_CONNECTED"].includes(screen.connectivity ?? "NEVER_CONNECTED") || ["FAILED", "ERROR"].includes(screen.playbackState ?? "") || screen.playerUpdateStatus === "UPDATE_AVAILABLE"; }
function preview(screen: Screen) { return { name: screen.currentCreativeName, url: screen.currentCreativeUrl, mimeType: screen.currentCreativeMimeType, fileName: screen.currentCreativeFileName }; }
function ScreenRow({ screen, clock, canManage, onUnpair }: { screen: Screen; clock: number; canManage: boolean; onUnpair: (screen: Screen) => void }) {
  const lastProof = screen.latestProof;
  const command = screen.latestCommand;
  return <tr className="align-middle transition-colors hover:bg-neutral-50"><td className="px-3 py-4 pl-0"><Link href={`/admin/screens/${screen.screenId}`} className="font-medium hover:underline">{screen.screenName}</Link><span className="mt-1 block text-xs text-neutral-500">{screen.vehicleIdentifier ?? screen.vehicleId ?? "No vehicle"} · {screen.area || screen.city}</span><span className="mt-1 block font-mono text-[10px] text-neutral-400">{screen.screenId}</span></td><td className="px-3 py-4"><div className="flex items-center gap-3"><LiveCreativePreview compact creative={preview(screen)} state={screen.playbackState} verified={hasVerifiedCreative(screen, clock)}/><div className="max-w-48"><p className="truncate text-xs font-medium">{hasVerifiedCreative(screen, clock) ? screen.currentCreativeName ?? screen.currentCreativeId : "Unknown"}</p><p className="mt-1 truncate text-[11px] text-neutral-500">{hasVerifiedCreative(screen, clock) ? screen.currentCampaignName ?? screen.currentCampaignId : "No fresh matching proof"}</p></div></div></td><td className="px-3 py-4 text-xs"><ConnectivityStatus status={screen.connectivity ?? "NEVER_CONNECTED"}/><span className="mt-1 block text-neutral-500">Check-in <RelativeTime value={screen.lastHeartbeatAt ?? undefined}/></span><span className="mt-1 block text-neutral-500">{screen.diagnostics?.networkType ?? "Network unknown"} · {screen.diagnostics?.networkConnected === false ? "Disconnected" : screen.diagnostics?.networkConnected ? "Connected" : "Unverified"}</span></td><td className="px-3 py-4 text-xs"><span className="block">{screen.appVersion ?? "Unknown"}</span><span className={`mt-1 block ${screen.playerUpdateStatus === "UPDATE_AVAILABLE" ? "text-amber-700" : "text-neutral-500"}`}>{screen.playerUpdateStatus === "UPDATE_AVAILABLE" ? "Update available" : screen.playerUpdateStatus === "UP_TO_DATE" ? "Up to date" : "Unverified"}</span></td><td className="px-3 py-4 text-xs"><span className="block">{screen.currentLayout ?? "Unknown"}</span><span className="mt-1 block text-neutral-500">{screen.layoutReportStatus === "STALE" ? "Last reported · stale" : screen.currentLayoutVersion == null ? "Version unverified" : `v${screen.currentLayoutVersion}`}</span></td><td className="px-3 py-4 text-xs">{screen.lastSuccessfulSync ? <RelativeTime value={screen.lastSuccessfulSync}/> : <span className="text-neutral-400">No acknowledged sync</span>}<span className="mt-1 block text-neutral-500">Manifest {screen.manifestVersion == null ? "unknown" : `v${screen.manifestVersion}`}</span></td><td className="px-3 py-4 text-xs"><span className="block">{lastProof ? `${lastProof.slot ?? "MAIN"} · ${lastProof.status ?? "unverified"}` : "No proof received"}</span><span className="mt-1 block text-neutral-500">{lastProof?.playbackStartedAt ? <RelativeTime value={lastProof.playbackStartedAt}/> : "—"}</span><span className="mt-2 block">{command ? `${command.type.replaceAll("_", " ")} · ${command.status.toLowerCase()}` : "No commands"}</span></td>{canManage && <td className="px-3 py-4"><div className="flex items-center gap-3 text-xs"><Link href={`/admin/screens/${screen.screenId}`} className="font-medium underline underline-offset-4">Manage</Link>{screen.pairingStatus === "PAIRED" && <button type="button" onClick={() => onUnpair(screen)} className="inline-flex items-center gap-1.5 font-medium text-amber-700 underline underline-offset-4"><Unplug size={13}/>Unpair</button>}</div></td>}</tr>;
}
function ScreenCard({ screen, clock, canManage, onUnpair }: { screen: Screen; clock: number; canManage: boolean; onUnpair: (screen: Screen) => void }) {
  return <article className="rounded-xl border border-neutral-200 p-4 transition hover:border-neutral-400"><Link href={`/admin/screens/${screen.screenId}`} className="block"><div className="flex items-start gap-3"><LiveCreativePreview compact creative={preview(screen)} state={screen.playbackState} verified={hasVerifiedCreative(screen, clock)}/><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div><p className="truncate text-sm font-semibold">{screen.screenName}</p><p className="mt-1 truncate text-xs text-neutral-500">{screen.vehicleIdentifier ?? "No vehicle"} · {screen.area}</p></div><ConnectivityStatus status={screen.connectivity ?? "NEVER_CONNECTED"}/></div><p className="mt-3 truncate text-xs font-medium">{hasVerifiedCreative(screen, clock) ? screen.currentCreativeName ?? screen.currentCreativeId : "Unknown · no fresh matching proof"}</p><p className="mt-1 text-xs text-neutral-500">Check-in <RelativeTime value={screen.lastHeartbeatAt ?? undefined}/></p><p className="mt-1 text-xs text-neutral-500">{screen.appVersion ?? "App unknown"} · {screen.playerUpdateStatus === "UPDATE_AVAILABLE" ? "update available" : screen.playerUpdateStatus === "UP_TO_DATE" ? "up to date" : "update unverified"}</p><p className="mt-1 text-xs text-neutral-500">Layout {screen.currentLayout ?? "unknown"} · {screen.layoutReportStatus === "STALE" ? "last reported · stale" : screen.currentLayoutVersion == null ? "version unverified" : `v${screen.currentLayoutVersion}`}</p></div></div></Link>{canManage && <div className="mt-4 flex gap-4 border-t border-neutral-200 pt-3">{screen.pairingStatus === "PAIRED" && <button type="button" onClick={() => onUnpair(screen)} className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 underline underline-offset-4"><Unplug size={13}/>Unpair</button>}<Link href={`/admin/screens/${screen.screenId}`} className="text-xs font-medium underline underline-offset-4">Manage screen</Link></div>}</article>;
}
