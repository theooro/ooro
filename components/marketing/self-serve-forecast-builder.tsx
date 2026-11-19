"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GeocodingResult } from "@/lib/geocoding";
import { MIN_SELF_SERVE_BUDGET_RUPEES } from "@/lib/campaign-policy";

const CampaignTargetMap = dynamic(() => import("./campaign-target-map").then(module => module.CampaignTargetMap), { ssr: false, loading: () => <div className="flex h-[230px] items-center justify-center rounded-[10px] border bg-[#e6ece0] text-xs text-neutral-500">Loading coverage map…</div> });
const FORECAST_HORIZON_DAYS = 30;
const STANDARD_AUTO_DAY_RATE = 59;
const AGENCY_AUTO_DAY_RATE = 49;
const PREMIUM_AUTO_DAY_RATE = 69;
const cities: Record<string, [number, number]> = { bengaluru: [12.9716, 77.5946], tirupati: [13.6288, 79.4192], hyderabad: [17.385, 78.4867], chennai: [13.0827, 80.2707], mumbai: [19.076, 72.8777], delhi: [28.6139, 77.209] };
type Forecast = { estimatedImpressionsLow: number; estimatedImpressionsHigh: number; campaignDays: number; availability: "AVAILABLE" | "LIMITED" | "UNSUPPORTED"; confidence: string; forecastVersion?: string; generatedAt?: string; forecastExpiresAt?: string };
const money = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;

export function SelfServeForecastBuilder() {
  const [location, setLocation] = useState("Bengaluru");
  const [selected, setSelected] = useState<GeocodingResult | null>(null);
  const [suggestions, setSuggestions] = useState<GeocodingResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [area, setArea] = useState("");
  const [radiusKm, setRadiusKm] = useState(3);
  const [tier, setTier] = useState<"STANDARD" | "PREMIUM_PLUS">("STANDARD");
  const [customerType, setCustomerType] = useState<"BRAND" | "AGENCY">("BRAND");
  const [autos, setAutos] = useState(5);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const locationInput = useRef<HTMLInputElement>(null);

  const unitRate = tier === "PREMIUM_PLUS" ? PREMIUM_AUTO_DAY_RATE : customerType === "AGENCY" ? AGENCY_AUTO_DAY_RATE : STANDARD_AUTO_DAY_RATE;
  const campaignDays = FORECAST_HORIZON_DAYS;
  const parsedBudget = unitRate * autos * campaignDays;
  const validAutos = Number.isInteger(autos) && autos >= 1;
  const validBudget = Number.isFinite(parsedBudget) && parsedBudget >= MIN_SELF_SERVE_BUDGET_RUPEES;

  // Never reinterpret an unknown advertiser address as Bengaluru: that would
  // produce a credible-looking forecast for the wrong physical location.
  const resolvedCenter = useMemo<[number, number] | null>(() => selected ? [selected.latitude, selected.longitude] : cities[location.trim().toLowerCase()] ?? null, [location, selected]);
  const locationResolved = Boolean(resolvedCenter && resolvedCenter.every(Number.isFinite));
  const center: [number, number] = resolvedCenter ?? cities.bengaluru;
  const key = `${location}|${area}|${radiusKm}|${tier}|${customerType}|${autos}|${parsedBudget}|${center.join(",")}`;

  useEffect(() => {
    if (selected?.formattedAddress === location || location.trim().length < 3) { setSuggestions([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/geocode/search?q=${encodeURIComponent(location.trim())}`, { signal: controller.signal });
        const body = await response.json();
        setSuggestions(response.ok ? body.data ?? [] : []);
      } catch { if (!controller.signal.aborted) setSuggestions([]); }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 350);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [location, selected]);
  useEffect(() => {
    if (!validAutos || !validBudget || !locationResolved) { setForecast(null); setError(""); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const response = await fetch("/api/campaigns/forecast", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ location, latitude: center[0], longitude: center[1], radiusKm, deliveryTier: tier, budget: parsedBudget }) });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(response.status === 503 ? "We couldn't calculate delivery right now. Please try again." : body?.error?.message || "Forecast unavailable");
        setForecast(body);
      } catch (caught) {
        if (!controller.signal.aborted) { setForecast(null); setError(caught instanceof Error ? caught.message : "Forecast unavailable"); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [key, retryNonce, validAutos, validBudget, locationResolved, location, radiusKm, tier, parsedBudget, center]);

  function launch() {
    if (!validAutos || !validBudget || !locationResolved) return;
    window.localStorage.setItem("ooro.campaign-draft", JSON.stringify({ city: selected?.city || location, area: selected?.locality || area, location, formattedLocation: selected?.formattedAddress || location, budget: parsedBudget.toFixed(2), autos, autoDayRate: unitRate, customerType, deliveryTier: tier, campaignCenterLat: center[0], campaignCenterLng: center[1], radiusKm, forecastSnapshot: forecast && forecast.availability !== "UNSUPPORTED" ? forecast : null, forecastGeneratedAt: forecast?.generatedAt, forecastExpiresAt: forecast?.forecastExpiresAt, forecastVersion: forecast?.forecastVersion }));
    window.location.href = "/signup?next=/campaigns/new";
  }
  const unsupported = forecast?.availability === "UNSUPPORTED";

  return <section className="border border-neutral-200 bg-white p-4 sm:p-8">
    <div className="grid gap-6 lg:grid-cols-[1.05fr_.95fr]">
      <div className="min-w-0 space-y-6">
        <CampaignTargetMap radiusKm={radiusKm} center={center}/>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="relative text-sm font-medium">Location or address<input ref={locationInput} value={location} onChange={event => { setLocation(event.target.value); setSelected(null); }} placeholder="Search a city, area or address" className="mt-2 block w-full rounded-[8px] border border-neutral-300 px-3 py-3"/>
            {(searching || suggestions.length > 0) && <div className="absolute left-0 right-0 top-full z-20 mt-1 border border-neutral-200 bg-white shadow-lg">{searching && <p className="p-3 text-xs text-neutral-500">Searching locations…</p>}{suggestions.map(result => <button type="button" key={`${result.latitude}-${result.longitude}-${result.formattedAddress}`} onClick={() => { setLocation(result.formattedAddress); setSelected(result); setSuggestions([]); }} className="block w-full px-3 py-3 text-left text-xs hover:bg-neutral-100">{result.formattedAddress}</button>)}</div>}
          </label>
          <label className="text-sm font-medium">Target area (optional)<input value={area} onChange={event => setArea(event.target.value)} placeholder="Neighbourhood or landmark" className="mt-2 block w-full rounded-[8px] border border-neutral-300 px-3 py-3"/></label>
        </div>
        <div><p className="text-sm font-medium">Coverage radius</p><div className="mt-3 flex flex-wrap gap-2">{[1, 2, 3, 5, 8, 10].map(value => <button key={value} type="button" aria-pressed={value === radiusKm} onClick={() => setRadiusKm(value)} className={`rounded-full border px-4 py-2 text-sm ${value === radiusKm ? "border-black bg-black text-white" : "border-neutral-300"}`}>{value} km</button>)}</div></div>

      </div>

      <div className="min-w-0 space-y-6 rounded-[10px] bg-[#111] p-5 text-white sm:p-7">
        <div><p className="text-xs uppercase tracking-[.18em] text-neutral-400">Build your campaign</p><h2 className="mt-2 text-2xl font-medium">Plan your campaign</h2><p className="mt-2 text-xs leading-5 text-neutral-400">Choose a delivery tier, auto count and location. The 30-day figure is a planning estimate, not a campaign delivery window.</p></div>
        <div><p className="text-sm font-medium">Who is planning this campaign?</p><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" aria-pressed={customerType === "BRAND"} onClick={() => setCustomerType("BRAND")} className={`min-h-10 rounded-lg border px-3 py-2 text-sm ${customerType === "BRAND" ? "border-white bg-white font-medium text-black" : "border-white/30 text-white"}`}>Brand · ₹59</button><button type="button" aria-pressed={customerType === "AGENCY"} onClick={() => setCustomerType("AGENCY")} className={`min-h-10 rounded-lg border px-3 py-2 text-sm ${customerType === "AGENCY" ? "border-white bg-white font-medium text-black" : "border-white/30 text-white"}`}>Agency · ₹49</button></div><p className="mt-2 text-xs text-neutral-400">Standard rate per auto per day. Agency pricing is for verified agency accounts.</p></div>
        <div><p className="text-sm font-medium">Delivery tier</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><TierButton selected={tier === "STANDARD"} onClick={() => setTier("STANDARD")} title="Standard" rate={customerType === "AGENCY" ? AGENCY_AUTO_DAY_RATE : STANDARD_AUTO_DAY_RATE} text="Flexible everyday delivery across eligible OORO inventory."/><TierButton selected={tier === "PREMIUM_PLUS"} onClick={() => setTier("PREMIUM_PLUS")} title="Premium+" rate={PREMIUM_AUTO_DAY_RATE} text="Priority access to premium OORO inventory." badge/></div></div>
        <label className="block text-sm font-medium">Number of autos<input inputMode="numeric" type="number" min="1" step="1" value={autos} onChange={event => setAutos(Number(event.target.value))} className="mt-2 block w-full rounded-[8px] border border-white/20 bg-white/10 px-3 py-3 text-xl text-white"/><span className="mt-1 block text-xs font-normal text-neutral-400">Enter how many auto screens you want included in the estimate.</span></label>
        {validAutos && validBudget && <div className="rounded-lg border border-white/15 bg-white/[.04] p-4"><p className="text-xs font-medium text-neutral-300">Indicative base media estimate</p><p className="mt-2 text-2xl font-semibold">{money(parsedBudget)}</p><p className="mt-1 text-xs leading-5 text-neutral-400">{money(unitRate)} × {autos} {autos === 1 ? "auto" : "autos"} × {campaignDays} days</p><p className="mt-3 border-t border-white/10 pt-3 text-xs leading-5 text-neutral-400">Planning estimate only. Campaign delivery has no start/end date or daily-hour window; OORO confirms budget, approval, state and delivery quota separately.</p></div>}
        {!validAutos && <p role="alert" className="text-sm text-[#f7df72]">Enter a whole number of autos, starting from 1.</p>}
        <div className="border-t border-white/15 pt-5">
          {loading ? <p role="status" className="text-sm text-neutral-400">Updating estimated delivery…</p> : error ? <div role="alert" className="space-y-3 text-sm text-[#f7df72]"><p>{error}</p><button type="button" onClick={() => setRetryNonce(value => value + 1)} className="rounded border border-[#f7df72]/50 px-3 py-2 text-xs text-[#f7df72]">Retry forecast</button></div> : unsupported ? <div className="space-y-3 text-sm text-neutral-300"><p>Confirmed delivery is not currently available for this location. You can still submit your requirements for a manual availability review.</p><button type="button" onClick={() => { locationInput.current?.focus(); locationInput.current?.select(); }} className="rounded border border-white/25 px-3 py-2 text-xs">Change location</button></div> : forecast ? <div className="grid gap-4 sm:grid-cols-2"><Metric label="Estimated passenger impressions" value={`${forecast.estimatedImpressionsLow.toLocaleString("en-IN")} – ${forecast.estimatedImpressionsHigh.toLocaleString("en-IN")}`}/><Metric label="Planning estimate horizon" value={`${forecast.campaignDays} days`}/><p className="col-span-full text-xs leading-5 text-neutral-400">Delivery is an indicative scenario based on model assumptions and the estimated media total. OORO confirms eligibility and final commercial terms before campaign activation.</p></div> : !locationResolved ? <p role="status" className="text-sm text-[#f7df72]">Choose a supported city or select a verified address suggestion. OORO cannot estimate delivery for an unverified location.</p> : <p className="text-sm text-neutral-400">Enter a valid auto count and a supported location to see the forecast.</p>}
        </div>
        <p className="text-xs leading-5 text-neutral-400">Availability and final pricing are confirmed before booking. This estimate does not guarantee screens, passenger impressions or campaign results.</p>
        <button type="button" disabled={!validAutos || !validBudget || !locationResolved} onClick={launch} className="w-full rounded-[8px] bg-[var(--brand-yellow)] px-4 py-3 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-50">{forecast && !unsupported ? "Continue to campaign request" : "Request manual availability review"}</button>
      </div>
    </div>
  </section>;
}

function TierButton({ selected, onClick, title, rate, text, badge = false }: { selected: boolean; onClick: () => void; title: string; rate: number; text: string; badge?: boolean }) {
  return <button type="button" aria-pressed={selected} onClick={onClick} className={`rounded-[8px] border p-4 text-left ${selected ? "border-white bg-white text-black" : "border-white/30"}`}><span className="block font-medium">{title}</span><span className="mt-1 block text-xs font-medium">{money(rate)}<span className="ml-1 font-normal opacity-70">/ auto / day</span></span><span className="mt-2 block text-xs opacity-70">{text}</span>{badge && <span className="mt-3 inline-block rounded-full bg-[var(--brand-yellow)] px-2 py-1 text-[10px] font-medium text-black">PLANNED PRIORITY</span>}</button>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div><p className="text-xs leading-4 text-neutral-400">{label}</p><p className="mt-1 text-xl font-medium">{value}</p></div>; }
