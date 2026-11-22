"use client";

import { CalendarDays, MapPin, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader, PrimaryButton } from "./app-ui";

type Draft = {
  name: string;
  city: string;
  start: string;
  end: string;
  tier: "STANDARD" | "PREMIUM_PLUS";
  campaignId?: string;
};

const initial: Draft = {
  name: "",
  city: "Bengaluru",
  start: "",
  end: "",
  tier: "STANDARD",
};

export function BusinessCampaignFlow() {
  const [draft, setDraft] = useState<Draft>(initial);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("ooro.campaign-draft");
      if (!raw) return;
      const previous = JSON.parse(raw) as Record<string, unknown>;
      setDraft(current => ({
        ...current,
        start: typeof previous.start === "string" ? previous.start : current.start,
        end: typeof previous.end === "string" ? previous.end : current.end,
        tier: previous.deliveryTier === "PREMIUM_PLUS" ? "PREMIUM_PLUS" : "STANDARD",
      }));
      window.localStorage.removeItem("ooro.campaign-draft");
    } catch {
      // A stale or invalid local draft must not block a new campaign brief.
    }
  }, []);

  const valid = Boolean(
    draft.name.trim() &&
      draft.start &&
      draft.end &&
      draft.start <= draft.end,
  );

  const persist = async () => {
    const payload = {
      name: draft.name.trim(),
      description: "Business campaign brief",
      goal: "Reach",
      audience: "Local customers",
      city: "Bengaluru",
      area: "Bengaluru",
      startDate: draft.start,
      endDate: draft.end,
      deliveryTier: draft.tier,
      metadata: {
        timezone: "Asia/Kolkata",
        city: draft.city,
        deliveryTier: draft.tier,
        target: { mode: "CITYWIDE" },
      },
    };

    const response = await fetch(
      draft.campaignId ? `/api/campaigns/${draft.campaignId}` : "/api/campaigns",
      {
        method: draft.campaignId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error?.message ?? "Campaign brief could not be saved.");
    }

    setDraft(current => ({ ...current, campaignId: current.campaignId ?? body.data.id }));
  };

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await persist();
      setMessage(
        "Your campaign brief is with OORO for review. No payment was collected and delivery has not started.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Campaign brief could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const set = (key: "name" | "start" | "end", value: string) => {
    setDraft(current => ({ ...current, [key]: value }));
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-10">
      <PageHeader
        title="Create a campaign brief"
        description="Share the campaign basics. OORO will confirm the exact screen plan and commercial terms with you before delivery."
      />

      <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_10px_32px_rgba(20,24,18,0.045)]">
        <div className="border-b border-neutral-200 px-5 py-5 sm:px-8 sm:py-6">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Campaign details</h2>
          <p className="mt-1 text-sm leading-6 text-neutral-500">
            Start and end dates are inclusive calendar dates in India Standard Time.
          </p>
        </div>

        <div className="space-y-7 px-5 py-6 sm:px-8 sm:py-8">
          <label className="block text-sm font-medium text-neutral-800">
            Campaign name
            <input
              name="campaignName"
              autoComplete="off"
              value={draft.name}
              onChange={event => set("name", event.target.value)}
              placeholder="e.g. Bengaluru launch campaign"
              maxLength={160}
              required
              className="mt-2 block min-h-12 w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-base outline-none transition placeholder:text-neutral-400 focus:border-neutral-900 focus:ring-2 focus:ring-[#dfff00]/60"
            />
          </label>

          <div className="grid gap-x-6 gap-y-7 md:grid-cols-2">
            <div className="rounded-xl border border-neutral-200 bg-[#f7f8f4] p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <MapPin aria-hidden="true" size={18} className="mt-0.5 text-neutral-700" />
                <div>
                  <p className="text-sm font-medium text-neutral-900">Campaign location</p>
                  <p className="mt-1 text-sm text-neutral-700">Bengaluru</p>
                  <p className="mt-2 max-w-md text-xs leading-5 text-neutral-600">
                    OORO operations will confirm the exact screens and coverage with you.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium text-neutral-800">
                <span className="flex items-center gap-2">
                  <CalendarDays aria-hidden="true" size={15} className="text-neutral-500" />
                  Start date
                </span>
                <input
                  name="startDate"
                  type="date"
                  value={draft.start}
                  onChange={event => set("start", event.target.value)}
                  required
                  className="mt-2 block min-h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-[#dfff00]/60"
                />
              </label>
              <label className="block text-sm font-medium text-neutral-800">
                <span className="flex items-center gap-2">
                  <CalendarDays aria-hidden="true" size={15} className="text-neutral-500" />
                  End date
                </span>
                <input
                  name="endDate"
                  type="date"
                  value={draft.end}
                  onChange={event => set("end", event.target.value)}
                  min={draft.start || undefined}
                  required
                  className="mt-2 block min-h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-[#dfff00]/60"
                />
              </label>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-[#fbfcf8] px-4 py-4 sm:px-5">
            <ShieldCheck aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-neutral-700" />
            <p className="text-sm leading-6 text-neutral-700">
              Submitting saves a brief for operational review only. It does not reserve screens,
              collect payment, schedule playback, or start delivery.
            </p>
          </div>

          {error && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="rounded-xl border border-lime-300 bg-lime-50 px-4 py-3 text-sm leading-6 text-neutral-900">
              {message}
            </p>
          )}

          <div className="flex flex-col gap-3 border-t border-neutral-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-xl text-xs leading-5 text-neutral-600">
              Commercial terms and screen allocation are confirmed by OORO before any campaign goes live.
            </p>
            <PrimaryButton onClick={() => void submit()} disabled={!valid || busy}>
              {busy ? "Submitting brief…" : "Submit for review"}
            </PrimaryButton>
          </div>
        </div>
      </section>
    </div>
  );
}
