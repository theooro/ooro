"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GeocodingResult } from "@/lib/geocoding";
import { MIN_SELF_SERVE_BUDGET_RUPEES } from "@/lib/campaign-policy";

const CampaignTargetMap = dynamic(() => import("./campaign-target-map").then(module => module.CampaignTargetMap), { ssr: false, loading: () => <div className="flex h-[230px] items-center justify-center rounded-[10px] border bg-[#e6ece0] text-xs text-neutral-500">Loading coverage map…</div> });
const quickBudgets = [500, 1000, 2500, 5000, 10000];
const MIN_CAMPAIGN_DAYS = 30;
function addDays(dateValue: string, count: number) {
  if (!dateValue) return "";
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
function countCampaignDays(start: string, end: string) {
  if (!start || !end) return 0;
  return Math.floor((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86400000) + 1;
}
function currentIndiaDate() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
const cities: Record<string, [number, number]> = { bengaluru: [12.9716, 77.5946], tirupati: [13.6288, 79.4192], hyderabad: [17.385, 78.4867], chennai: [13.0827, 80.2707], mumbai: [19.076, 72.8777], delhi: [28.6139, 77.209] };
type Forecast = { estimatedImpressionsLow: number; estimatedImpressionsHigh: number; campaignDays: number; availability: "AVAILABLE" | "LIMITED" | "UNSUPPORTED"; confidence: string; forecastVersion?: string; generatedAt?: string; forecastExpiresAt?: string };
const money = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;

export function SelfServeForecastBuilder() {
  const [location, setLocation] = useState("Bengaluru"); const [selected, setSelected] = useState<GeocodingResult | null>(null); const [suggestions, setSuggestions] = useState<GeocodingResult[]>([]); const [searching, setSearching] = useState(false);
  const [today, setToday] = useState("");
  const [area, setArea] = useState(""); const [radiusKm, setRadiusKm] = useState(3); const [startDate, setStartDate] = useState(""); const [endDate, setEndDate] = useState(""); const [tier, setTier] = useState<"STANDARD" | "PREMIUM_PLUS">("STANDARD"); const [budget, setBudget] = useState("3000");
  const [forecast, setForecast] = useState<Forecast | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const [retryNonce, setRetryNonce] = useState(0);
  const locationInput = useRef<HTMLInputElement>(null);
  const parsedBudget = Number(budget);
  const campaignDays = countCampaignDays(startDate, endDate);
  const minimumEndDate = startDate ? addDays(startDate, MIN_CAMPAIGN_DAYS - 1) : today;
  const validDates = Boolean(today && startDate && endDate && startDate >= today && endDate >= minimumEndDate);
  const ratePerAutoPerDay = tier === "PREMIUM_PLUS" ? 69 : 59;
  const billableDays = Math.max(MIN_CAMPAIGN_DAYS, campaignDays);
  const oneAutoMinimum = ratePerAutoPerDay * billableDays;
  const minimumBudget = Math.max(MIN_SELF_SERVE_BUDGET_RUPEES, oneAutoMinimum);
  const validBudget = Number.isFinite(parsedBudget) && parsedBudget >= minimumBudget;
  const autoMonthsCovered = validBudget && campaignDays >= MIN_CAMPAIGN_DAYS ? Math.floor(parsedBudget / (ratePerAutoPerDay * campaignDays)) : 0;
  // Never reinterpret an unknown advertiser address as Bengaluru: that would
  // produce a credible-looking forecast for the wrong physical location.
  const resolvedCenter = useMemo<[number, number] | null>(() => selected ? [selected.latitude, selected.longitude] : cities[location.trim().toLowerCase()] ?? null, [location, selected]);
  const locationResolved = Boolean(resolvedCenter && resolvedCenter.every(Number.isFinite));
  const center: [number, number] = resolvedCenter ?? cities.bengaluru;
  const key = `${location}|${area}|${radiusKm}|${startDate}|${endDate}|${tier}|${budget}|${center.join(",")}`;

  useEffect(() => {
    // Compute on the browser, not when Next.js builds the page. Refresh after
    // the tab returns to foreground so an old open tab cannot submit past dates.
    const refreshDate = () => {
      const localDay = currentIndiaDate();
      setToday(localDay);
      setStartDate(previous => previous && previous >= localDay ? previous : localDay);
      const minimumEnd = addDays(localDay, MIN_CAMPAIGN_DAYS - 1);
      setEndDate(previous => previous && previous >= minimumEnd ? previous : minimumEnd);
    };
    refreshDate();
    window.addEventListener("focus", refreshDate);
    document.addEventListener("visibilitychange", refreshDate);
    return () => { window.removeEventListener("focus", refreshDate); document.removeEventListener("visibilitychange", refreshDate); };
  }, []);
  useEffect(() => { if (selected?.formattedAddress === location || location.trim().length < 3) { setSuggestions([]); return; } const controller = new AbortController(); const timer = window.setTimeout(async () => { setSearching(true); try { const response = await fetch(`/api/geocode/search?q=${encodeURIComponent(location.trim())}`, { signal: controller.signal }); const body = await response.json(); setSuggestions(response.ok ? body.data ?? [] : []); } catch { if (!controller.signal.aborted) setSuggestions([]); } finally { if (!controller.signal.aborted) setSearching(false); } }, 350); return () => { controller.abort(); window.clearTimeout(timer); }; }, [location, selected]);
  useEffect(() => { if (!validBudget || !validDates || !locationResolved) { setForecast(null); setError(""); return; } const controller = new AbortController(); const timer = window.setTimeout(async () => { setLoading(true); setError(""); try { const response = await fetch("/api/campaigns/forecast", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ location, latitude: center[0], longitude: center[1], radiusKm, startDate, endDate, deliveryTier: tier, budget: parsedBudget }) }); const body = await response.json().catch(() => null); if (!response.ok) throw new Error(response.status === 503 ? "We couldn't calculate delivery right now. Please try again." : body?.error?.message || "Forecast unavailable"); setForecast(body); } catch (caught) { if (!controller.signal.aborted) { setForecast(null); setError(caught instanceof Error ? caught.message : "Forecast unavailable"); } } finally { if (!controller.signal.aborted) setLoading(false); } }, 250); return () => { controller.abort(); window.clearTimeout(timer); }; }, [key, retryNonce, validBudget, validDates, locationResolved, location, radiusKm, startDate, endDate, tier, parsedBudget, center]);
  function launch() { if (!validBudget || !validDates || !locationResolved) return; window.localStorage.setItem("ooro.campaign-draft", JSON.stringify({ city: selected?.city || location, area: selected?.locality || area, location, formattedLocation: selected?.formattedAddress || location, start: startDate, end: endDate, budget: parsedBudget.toFixed(2), deliveryTier: tier, campaignCenterLat: center[0], campaignCenterLng: center[1], radiusKm, forecastSnapshot: forecast && forecast.availability !== "UNSUPPORTED" ? forecast : null, forecastGeneratedAt: forecast?.generatedAt, forecastExpiresAt: forecast?.forecastExpiresAt, forecastVersion: forecast?.forecastVersion })); window.location.href = "/signup?next=/campaigns/new"; }
  const unsupported = forecast?.availability === "UNSUPPORTED";
  const manualReview = unsupported || Boolean(error);

  return (
    <section aria-label="OORO campaign planner" className="scroll-mt-24 border border-neutral-200 bg-white p-4 sm:p-6 lg:p-8">
      <div className="grid items-start gap-6 md:grid-cols-[1.05fr_.95fr] lg:gap-8">
        <div className="min-w-0 space-y-6">
          <CampaignTargetMap radiusKm={radiusKm} center={center} />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="relative text-sm font-medium">
              Location or address
              <input ref={locationInput} value={location} onChange={event => { setLocation(event.target.value); setSelected(null); }} placeholder="Search a city, area or address" aria-autocomplete="list" aria-expanded={searching || suggestions.length > 0} className="mt-2 block min-h-12 w-full rounded-[8px] border border-neutral-300 px-3 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#829d00]" />
              {(searching || suggestions.length > 0) && <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-lg">
                {searching && <p role="status" className="p-3 text-xs text-neutral-500">Searching locations…</p>}
                {suggestions.map(result => <button type="button" key={`${result.latitude}-${result.longitude}-${result.formattedAddress}`} onClick={() => { setLocation(result.formattedAddress); setSelected(result); setSuggestions([]); }} className="block min-h-11 w-full px-3 py-3 text-left text-xs hover:bg-neutral-100 focus-visible:bg-neutral-100 focus-visible:outline-none">{result.formattedAddress}</button>)}
              </div>}
            </label>
            <label className="text-sm font-medium">Target area <span className="font-normal text-neutral-500">(optional)</span>
              <input value={area} onChange={event => setArea(event.target.value)} placeholder="Neighbourhood or landmark" className="mt-2 block min-h-12 w-full rounded-[8px] border border-neutral-300 px-3 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#829d00]" />
            </label>
          </div>
          <div>
            <p className="text-sm font-medium">Coverage radius</p>
            <div className="mt-3 flex flex-wrap gap-2">{[1, 2, 3, 5, 8, 10].map(value => <button key={value} type="button" aria-pressed={value === radiusKm} onClick={() => setRadiusKm(value)} className={`min-h-10 rounded-full border px-4 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#829d00] ${value === radiusKm ? "border-black bg-black text-white" : "border-neutral-300 hover:bg-neutral-100"}`}>{value} km</button>)}</div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">Start date
              <input type="date" min={today} value={startDate} onChange={event => { const nextStart = event.target.value; const nextEndMinimum = addDays(nextStart, MIN_CAMPAIGN_DAYS - 1); setStartDate(nextStart); if (!endDate || endDate < nextEndMinimum) setEndDate(nextEndMinimum); }} className="mt-2 block min-h-12 w-full rounded-[8px] border border-neutral-300 px-3 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#829d00]" />
            </label>
            <label className="text-sm font-medium">End date <span className="font-normal text-neutral-500">(30-day minimum)</span>
              <input type="date" min={minimumEndDate} value={endDate} onChange={event => setEndDate(event.target.value)} className="mt-2 block min-h-12 w-full rounded-[8px] border border-neutral-300 px-3 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#829d00]" />
            </label>
          </div>
          <p className="-mt-3 text-xs leading-5 text-neutral-500">Campaign dates use India time (IST). {campaignDays > 0 ? `${campaignDays} days selected.` : "Choose a start and end date."}</p>
        </div>

        <div className="min-w-0 space-y-5 rounded-xl bg-[#111] p-5 text-white sm:p-6 lg:p-7">
          <div>
            <p className="text-xs uppercase tracking-[.18em] text-neutral-400">Build your campaign</p>
            <h2 className="mt-2 text-2xl font-medium">Plan your campaign</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-400">See a delivery estimate and the published list-price basis. OORO confirms inventory and final terms before booking.</p>
          </div>
          <div>
            <p className="text-sm font-medium">Delivery tier</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <TierButton selected={tier === "STANDARD"} onClick={() => setTier("STANDARD")} title="Standard" text="₹59 per auto / day · everyday delivery across eligible inventory." />
              <TierButton selected={tier === "PREMIUM_PLUS"} onClick={() => setTier("PREMIUM_PLUS")} title="Premium+" text="₹69 per auto / day · priority access to premium inventory." badge />
            </div>
            <p className="mt-2 text-xs leading-5 text-neutral-400">Verified agency campaigns: ₹49 per auto / day. Contact OORO for eligibility. Discounts may be available for campaigns of 90 days or longer; OORO confirms the amount.</p>
          </div>
          <div>
            <label className="text-sm font-medium">Campaign budget
              <input inputMode="decimal" type="number" min={minimumBudget} step="100" value={budget} onChange={event => setBudget(event.target.value)} aria-describedby="campaign-budget-note" className="mt-2 block min-h-12 w-full rounded-[8px] border border-white/20 bg-white/10 px-3 py-3 text-xl text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#dfff00]" />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">{quickBudgets.map(value => <button key={value} type="button" aria-pressed={Number(budget) === value} onClick={() => setBudget(String(value))} className={`min-h-9 rounded-full border px-3 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#dfff00] ${Number(budget) === value ? "border-[#dfff00] text-[#dfff00]" : "border-white/25 hover:border-white/60"}`}>{money(value)}</button>)}</div>
            {!validBudget && <p role="alert" className="mt-2 text-sm text-[#f7df72]">For this tier and date range, one auto requires at least {money(oneAutoMinimum)} before any applicable taxes.</p>}
            <div id="campaign-budget-note" className="mt-4 rounded-lg border border-white/10 bg-white/[.04] p-3">
              <p className="text-xs leading-5 text-neutral-300">List price: {money(ratePerAutoPerDay)} × {billableDays} days = {money(oneAutoMinimum)} for one auto.</p>
              <p className={`mt-1 text-xs leading-5 ${autoMonthsCovered > 0 ? "text-[#dfff00]" : "text-neutral-400"}`}>{autoMonthsCovered > 0 ? `Your budget covers up to ${autoMonthsCovered} whole ${autoMonthsCovered === 1 ? "auto" : "autos"} at this rate, subject to availability.` : `Your budget is below the one-auto minimum for this campaign.`}</p>
            </div>
          </div>

          <div className="border-t border-white/15 pt-5">
            {loading ? <p role="status" className="text-sm text-neutral-300">Updating estimated delivery…</p>
              : error ? <div role="alert" className="space-y-3 text-sm text-[#f7df72]"><p>{error}</p><button type="button" onClick={() => setRetryNonce(value => value + 1)} className="min-h-10 rounded border border-[#f7df72]/50 px-3 py-2 text-xs text-[#f7df72]">Retry forecast</button></div>
                : unsupported ? <div className="space-y-3 text-sm text-neutral-300"><p>We can’t confirm delivery for this location online. You can still submit it for a manual availability review.</p><button type="button" onClick={() => { locationInput.current?.focus(); locationInput.current?.select(); }} className="min-h-10 rounded border border-white/25 px-3 py-2 text-xs">Change location</button></div>
                  : forecast ? <div className="grid gap-4 sm:grid-cols-2"><Metric label="Estimated passenger impressions" value={`${forecast.estimatedImpressionsLow.toLocaleString("en-IN")} – ${forecast.estimatedImpressionsHigh.toLocaleString("en-IN")}`} /><Metric label="Campaign duration" value={`${forecast.campaignDays} ${forecast.campaignDays === 1 ? "day" : "days"}`} /><p className="col-span-full text-xs leading-5 text-neutral-400">This is a model-based estimate, not a guaranteed audience or booking. Screen availability is confirmed before scheduling.</p></div>
                    : !locationResolved ? <p role="status" className="text-sm text-[#f7df72]">Choose a supported city or select a verified address suggestion before requesting a forecast.</p>
                      : !validDates ? <p role="status" className="text-sm text-neutral-300">{campaignDays < MIN_CAMPAIGN_DAYS ? "Choose at least 30 campaign days to match OORO’s minimum campaign term." : "Choose valid campaign dates in India time (IST)."}</p>
                        : <p role="status" className="text-sm text-neutral-300">Enter a valid budget and campaign dates to see the forecast.</p>}
          </div>
          <p className="text-xs leading-5 text-neutral-400">No payment is collected here. Prices are list-price estimates; inventory, discounts, taxes and final terms are confirmed by OORO.</p>
          <button type="button" disabled={!validBudget || !validDates || !locationResolved || loading || (!forecast && !manualReview && !error)} onClick={launch} className="min-h-12 w-full rounded-lg bg-[var(--brand-yellow)] px-4 py-3 text-sm font-semibold text-black transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400">{loading ? "Checking availability…" : manualReview ? "Continue with manual review" : forecast ? "Continue to campaign request" : "Preparing estimate…"}</button>
        </div>
      </div>
    </section>
  );
}
function TierButton({ selected, onClick, title, text, badge = false }: { selected: boolean; onClick: () => void; title: string; text: string; badge?: boolean }) { return <button type="button" onClick={onClick} className={`rounded-[8px] border p-4 text-left ${selected ? "border-white bg-white text-black" : "border-white/30"}`}><span className="block font-medium">{title}</span><span className="mt-2 block text-xs opacity-70">{text}</span>{badge && <span className="mt-3 inline-block rounded-full bg-[var(--brand-yellow)] px-2 py-1 text-[10px] font-medium text-black">PLANNED PRIORITY</span>}</button>; }
function Metric({ label, value }: { label: string; value: string }) { return <div><p className="text-xs leading-4 text-neutral-400">{label}</p><p className="mt-1 text-xl font-medium">{value}</p></div>; }
