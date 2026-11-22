"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  FileImage,
  FileVideo2,
  RefreshCw,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState, PageHeader, PrimaryButton } from "./app-ui";

type CreativeItem = {
  creativeId: string;
  campaignId: string | null;
  campaignName: string | null;
  submission?: boolean;
  name: string;
  type: string;
  status: string;
  submittedAt?: string;
  asset: {
    fileName: string;
    mimeType?: string | null;
    size?: number | null;
    checksum?: string | null;
    url?: string | null;
    width?: number | null;
    height?: number | null;
  } | null;
};

type UploadPermission = { allowed: boolean; message: string };

function humanStatus(status: string) {
  return status.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase());
}

function statusTone(status: string) {
  if (status === "APPROVED") return "border-lime-300 bg-lime-50 text-neutral-900";
  if (status === "PENDING_REVIEW") return "border-amber-300 bg-amber-50 text-amber-950";
  if (status === "REJECTED") return "border-red-200 bg-red-50 text-red-800";
  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

function formatSize(size?: number | null) {
  if (size == null) return "Size unavailable";
  return size >= 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
}

export function CreativeSubmissionCenter() {
  const [items, setItems] = useState<CreativeItem[]>([]);
  const [permission, setPermission] = useState<UploadPermission | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/creatives", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || "Unable to load creatives.");
      setItems(payload.data ?? []);
      setPermission(payload.uploadPermission ?? { allowed: false, message: "Creative uploads are unavailable." });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load creatives.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const chooseFile = (next: File | null) => {
    setError("");
    setNotice("");
    if (next && next.size > 100 * 1024 * 1024) {
      setFile(null);
      setError("This file is larger than 100 MB. Choose a smaller export.");
      return;
    }
    setFile(next);
  };

  const submit = async () => {
    if (!file) {
      setError("Choose an image or video file first.");
      return;
    }
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/creative-submissions", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || "Creative could not be submitted.");
      setNotice(`${payload.data.fileName} was submitted for review. It is not scheduled or playing.`);
      setFile(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Creative could not be submitted.");
    } finally {
      setBusy(false);
    }
  };

  const pendingCount = items.filter(item => item.submission && item.status === "PENDING_REVIEW").length;

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-10">
      <PageHeader
        title="Creatives"
        description="Send artwork to OORO for review. Approved files remain unscheduled until OORO assigns them to a campaign."
        action={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-800 transition hover:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-2 disabled:opacity-50"
          >
            <RefreshCw aria-hidden="true" size={15} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        }
      />

      {error && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="shrink-0 font-medium underline underline-offset-4">
            Retry
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-lime-300 bg-lime-50 px-4 py-3 text-sm leading-6 text-neutral-900">
          <CheckCircle2 aria-hidden="true" size={18} className="mt-0.5 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_10px_32px_rgba(20,24,18,0.045)]">
        <div className="border-b border-neutral-200 px-5 py-5 sm:px-8 sm:py-6">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Submit a creative</h2>
          <p className="mt-1 text-sm leading-6 text-neutral-500">
            JPG, PNG, WebP, MP4 or WebM. Maximum file size: 100 MB.
          </p>
        </div>

        <div className="grid gap-6 px-5 py-6 sm:px-8 sm:py-8 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.72fr)]">
          <div>
            {permission?.allowed ? (
              <>
                <label
                  htmlFor="creative-file"
                  className="group flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-[#fafbf8] px-5 py-7 text-center transition hover:border-neutral-500 hover:bg-[#f6f8ee] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-neutral-900"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#dfff00] text-neutral-950">
                    <Upload aria-hidden="true" size={20} />
                  </span>
                  <span className="mt-4 text-sm font-semibold text-neutral-900">Choose a creative file</span>
                  <span className="mt-1 text-xs leading-5 text-neutral-600">Select an image or video from your device</span>
                  <input
                    id="creative-file"
                    aria-label="Creative file"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
                    onChange={event => {
                      chooseFile(event.currentTarget.files?.[0] ?? null);
                      event.currentTarget.value = "";
                    }}
                    className="sr-only"
                  />
                </label>

                {file && (
                  <div className="mt-4 flex items-center gap-4 rounded-xl border border-neutral-200 p-3 sm:p-4">
                    <div className="flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-neutral-100">
                      {previewUrl ? (
                        <img src={previewUrl} alt={`Preview of ${file.name}`} className="h-full w-full object-cover" />
                      ) : file.type.startsWith("video/") ? (
                        <FileVideo2 aria-hidden="true" size={24} className="text-neutral-600" />
                      ) : (
                        <FileImage aria-hidden="true" size={24} className="text-neutral-600" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="break-all text-sm font-medium text-neutral-900">{file.name}</p>
                      <p className="mt-1 text-xs text-neutral-600">{file.type || "Unknown format"} · {formatSize(file.size)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => chooseFile(null)}
                      aria-label="Remove selected file"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-950 focus:outline-none focus:ring-2 focus:ring-neutral-900"
                    >
                      <X aria-hidden="true" size={17} />
                    </button>
                  </div>
                )}

                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="max-w-xl text-xs leading-5 text-neutral-600">
                    Your submission is shared with OORO Admin and Super Admin for review. You can track its status here.
                  </p>
                  <PrimaryButton onClick={() => void submit()} disabled={busy || !file}>
                    {busy ? "Uploading for review…" : "Submit for review"}
                  </PrimaryButton>
                </div>
              </>
            ) : (
              <div role="status" className="rounded-xl border border-neutral-200 bg-[#fafbf8] px-5 py-6">
                <p className="text-sm font-medium text-neutral-900">
                  {permission?.message || "Checking creative upload access…"}
                </p>
                {!permission && <div className="mt-4 h-2 w-40 animate-pulse rounded bg-neutral-200" />}
              </div>
            )}
          </div>

          <aside className="rounded-xl border border-neutral-200 bg-[#f7f8f4] p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <ShieldCheck aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-neutral-800" />
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">Review before delivery</h3>
                <p className="mt-2 text-sm leading-6 text-neutral-700">
                  Submission sends the file for review only. Approval does not attach it to a campaign or start playback.
                </p>
                <p className="mt-4 text-xs leading-5 text-neutral-600">
                  An authorized OORO administrator must assign an approved creative to a campaign separately.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="creative-submissions-heading">
        <div className="flex flex-col gap-3 border-b border-neutral-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="creative-submissions-heading" className="text-xl font-semibold tracking-[-0.02em] text-neutral-950">
              Your submitted files
            </h2>
            <p className="mt-1 text-sm text-neutral-600">
              {pendingCount ? `${pendingCount} awaiting review` : "Review status and campaign assignment appear here."}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading creatives">
            {[0, 1, 2].map(index => <div key={index} className="h-48 animate-pulse rounded-xl border border-neutral-200 bg-white" />)}
          </div>
        ) : items.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-live="polite">
            {items.map(item => {
              const card = (
                <article className="h-full overflow-hidden rounded-xl border border-neutral-200 bg-white transition hover:border-neutral-400">
                  <div className="relative flex h-40 items-center justify-center overflow-hidden bg-[#f3f4ef]">
                    {item.asset?.mimeType?.startsWith("image/") && item.asset.url ? (
                      <img src={item.asset.url} alt={item.asset.fileName} className="h-full w-full object-cover" loading="lazy" />
                    ) : item.asset?.mimeType?.startsWith("video/") && item.asset.url ? (
                      <video src={item.asset.url} aria-label={`Video preview: ${item.asset.fileName}`} controls preload="metadata" className="h-full w-full bg-black object-contain" />
                    ) : item.type === "VIDEO" ? (
                      <FileVideo2 aria-hidden="true" size={28} className="text-neutral-500" />
                    ) : (
                      <FileImage aria-hidden="true" size={28} className="text-neutral-500" />
                    )}
                  </div>
                  <div className="p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-all text-sm font-semibold text-neutral-950">{item.asset?.fileName || item.name}</p>
                        <p className="mt-1 text-xs text-neutral-600">{item.type} · {formatSize(item.asset?.size)}</p>
                      </div>
                      <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusTone(item.status)}`}>
                        {item.status === "PENDING_REVIEW" ? <Clock3 aria-hidden="true" size={12} /> : <CheckCircle2 aria-hidden="true" size={12} />}
                        {humanStatus(item.status)}
                      </span>
                    </div>
                    {item.submission ? (
                      <p className="mt-3 text-xs text-neutral-600">Submitted for review · Not scheduled</p>
                    ) : (
                      <p className="mt-3 truncate text-xs text-neutral-600">Campaign: {item.campaignName}</p>
                    )}
                    {item.campaignId && (
                      <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-neutral-900 underline underline-offset-4">
                        View campaign <ArrowUpRight aria-hidden="true" size={13} />
                      </span>
                    )}
                  </div>
                </article>
              );
              return item.campaignId ? (
                <Link href={`/campaigns/${item.campaignId}`} key={item.creativeId} className="rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-2">
                  {card}
                </Link>
              ) : (
                <div key={item.creativeId}>{card}</div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="No creative submissions yet"
            description="Choose a file above to send it to OORO Admin and Super Admin for review. You will see its status here after upload."
          />
        )}
      </section>
    </div>
  );
}
