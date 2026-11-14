"use client";

import { useMemo, useState } from "react";

const pricingOptions = [
  { id: "standard", label: "Standard brand", rate: 59 },
  { id: "agency", label: "Agency", rate: 49 },
  { id: "premium", label: "Premium slot", rate: 69 },
] as const;

const industries = ["Restaurant or café", "Retail", "Fitness", "Education", "Healthcare", "Other"];
const objectives = ["Introduce a business", "Promote an offer", "Support local awareness", "Learn about a channel"];
const MINIMUM_DAYS = 30;

const inr = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;

export function BudgetPlanner() {
  const [industry, setIndustry] = useState(industries[0]);
  const [objective, setObjective] = useState(objectives[0]);
  const [pricingId, setPricingId] = useState<(typeof pricingOptions)[number]["id"]>("standard");
  const [autosInput, setAutosInput] = useState("1");
  const [daysInput, setDaysInput] = useState("30");

  const autos = Math.min(500, Math.max(1, Math.floor(Number(autosInput) || 1)));
  const days = Math.min(365, Math.max(MINIMUM_DAYS, Math.floor(Number(daysInput) || MINIMUM_DAYS)));
  const pricing = pricingOptions.find((option) => option.id === pricingId) ?? pricingOptions[0];
  const total = useMemo(() => pricing.rate * autos * days, [pricing.rate, autos, days]);

  return (
    <section aria-labelledby="planner-title" className="mt-10 grid gap-8 border-y border-black/15 py-8 md:grid-cols-[1fr_1fr] md:gap-16">
      <div>
        <h2 id="planner-title" className="text-2xl font-semibold tracking-tight">Estimate your OORO campaign price</h2>
        <p className="mt-3 max-w-prose text-sm leading-6 text-neutral-600">
          Choose a rate, the number of autos and campaign length. The estimate uses the published per-auto, per-day rate; it does not check live inventory or guarantee a booking.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">
            Pricing option
            <select className="mt-2 block min-h-12 w-full rounded-lg border border-black/15 bg-white px-3" value={pricingId} onChange={(event) => setPricingId(event.target.value as typeof pricingId)}>
              {pricingOptions.map((option) => <option key={option.id} value={option.id}>{option.label} — {inr(option.rate)}/auto/day</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">
            Number of autos
            <input aria-describedby="autos-help" type="number" min="1" max="500" step="1" inputMode="numeric" className="mt-2 block min-h-12 w-full rounded-lg border border-black/15 bg-white px-3" value={autosInput} onChange={(event) => setAutosInput(event.target.value)} />
          </label>
          <p id="autos-help" className="-mt-2 text-xs text-neutral-500 sm:col-start-2">Enter 1 to 500 autos.</p>
          <label className="text-sm font-medium">
            Campaign duration (days)
            <input aria-describedby="duration-help" type="number" min={MINIMUM_DAYS} max="365" step="1" inputMode="numeric" className="mt-2 block min-h-12 w-full rounded-lg border border-black/15 bg-white px-3" value={daysInput} onChange={(event) => setDaysInput(event.target.value)} />
          </label>
          <p id="duration-help" className="-mt-2 text-xs text-neutral-500 sm:col-start-2">Minimum 30 days. Use 90+ days to ask about a longer-term discount.</p>
          <label className="text-sm font-medium">
            Industry
            <select className="mt-2 block min-h-12 w-full rounded-lg border border-black/15 bg-white px-3" value={industry} onChange={(event) => setIndustry(event.target.value)}>
              {industries.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">
            Campaign objective
            <select className="mt-2 block min-h-12 w-full rounded-lg border border-black/15 bg-white px-3" value={objective} onChange={(event) => setObjective(event.target.value)}>
              {objectives.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div aria-live="polite" className="self-center rounded-xl bg-[#101210] p-6 text-white md:p-8">
        <p className="text-xs font-semibold uppercase tracking-[.15em] text-[#dfff00]">Your estimate</p>
        <h3 className="mt-4 text-xl font-semibold">{industry}: {objective.toLowerCase()}</h3>
        <p className="mt-5 text-3xl font-semibold tracking-tight">{inr(total)}</p>
        <p className="mt-2 text-sm leading-6 text-neutral-300">
          {autos} {autos === 1 ? "auto" : "autos"} × {days} days × {inr(pricing.rate)} per auto/day
        </p>
        {days >= 90 && <p className="mt-4 rounded-lg border border-[#dfff00]/30 bg-[#dfff00]/10 p-3 text-sm leading-5 text-neutral-200">Longer campaigns may qualify for a discount. The discount is not included here; ask OORO to confirm the applicable terms.</p>}
        <p className="mt-4 border-t border-white/15 pt-4 text-xs leading-5 text-neutral-400">
          Planning estimate only, before any applicable taxes or separately scoped production. Inventory, dates, eligibility and final terms require confirmation by OORO. This tool does not promise reach, impressions or results.
        </p>
        <a className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-[#dfff00] px-5 text-sm font-semibold text-black" href="/contact">Check availability with OORO</a>
      </div>
    </section>
  );
}
