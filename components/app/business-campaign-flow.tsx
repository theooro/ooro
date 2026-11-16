"use client";

import { useEffect, useState } from "react";
import { PageHeader, PrimaryButton } from "./app-ui";
import { PLANNING_AUTO_DAY_RATE_RUPEES } from "@/lib/campaign-policy";

type Draft = { name: string; start: string; end: string; autos: string; creativeId?: string; creativeName?: string; campaignId?: string };
const initial: Draft = { name: "", start: "", end: "", autos: "1" };

export function BusinessCampaignFlow() {
  const [draft, setDraft] = useState<Draft>(initial);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const requestedAutos = Number(draft.autos);
  const campaignDays = draft.start && draft.end && draft.end >= draft.start
    ? Math.floor((Date.UTC(Number(draft.end.slice(0, 4)), Number(draft.end.slice(5, 7)) - 1, Number(draft.end.slice(8, 10))) - Date.UTC(Number(draft.start.slice(0, 4)), Number(draft.start.slice(5, 7)) - 1, Number(draft.start.slice(8, 10)))) / 86400000) + 1
    : 0;
  const estimate = requestedAutos * campaignDays * PLANNING_AUTO_DAY_RATE_RUPEES;
  const valid = Boolean(draft.name.trim() && draft.start && draft.end && draft.end >= draft.start && Number.isInteger(requestedAutos) && requestedAutos >= 1 && requestedAutos <= 500);
  const set = (key: keyof Draft, value: string) => setDraft(current => ({ ...current, [key]: value }));

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("ooro.campaign-draft");
      if (!raw) return;
      const previous = JSON.parse(raw) as Record<string, unknown>;
      setDraft(current => ({
        ...current,
        start: typeof previous.start === "string" ? previous.start : current.start,
        end: typeof previous.end === "string" ? previous.end : current.end,
      }));
      window.localStorage.removeItem("ooro.campaign-draft");
    } catch { /* An old or invalid local draft must not block a new brief. */ }
  }, []);

  const persist = async () => {
    const payload = {
      name: draft.name,
      description: "Business campaign brief",
      goal: "Reach",
      audience: "Local customers",
      city: "Bengaluru",
      area: "Bengaluru",
      startDate: draft.start,
      endDate: draft.end,
      currency: "INR",
      campaignCenterLat: null,
      campaignCenterLng: null,
      radiusKm: null,
      metadata: {
        timezone: "Asia/Kolkata",
        target: { mode: "CITYWIDE", city: "Bengaluru" },
        planningEstimate: { autos: requestedAutos, days: campaignDays, ratePerAutoPerDay: PLANNING_AUTO_DAY_RATE_RUPEES, amount: estimate, currency: "INR" },
      },
    };
    const response = await fetch(draft.campaignId ? `/api/campaigns/${draft.campaignId}` : "/api/campaigns", {
      method: draft.campaignId ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error?.message ?? "Campaign could not be saved");
    setDraft(current => ({ ...current, campaignId: current.campaignId ?? body.data.id }));
    return draft.campaignId ?? body.data.id as string;
  };

  async function upload(file: File) {
    if (file.size > 100 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"].includes(file.type)) {
      throw new Error("Use JPG, PNG, WebP, MP4 or WebM under 100 MB.");
    }
    const id = await persist();
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
    const response = await fetch(`/api/campaigns/${id}/creative`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName: file.name, mimeType: file.type, base64: btoa(binary), durationSeconds: file.type.startsWith("video/") ? 15 : 10 }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error?.message ?? "Creative upload failed");
    setDraft(current => ({ ...current, creativeId: body.data.creativeId, creativeName: file.name }));
    setMessage("Creative uploaded and saved to this campaign brief.");
  }

  async function submit() {
    if (!valid || busy) return;
    setBusy(true); setMessage(""); setError("");
    try {
      await persist();
      setMessage("Campaign brief submitted for OORO review. OORO will confirm available autos, final pricing and delivery before booking.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Campaign could not be saved");
    } finally { setBusy(false); }
  }

  async function submitCreative() {
    if (!selectedFile || !valid || busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await upload(selectedFile); setSelectedFile(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Creative could not be saved"); }
    finally { setBusy(false); }
  }

  return <div className="space-y-8">
    <PageHeader eyebrow="Business campaign" title="Create campaign" description="Share your Bengaluru campaign dates and creative. OORO will confirm eligible screens and commercial terms before delivery." />
    <div className="space-y-6 border bg-white p-5 sm:p-8">
      <label className="block text-sm">Campaign name<input value={draft.name} onChange={event => set("name", event.target.value)} className="mt-2 w-full rounded border px-3 py-3" /></label>
      <section className="rounded-lg border border-neutral-200 bg-[#fafaf8] p-4" aria-labelledby="campaign-creative-title">
        <h2 id="campaign-creative-title" className="text-sm font-medium">Advertisement creative <span className="font-normal text-neutral-500">(optional until review)</span></h2>
        <p className="mt-1 text-xs leading-5 text-neutral-500">You can submit a brief first and add artwork later. Choosing a file does not submit or activate a campaign.</p>
        <label className="mt-3 block text-xs font-medium">Choose image or video<input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" onChange={event => setSelectedFile(event.target.files?.[0] || null)} className="mt-2 block w-full rounded border px-3 py-3" /></label>
        <p className="mt-2 break-all text-xs text-neutral-600">{selectedFile ? `${selectedFile.name} · ${(selectedFile.size / 1048576).toFixed(1)} MB` : draft.creativeName ? `Uploaded: ${draft.creativeName}` : "No creative selected."}</p>
        {selectedFile && <button type="button" disabled={!valid || busy} onClick={() => void submitCreative()} className="mt-3 rounded-md bg-black px-4 py-2.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">{busy ? "Uploading…" : "Upload creative to campaign"}</button>}
        {selectedFile && !valid && <p className="mt-2 text-xs text-amber-800">Add a campaign name and valid dates before uploading.</p>}
      </section>
      <div className="rounded-lg border border-neutral-200 bg-[#fafaf8] p-4">
        <p className="text-sm font-medium">Campaign coverage</p>
        <p className="mt-1 text-sm">Bengaluru network · citywide request</p>
        <p className="mt-2 text-xs leading-5 text-neutral-500">Radius targeting is not available. OORO confirms participating autos and coverage during operational review.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">Start date<input type="date" value={draft.start} onChange={event => set("start", event.target.value)} className="mt-2 w-full rounded border px-3 py-3" /></label>
        <label className="text-sm">End date<input type="date" value={draft.end} onChange={event => set("end", event.target.value)} className="mt-2 w-full rounded border px-3 py-3" /></label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">Requested autos<input type="number" min="1" max="500" step="1" value={draft.autos} onChange={event => set("autos", event.target.value)} className="mt-2 w-full rounded border px-3 py-3"/><span className="mt-1 block text-xs text-neutral-500">A planning request; final availability is confirmed by OORO.</span></label>
        <div className="rounded-lg border border-neutral-200 bg-[#fafaf8] px-4 py-3">
          <p className="text-xs text-neutral-500">Indicative planning estimate</p>
          <p className="mt-2 text-2xl font-medium">{campaignDays > 0 && valid ? `₹${estimate.toLocaleString("en-IN")}` : "Add dates and autos"}</p>
          <p className="mt-1 text-xs text-neutral-500">₹{PLANNING_AUTO_DAY_RATE_RUPEES} × {requestedAutos || 0} autos × {campaignDays} days</p>
        </div>
      </div>
      <div className="rounded-lg border border-neutral-200 px-4 py-3 text-sm text-neutral-600">
        Estimate only. This brief does not collect payment or guarantee vehicle availability or a booking. OORO confirms final inventory and commercial terms before launch.
      </div>
      {error && <p role="alert" className="border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {message && <p role="status" className="border border-amber-200 bg-amber-50 p-3 text-sm">{message}</p>}
      <PrimaryButton onClick={() => void submit()} disabled={!valid || busy}>{busy ? "Saving…" : "Submit for operational review"}</PrimaryButton>
    </div>
  </div>;
}
