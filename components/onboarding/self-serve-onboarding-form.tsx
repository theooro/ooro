"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
type Kind = "business" | "network" | "explorer";
const goals = ["Increase awareness", "Drive store visits", "Launch promotion", "Promote event", "Promote product/service", "Other"];
const inputClass = "mt-2 block w-full rounded-[8px] border border-neutral-300 bg-white px-3.5 py-3 text-sm outline-none focus:border-black";
export function SelfServeOnboardingForm({ kind, initialStep = 1, initialDraft = {} }: { kind: Kind; initialStep?: number; initialDraft?: Record<string, unknown> }) {
  const router = useRouter(); const searchParams = useSearchParams();
  const [step, setStep] = useState(initialStep); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [selectedGoals, setSelectedGoals] = useState<string[]>(Array.isArray(initialDraft.goals) ? initialDraft.goals.map(String) : []); const [interests, setInterests] = useState<string[]>(Array.isArray(initialDraft.interests) ? initialDraft.interests.map(String) : []); const [draft, setDraft] = useState<Record<string, unknown>>(initialDraft); const [networkRole, setNetworkRole] = useState(String(initialDraft.role ?? ""));
  const isBusiness = kind === "business"; const isExplorer = kind === "explorer";
  async function advance(event: React.MouseEvent<HTMLButtonElement>, nextStep: number) {
    const form = event.currentTarget.form;
    if (form && !form.reportValidity()) return;
    const values = form ? Object.fromEntries(new FormData(form)) : {};
    setDraft(current => ({ ...current, ...values }));
    setError("");
    if (kind === "business") {
      setBusy(true);
      try {
        const response = await fetch("/api/onboarding/business", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...values, step: nextStep - 1 }) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) return setError(payload.error?.message || "We could not save this step. Please try again.");
      } catch {
        return setError("We could not save this step. Check your connection and try again.");
      } finally {
        setBusy(false);
      }
    }
    setStep(nextStep);
  }
  async function complete(form: HTMLFormElement) {
    if (!form.reportValidity()) return;
    if (isBusiness && selectedGoals.length === 0) return setError("Choose at least one advertising goal.");
    if (isExplorer && interests.length === 0) return setError("Choose at least one interest.");
    setBusy(true);
    setError("");
    const data = { ...draft, ...Object.fromEntries(new FormData(form)) };
    try {
      const response = await fetch(`/api/onboarding/${kind}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...data, goals: selectedGoals, interests }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return setError(payload.error?.message || "Please complete the highlighted details.");
      router.push(kind === "business" && searchParams.get("next") ? payload.data?.next || "/verification" : payload.data?.next || "/dashboard");
    } catch {
      setError("We could not submit your application. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); void complete(event.currentTarget); }
  const title = isBusiness ? "Tell us about your business." : isExplorer ? "Choose what you want to explore." : "Join the OORO vehicle network.";
  const submitButton = (label: string) => <button type="button" disabled={busy} onClick={event => { const form = event.currentTarget.form; if (form) void complete(form); }} className="w-full rounded-[8px] bg-black px-4 py-3.5 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-60">{busy ? "Saving…" : label}</button>;
  const value = (key: string) => String(draft[key] ?? "");
  return <form onSubmit={handleSubmit} className="space-y-6"><div className="flex items-center justify-between text-xs text-neutral-500"><span>Step {step} of {isBusiness ? 3 : 1}</span>{step > 1 && <button type="button" onClick={() => setStep(current => current - 1)} className="underline">Back</button>}</div><h2 className="text-2xl font-medium">{title}</h2>{isBusiness && step === 1 && <div className="space-y-4"><label className="block text-sm font-medium">Business name<input required name="businessName" defaultValue={value("businessName")} className={inputClass}/></label><label className="block text-sm font-medium">Business category<input required name="category" defaultValue={value("category")} placeholder="Restaurant, salon, clinic…" className={inputClass}/></label><label className="block text-sm font-medium">Website or Instagram (optional)<input name="website" defaultValue={value("website")} className={inputClass}/></label><button type="button" disabled={busy} onClick={event => void advance(event, 2)} className="w-full rounded-[8px] bg-black px-4 py-3.5 text-sm font-medium text-white disabled:opacity-60">{busy ? "Saving…" : "Continue"}</button></div>}{isBusiness && step === 2 && <div className="space-y-4"><label className="block text-sm font-medium">City<input required name="city" defaultValue={value("city")} className={inputClass}/></label><label className="block text-sm font-medium">Business area or address<input required name="address" defaultValue={value("address")} className={inputClass}/></label><button type="button" disabled={busy} onClick={event => void advance(event, 3)} className="w-full rounded-[8px] bg-black px-4 py-3.5 text-sm font-medium text-white disabled:opacity-60">{busy ? "Saving…" : "Continue"}</button></div>}{isBusiness && step === 3 && <div className="space-y-4"><p className="text-sm font-medium">What do you want to achieve?</p>{goals.map(goal => <label className="flex items-center gap-3 text-sm" key={goal}><input type="checkbox" checked={selectedGoals.includes(goal)} onChange={() => setSelectedGoals(current => current.includes(goal) ? current.filter(item => item !== goal) : [...current, goal])}/>{goal}</label>)}<p className="rounded-lg bg-[#f4f5e8] p-3 text-xs leading-5 text-neutral-700">We’ll review your business details before enabling campaign access. You can follow the review from your workspace.</p>{submitButton("Submit for business review")}</div>}{isExplorer && <div className="space-y-4"><label className="block text-sm font-medium">Name<input name="name" defaultValue={value("name")} className={inputClass}/></label><label className="block text-sm font-medium">City<input required name="city" defaultValue={value("city")} className={inputClass}/></label><p className="text-sm font-medium">Interests</p>{["OORO updates", "Brand campaigns", "Startup/product updates", "Partnership opportunities"].map(item => <label className="flex items-center gap-3 text-sm" key={item}><input type="checkbox" checked={interests.includes(item)} onChange={() => setInterests(current => current.includes(item) ? current.filter(value => value !== item) : [...current, item])}/>{item}</label>)}{submitButton("Explore OORO")}</div>}{kind === "network" && <div className="space-y-4"><p className="rounded-lg bg-[#f4f5e8] p-3 text-xs leading-5 text-neutral-700">Vehicle participation is reviewed before a screen is assigned or activated. Complete all details so our fleet team can check fit and availability.</p><label className="block text-sm font-medium">Who are you?<select required name="role" value={networkRole} onChange={event => setNetworkRole(event.target.value)} className={inputClass}><option value="">Choose one</option><option value="DRIVER">Driver</option><option value="VEHICLE_OWNER">Vehicle owner</option><option value="FLEET_OPERATOR">Fleet operator</option></select></label><label className="block text-sm font-medium">Vehicle type<input required name="vehicleType" defaultValue={value("vehicleType")} placeholder="Auto / Cab / Other" className={inputClass}/></label><label className="block text-sm font-medium">Registration number<input required={networkRole !== "FLEET_OPERATOR"} name="registration" defaultValue={value("registration")} placeholder={networkRole === "FLEET_OPERATOR" ? "Optional for fleet operators" : "Required for an individual vehicle"} className={inputClass}/></label><label className="block text-sm font-medium">City<input required name="city" defaultValue={value("city")} className={inputClass}/></label><label className="block text-sm font-medium">Operating areas<input required name="operatingAreas" defaultValue={value("operatingAreas")} placeholder="Neighbourhoods or service areas" className={inputClass}/></label><label className="block text-sm font-medium">Phone<input required name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={value("phone")} placeholder="+91 98765 43210" className={inputClass}/></label>{submitButton("Send application for review")}</div>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}</form>;
}
