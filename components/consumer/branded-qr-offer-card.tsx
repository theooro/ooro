"use client";

import QRCode from "qrcode";
import Image from "next/image";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { mapBrandedOffer, MIN_CONSUMER_QR_SIZE_PX, offerQrSize, type ConsumerOfferFields } from "@/lib/consumer/offer-model";

type Props = {
  offer: ConsumerOfferFields;
  qrUrl?: string | null;
  previewOnly?: boolean;
  ctaHref?: string | null;
  showQr?: boolean;
  className?: string;
};

export function BrandedQrOfferCard({ offer: source, qrUrl, previewOnly = false, ctaHref, showQr = true, className = "" }: Props) {
  const offer = useMemo(() => mapBrandedOffer({ ...source, consumerUrl: qrUrl ?? source.consumerUrl ?? source.qrUrl }), [source, qrUrl]);
  const qrSlot = useRef<HTMLDivElement>(null);
  const [slotSize, setSlotSize] = useState({ width: 0, height: 0 });
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);
  useEffect(() => {
    const element = qrSlot.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box) setSlotSize({ width: box.width, height: box.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const qrSize = offerQrSize(slotSize.width, slotSize.height, 0, 4);
  useEffect(() => {
    let cancelled = false;
    setQrImage(null);
    setQrError(false);
    if (!showQr || !offer.consumerUrl || qrSize < MIN_CONSUMER_QR_SIZE_PX) return;
    QRCode.toDataURL(offer.consumerUrl, { width: qrSize, margin: 4, errorCorrectionLevel: "Q", color: { dark: "#101613", light: "#ffffff" } })
      .then(value => { if (!cancelled) setQrImage(value); })
      .catch(() => { if (!cancelled) setQrError(true); });
    return () => { cancelled = true; };
  }, [offer.consumerUrl, qrSize, showQr]);

  let safeCtaHref: string | null = null;
  try { const parsed = new URL(ctaHref ?? ""); const host = parsed.hostname.toLowerCase(); if (parsed.protocol === "https:" && !parsed.username && !parsed.password && !host.includes(":") && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) && host !== "localhost" && !host.endsWith(".localhost") && !host.endsWith(".local") && !host.endsWith(".internal") && !["api.theooro.com", "api-staging.theooro.com", "staging.theooro.com"].includes(host)) safeCtaHref = parsed.toString(); } catch { /* no secure external destination */ }
  const cta = safeCtaHref ? <a data-testid="offer-cta" href={safeCtaHref} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center justify-center rounded-full bg-[#087b52] px-5 py-3 text-center text-xs font-extrabold tracking-wide text-white shadow-sm hover:bg-[#066443] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087b52]">{offer.cta}</a>
    : <span data-testid="offer-cta" className="inline-flex max-w-full items-center justify-center rounded-full bg-[#087b52] px-5 py-3 text-center text-xs font-extrabold tracking-wide text-white shadow-sm">{offer.cta}</span>;

  return <article data-testid="branded-qr-offer-card" className={`flex h-full min-h-0 w-full flex-col items-center overflow-hidden rounded-3xl border border-[#d9e1d4] bg-[#f4f4e9] p-4 text-center text-[#182a27] shadow-sm sm:p-5 ${className}`}>
    <div className="shrink-0 text-lg font-black tracking-[.12em] text-[#087b52] sm:text-xl" data-testid="offer-brand-mark">OORO</div>
    <div className="mt-1 shrink-0 max-w-full truncate text-[10px] font-semibold uppercase tracking-[.12em] text-[#50615c]" data-testid="offer-merchant">{offer.brand}</div>
    <h2 className="mt-2 max-w-full shrink-0 text-pretty text-sm font-bold leading-tight sm:text-base" data-testid="offer-headline">{offer.headline}</h2>
    {offer.supportingText && <p className="mt-1 max-w-full shrink-0 text-xs leading-snug text-[#50615c]" data-testid="offer-supporting-copy">{offer.supportingText}</p>}
    {offer.value && <p className="mt-2 shrink-0 text-sm font-extrabold text-[#087b52]" data-testid="offer-value">{offer.value}</p>}
    {showQr && <div ref={qrSlot} className="my-3 flex min-h-0 w-full flex-1 items-center justify-center" data-testid="offer-qr-slot">
      {offer.consumerUrl && qrSize >= MIN_CONSUMER_QR_SIZE_PX && qrImage && <Image src={qrImage} width={qrSize} height={qrSize} unoptimized alt="Scan the OORO offer QR code" data-testid="offer-qr" className="max-h-full max-w-full rounded-lg bg-white p-2 object-contain"/>}
      {offer.consumerUrl && qrSize >= MIN_CONSUMER_QR_SIZE_PX && qrError && <p role="alert" className="text-xs text-red-800">QR code could not be generated. Please retry.</p>}
      {offer.consumerUrl && qrSize < MIN_CONSUMER_QR_SIZE_PX && <p role="status" data-testid="offer-qr-unsupported" className="max-w-[18rem] rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950">This panel is too small for a scan-safe QR. Use Split 50/25/25.</p>}
      {!offer.consumerUrl && previewOnly && <div data-testid="offer-qr-preview-placeholder" className="grid aspect-square max-h-full w-full max-w-[180px] place-items-center rounded-lg border border-dashed border-[#9cac9f] bg-white px-3 text-xs font-medium text-[#50615c]">Campaign tracking QR appears when the campaign is eligible.</div>}
      {!offer.consumerUrl && !previewOnly && <p role="status" data-testid="offer-qr-unavailable" className="text-xs text-[#50615c]">Offer link unavailable.</p>}
    </div>}
    <div className="mt-auto flex max-w-full shrink-0 flex-col items-center gap-2 pt-1">
      {cta}
      <p className="max-w-full text-[10px] leading-snug text-[#50615c]" data-testid="offer-scan-instruction">Open camera <span aria-hidden="true">•</span> Scan <span aria-hidden="true">•</span> Explore</p>
      {previewOnly && <p className="text-[9px] font-medium text-[#65736d]">Preview only · QR is issued for eligible delivery</p>}
    </div>
  </article>;
}
