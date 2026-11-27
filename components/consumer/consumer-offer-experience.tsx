"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BrandedQrOfferCard } from "@/components/consumer/branded-qr-offer-card";
import type { ConsumerOfferFields } from "@/lib/consumer/offer-model";

type GeoPoint = { latitude: number; longitude: number; label: string };
type LocationChoice = { latitude: number; longitude: number; formattedAddress: string; city?: string };
type PublicOffer = ConsumerOfferFields & { destinationUrl?: string | null; value?: string | null; description?: string | null };
type RouteResult = { distanceMeters: number; durationSeconds: number; geometry: { type: "LineString"; coordinates: Array<[number, number]> }; provider: string };
type NowPlayingItem = { campaignName: string; creativeName: string; brandName: string; city?: string | null; area?: string | null; lastReportedAt: string };

function validExternalDestination(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || host.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || ["api.theooro.com", "api-staging.theooro.com", "staging.theooro.com"].includes(host)) return null;
    return url.toString();
  } catch { return null; }
}

function roundCoarse(point: GeoPoint) {
  return { latitude: Math.round(point.latitude * 10) / 10, longitude: Math.round(point.longitude * 10) / 10 };
}

function routePoints(geometry: RouteResult["geometry"]): string {
  const coords = geometry.coordinates;
  if (coords.length < 2) return "";
  const lngs = coords.map(([lng]) => lng); const lats = coords.map(([, lat]) => lat);
  const minLng = Math.min(...lngs); const maxLng = Math.max(...lngs); const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
  const dx = Math.max(maxLng - minLng, 0.00001); const dy = Math.max(maxLat - minLat, 0.00001);
  return coords.map(([lng, lat]) => `${((lng - minLng) / dx) * 100},${100 - ((lat - minLat) / dy) * 100}`).join(" ");
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  return body?.data as T;
}

export function ConsumerOfferExperience({ token }: { token: string }) {
  const [offer, setOffer] = useState<PublicOffer | null>(null);
  const [offerState, setOfferState] = useState<"loading" | "active" | "expired" | "unavailable" | "error">("loading");
  const [offers, setOffers] = useState<PublicOffer[]>([]);
  const [offersState, setOffersState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [origin, setOrigin] = useState<GeoPoint | null>(null);
  const [locationShare, setLocationShare] = useState<"NOT_SHARED" | "CURRENT_LOCATION_ONCE" | "MANUAL">("NOT_SHARED");
  const [originQuery, setOriginQuery] = useState("");
  const [destinationQuery, setDestinationQuery] = useState("");
  const [originChoices, setOriginChoices] = useState<LocationChoice[]>([]);
  const [destinationChoices, setDestinationChoices] = useState<LocationChoice[]>([]);
  const [originSearchError, setOriginSearchError] = useState("");
  const [destinationSearchError, setDestinationSearchError] = useState("");
  const [destination, setDestination] = useState<LocationChoice | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeError, setRouteError] = useState("");
  const [routeBusy, setRouteBusy] = useState(false);
  const [navigationNotice, setNavigationNotice] = useState("");
  const [playing, setPlaying] = useState<NowPlayingItem[]>([]);
  const [playingState, setPlayingState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [nearby, setNearby] = useState(false);

  const loadOffers = useCallback(async () => {
    setOffersState("loading");
    try {
      const response = await fetch("/api/public/offers", { cache: "no-store" });
      const data = await readJson<{ offers: PublicOffer[] }>(response);
      setOffers(data.offers); setOffersState(data.offers.length ? "ready" : "empty");
    } catch { setOffers([]); setOffersState("error"); }
  }, []);

  const loadPlaying = useCallback(async (point?: GeoPoint | null) => {
    setPlayingState("loading");
    try {
      const response = await fetch("/api/public/now-playing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(point ? { location: roundCoarse(point) } : {}) });
      const data = await readJson<{ items: NowPlayingItem[]; nearby: boolean }>(response);
      setPlaying(data.items); setNearby(data.nearby); setPlayingState(data.items.length ? "ready" : "empty");
    } catch { setPlaying([]); setPlayingState("error"); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!/^[A-Za-z0-9_-]{32}$/.test(token)) { setOfferState("unavailable"); void loadOffers(); return; }
    setOfferState("loading");
    fetch(`/api/public/qr-offers/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(readJson<{ state: "ACTIVE" | "EXPIRED" | "UNAVAILABLE"; offer: PublicOffer | null }>)
      .then(data => { if (cancelled) return; setOffer(data.offer); setOfferState(data.state === "ACTIVE" ? "active" : data.state === "EXPIRED" ? "expired" : "unavailable"); })
      .catch(() => { if (!cancelled) setOfferState("error"); });
    void loadOffers(); void loadPlaying();
    return () => { cancelled = true; };
  }, [token, loadOffers, loadPlaying]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (originQuery.trim().length < 3) { setOriginChoices([]); return; }
      fetch(`/api/geocode/search?q=${encodeURIComponent(originQuery.trim())}`, { signal: controller.signal })
        .then(readJson<LocationChoice[]>)
        .then(data => setOriginChoices(data))
        .catch(error => { if (!controller.signal.aborted) setOriginSearchError(error instanceof Error ? error.message : "Origin search unavailable"); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [originQuery]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (destinationQuery.trim().length < 3) { setDestinationChoices([]); return; }
      fetch(`/api/geocode/search?q=${encodeURIComponent(destinationQuery.trim())}`, { signal: controller.signal })
        .then(readJson<LocationChoice[]>)
        .then(data => setDestinationChoices(data))
        .catch(error => { if (!controller.signal.aborted) setDestinationSearchError(error instanceof Error ? error.message : "Location search unavailable"); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [destinationQuery]);

  const requestCurrentLocation = (purpose: "navigation" | "nearby") => {
    if (!navigator.geolocation) { setNavigationNotice("This browser does not provide location. Enter an origin manually."); return; }
    navigator.geolocation.getCurrentPosition(position => {
      const point = { latitude: position.coords.latitude, longitude: position.coords.longitude, label: "Your current location" };
      setLocationShare("CURRENT_LOCATION_ONCE");
      if (purpose === "navigation") { setOrigin(point); setOriginQuery(point.label); setOriginChoices([]); setNavigationNotice("Your current location is being used for this route only."); }
      else { void loadPlaying(point); setNavigationNotice("Only an approximate area was used to find nearby screens."); }
    }, () => { setNavigationNotice("Location was not shared. Enter your origin or use the maps app manually."); }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 });
  };

  const chooseOrigin = (choice: LocationChoice) => { setOrigin({ latitude: choice.latitude, longitude: choice.longitude, label: choice.formattedAddress }); setOriginQuery(choice.formattedAddress); setOriginChoices([]); setLocationShare("MANUAL"); setRoute(null); };
  const chooseDestination = (choice: LocationChoice) => { setDestination(choice); setDestinationQuery(choice.formattedAddress); setDestinationChoices([]); setRoute(null); };
  const mapHandoff = useMemo(() => {
    const originText = origin ? `${origin.latitude},${origin.longitude}` : originQuery.trim();
    const destinationText = destination ? `${destination.latitude},${destination.longitude}` : destinationQuery.trim();
    if (!originText || !destinationText) return null;
    const params = new URLSearchParams({ api: "1", origin: originText, destination: destinationText, travelmode: "driving" });
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }, [origin, destination, originQuery, destinationQuery]);

  async function previewRoute() {
    if (!origin || !destination || routeBusy) return;
    setRouteBusy(true); setRouteError(""); setRoute(null);
    try {
      const response = await fetch("/api/navigation/route", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ origin: { latitude: origin.latitude, longitude: origin.longitude }, destination: { latitude: destination.latitude, longitude: destination.longitude } }) });
      setRoute(await readJson<RouteResult>(response));
      setNavigationNotice("Route preview ready. Nothing was booked or started.");
    } catch (error) { setRouteError(error instanceof Error ? error.message : "Route preview is unavailable."); }
    finally { setRouteBusy(false); }
  }

  const safeCtaHref = validExternalDestination(offer?.destinationUrl);
  return <main className="min-h-screen bg-[#080b09] px-4 py-8 text-white sm:px-6 sm:py-12">
    <div className="mx-auto max-w-6xl">
      <header className="mb-8 flex items-center justify-between border-b border-white/10 pb-5">
        <Link href="/" aria-label="OORO home" className="text-xl font-black tracking-[.18em] text-[#dfff00]">OORO</Link>
        <span className="text-xs font-medium uppercase tracking-[.14em] text-white/55">A little more local</span>
      </header>

      <section className="grid gap-7 lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,.8fr)] lg:items-start">
        <div className="space-y-5">
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-[#dfff00]">You scanned an OORO offer</p>
          {offerState === "loading" && <div role="status" className="rounded-3xl border border-white/10 bg-white/[.04] p-8">Loading your offer…</div>}
          {offerState === "error" && <div role="alert" className="rounded-3xl border border-red-300/30 bg-red-950/30 p-6"><h1 className="text-xl font-bold">We could not load this offer</h1><p className="mt-2 text-sm text-white/65">The offer service is temporarily unavailable. You can still browse current OORO offers below.</p><button onClick={() => { setOfferState("loading"); fetch(`/api/public/qr-offers/${encodeURIComponent(token)}`, { cache: "no-store" }).then(readJson<{ state: "ACTIVE" | "EXPIRED" | "UNAVAILABLE"; offer: PublicOffer | null }>).then(data => { setOffer(data.offer); setOfferState(data.state === "ACTIVE" ? "active" : data.state === "EXPIRED" ? "expired" : "unavailable"); }).catch(() => setOfferState("error")); }} className="mt-4 rounded-full border border-white/30 px-4 py-2 text-sm">Retry</button></div>}
          {(offerState === "expired" || offerState === "unavailable") && <div data-testid={`offer-${offerState}`} className="rounded-3xl border border-amber-300/30 bg-amber-950/20 p-6"><h1 className="text-xl font-bold">{offerState === "expired" ? "This offer has ended" : "This offer is unavailable"}</h1><p className="mt-2 text-sm text-white/65">It is not active. Explore current OORO offers below.</p>{offer && <p className="mt-4 text-sm text-white/80">{offer.brandName || offer.brand || "OORO offer"} · {offer.offerTitle || offer.title || "Offer"}</p>}</div>}
          {offerState === "active" && offer && <div className="rounded-[2rem] bg-[#111612] p-3 sm:p-5">
            <BrandedQrOfferCard offer={offer} showQr={false} ctaHref={safeCtaHref} className="min-h-[330px]"/>
            {!safeCtaHref && <p className="mt-3 rounded-xl border border-amber-200/20 bg-amber-100/5 p-3 text-xs text-amber-100">The offer is active, but its secure redemption link is unavailable. Ask the venue for help.</p>}
          </div>}
          <section aria-labelledby="current-offers-heading" className="rounded-[2rem] border border-white/10 bg-white/[.04] p-5 sm:p-6">
            <div className="flex items-end justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[.18em] text-white/50">OORO network</p><h2 id="current-offers-heading" className="mt-1 text-xl font-bold">Current offers</h2></div><span className="text-xs text-white/45">Only approved and active</span></div>
            {offersState === "loading" && <p role="status" className="mt-5 text-sm text-white/60">Finding current offers…</p>}
            {offersState === "error" && <div role="alert" className="mt-5 text-sm text-red-200">Current offers could not be loaded. Please try again later.</div>}
            {offersState === "empty" && <p className="mt-5 text-sm text-white/60">There are no active OORO offers available right now.</p>}
            {offersState === "ready" && <div className="mt-5 grid gap-3 sm:grid-cols-2">{offers.map(item => <article key={item.id} className="rounded-2xl border border-white/10 bg-[#0a0e0b] p-4"><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#dfff00]">{item.brandName || item.brand || "OORO partner"}</p><h3 className="mt-2 font-semibold">{item.offerTitle || item.title || "Find your next favourite"}</h3>{item.offerValue && <p className="mt-2 text-sm font-extrabold text-[#dfff00]">{item.offerValue}</p>}{validExternalDestination(item.destinationUrl) ? <a className="mt-4 inline-flex rounded-full bg-[#087b52] px-4 py-2 text-xs font-bold" target="_blank" rel="noreferrer" href={validExternalDestination(item.destinationUrl)!}>{item.ctaLabel || "Explore offer"}</a> : <p className="mt-4 text-xs text-white/50">Ask the venue about this offer.</p>}</article>)}</div>}
          </section>
        </div>

        <div className="space-y-6">
          <section aria-labelledby="navigation-heading" className="rounded-[2rem] border border-white/10 bg-[#111612] p-5 sm:p-6">
            <p className="text-[10px] uppercase tracking-[.18em] text-[#dfff00]">Your trip, your choice</p><h2 id="navigation-heading" className="mt-2 text-2xl font-bold">Plan a route</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/60">OORO can help preview a route and open your chosen maps app. This does not book a ride, dispatch a driver, or start location tracking.</p>
            <div className="mt-5 space-y-3">
                <div><label htmlFor="trip-origin" className="mb-1 block text-xs font-semibold text-white/80">Starting point</label><div className="flex gap-2"><input id="trip-origin" value={originQuery} onChange={event => { setOriginQuery(event.target.value); setOrigin(null); setOriginSearchError(""); setLocationShare("NOT_SHARED"); }} placeholder="Enter a place or use current location" autoComplete="off" className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/15 bg-black/30 px-3 text-sm text-white placeholder:text-white/35"/><button type="button" onClick={() => requestCurrentLocation("navigation")} className="shrink-0 rounded-xl border border-white/20 px-3 text-xs font-semibold">Use my location</button></div>
                {originChoices.length > 0 && <div role="listbox" aria-label="Starting point results" className="mt-2 max-h-48 overflow-auto rounded-xl border border-white/10 bg-[#1c241e]">{originChoices.map((choice,index) => <button type="button" role="option" aria-selected="false" key={`${choice.latitude}:${choice.longitude}:${index}`} onClick={() => chooseOrigin(choice)} className="block w-full border-b border-white/5 px-3 py-3 text-left text-xs last:border-0 hover:bg-white/5">{choice.formattedAddress}</button>)}</div>}
                {originSearchError && <p role="alert" className="mt-1 text-xs text-red-200">{originSearchError}</p>}
              </div>
              <div><label htmlFor="trip-destination" className="mb-1 block text-xs font-semibold text-white/80">Drop-off location</label><input id="trip-destination" value={destinationQuery} onChange={event => { setDestinationQuery(event.target.value); setDestination(null); setDestinationSearchError(""); }} placeholder="Search and choose a destination" autoComplete="off" className="min-h-11 w-full rounded-xl border border-white/15 bg-black/30 px-3 text-sm text-white placeholder:text-white/35"/>
                {destinationChoices.length > 0 && <div role="listbox" aria-label="Drop-off results" className="mt-2 max-h-48 overflow-auto rounded-xl border border-white/10 bg-[#1c241e]">{destinationChoices.map((choice,index) => <button type="button" role="option" aria-selected="false" key={`${choice.latitude}:${choice.longitude}:${index}`} onClick={() => chooseDestination(choice)} className="block w-full border-b border-white/5 px-3 py-3 text-left text-xs last:border-0 hover:bg-white/5">{choice.formattedAddress}</button>)}</div>}
                {destinationSearchError && <p role="alert" className="mt-1 text-xs text-red-200">{destinationSearchError}</p>}
              </div>
              {locationShare !== "NOT_SHARED" && <div className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2 text-[11px] text-white/60"><span>{locationShare === "CURRENT_LOCATION_ONCE" ? "Location shared once for this request" : "Using the place you selected"}</span>{locationShare === "CURRENT_LOCATION_ONCE" && <button type="button" onClick={() => { setOrigin(null); setOriginQuery(""); setLocationShare("NOT_SHARED"); setNavigationNotice("Location sharing stopped."); }} className="underline">Stop sharing</button>}</div>}
              {navigationNotice && <p role="status" className="text-xs text-white/60">{navigationNotice}</p>}
              <button type="button" disabled={!origin || !destination || routeBusy} onClick={() => void previewRoute()} className="min-h-11 w-full rounded-full bg-[#dfff00] px-5 text-sm font-extrabold text-black disabled:cursor-not-allowed disabled:opacity-40">{routeBusy ? "Building route preview…" : "Preview route"}</button>
              {routeError && <p role="alert" data-testid="route-error" className="rounded-xl border border-amber-300/20 bg-amber-100/5 p-3 text-xs text-amber-100">{routeError}</p>}
              {route && <div data-testid="route-preview" className="overflow-hidden rounded-2xl border border-white/10 bg-[#090e0b] p-3"><svg viewBox="0 0 100 100" role="img" aria-label="Provider-generated route preview" className="h-40 w-full rounded-xl bg-[#16221a] p-3"><polyline points={routePoints(route.geometry)} fill="none" stroke="#dfff00" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/><circle cx="5" cy="95" r="3" fill="#fff"/><circle cx="95" cy="5" r="3" fill="#087b52"/></svg><p className="mt-2 text-xs text-white/75">{(route.distanceMeters / 1000).toFixed(1)} km · about {Math.max(1, Math.round(route.durationSeconds / 60))} min · {route.provider}</p></div>}
              {mapHandoff && <a data-testid="maps-handoff" href={mapHandoff} target="_blank" rel="noreferrer" onClick={() => setNavigationNotice("Maps app opened by your choice. OORO has not booked or started anything.")} className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-white/25 px-5 text-sm font-bold">Open route in maps app</a>}
            </div>
          </section>

          <section aria-labelledby="now-playing-heading" className="rounded-[2rem] border border-white/10 bg-[#111612] p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[.18em] text-[#dfff00]">Verified screen reports</p><h2 id="now-playing-heading" className="mt-2 text-xl font-bold">Now playing on OORO</h2></div><button type="button" onClick={() => requestCurrentLocation("nearby")} className="rounded-full border border-white/20 px-3 py-2 text-[11px] font-semibold">Find nearby · approximate location</button></div>
            <p className="mt-2 text-xs leading-relaxed text-white/55">Only ads with a fresh authenticated screen report and matching acknowledged playback proof appear here. A campaign assignment alone is not playback evidence.</p>
            {nearby && <p role="status" className="mt-3 text-[11px] text-white/60">Nearby results use an approximate area only. <button type="button" onClick={() => { setNearby(false); setLocationShare("NOT_SHARED"); void loadPlaying(null); }} className="underline">Stop and show all verified reports</button></p>}
            {playingState === "loading" && <p role="status" className="mt-4 text-sm text-white/60">Checking current playback proofs…</p>}
            {playingState === "error" && <p role="alert" className="mt-4 text-sm text-red-200">Current playback reports are temporarily unavailable.</p>}
            {playingState === "empty" && <p className="mt-4 text-sm text-white/60">No screen has a fresh, proof-confirmed ad report right now.</p>}
            {playingState === "ready" && <ul className="mt-4 space-y-3">{playing.map((item,index) => <li key={`${item.campaignName}:${item.creativeName}:${index}`} className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#dfff00]">{item.brandName}</p><p className="mt-1 text-sm font-semibold">{item.creativeName}</p><p className="mt-1 text-xs text-white/50">{item.campaignName}{nearby && (item.area || item.city) ? ` · ${item.area || item.city}` : ""} · verified moments ago</p></li>)}</ul>}
          </section>
        </div>
      </section>
      <footer className="mt-10 border-t border-white/10 pt-5 text-xs text-white/40">OORO offers are subject to venue availability. Navigation opens only when you choose a maps app.</footer>
    </div>
  </main>;
}
