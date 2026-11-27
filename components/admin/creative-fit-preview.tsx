"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { aspectRatioWarning, creativePlacement, THREE_ZONE_AD_SPONSOR_QR_MIN_RESOLUTION, type PreviewLayout } from "@/lib/admin/creative-fit";
import { BrandedQrOfferCard } from "@/components/consumer/branded-qr-offer-card";
import type { ConsumerOfferFields } from "@/lib/consumer/offer-model";

type Props = { file: File | null; layout: PreviewLayout; slot?: "MAIN" | "SPONSORED"; offer?: ConsumerOfferFields; onLayoutChange: (layout: PreviewLayout) => void };
const zoneLabel = "absolute z-10 grid place-items-center overflow-hidden border border-white/25 px-1 text-center text-[9px] font-semibold text-white sm:text-[10px]";

export function CreativeFitPreview({ file, layout, slot = "MAIN", offer = {}, onLayoutChange }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [videoPreviewError, setVideoPreviewError] = useState(false);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const placement = creativePlacement(layout, slot);
  useEffect(() => {
    const element = canvasRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => setCanvasWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!file) { setUrl(null); setDimensions(null); return; }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl); setDimensions(null); setVideoPreviewError(false);
    if (file.type.startsWith("image/")) {
      const image = new window.Image();
      image.onload = () => setDimensions({ width: image.naturalWidth, height: image.naturalHeight });
      image.src = objectUrl;
      return () => { image.onload = null; URL.revokeObjectURL(objectUrl); };
    }
    if (file.type.startsWith("video/")) {
      const video = document.createElement("video");
      video.onloadedmetadata = () => setDimensions({ width: video.videoWidth, height: video.videoHeight });
      video.src = objectUrl;
      return () => { video.onloadedmetadata = null; video.removeAttribute("src"); video.load(); URL.revokeObjectURL(objectUrl); };
    }
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  const warning = dimensions && aspectRatioWarning(dimensions.width, dimensions.height, placement.aspectRatio);
  const previewScale = canvasWidth > 0 ? 1280 / canvasWidth : 1;
  const qrSlotStyle = layout === "THREE_ZONE_AD_SPONSOR_QR_V1"
    ? { left: "65%", top: 0, width: "35%", height: "75%" }
    : layout === "SPLIT_50_25_25"
      ? { left: "75%", top: 0, width: "25%", height: "100%" }
      : layout === "FOUR_ZONE_V3"
        ? { left: "80%", top: 0, width: "20%", height: "50%" }
        : { left: "80%", top: 0, width: "20%", height: "50%" };
  return <section className="mt-4 rounded border border-neutral-200 p-4" aria-label="Creative fit preview">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium">Screen fit preview</p><p className="text-xs text-neutral-500">Contain preserves the full creative; mismatched ratios show letterboxing.</p></div>
      <label className="text-xs">Preview layout <select aria-label="Preview layout" value={layout} onChange={event => onLayoutChange(event.target.value as PreviewLayout)} className="ml-2 rounded border px-2 py-1"><option value="SCREEN_ASSIGNED">Use each screen’s assigned layout</option><option value="FOUR_ZONE">Four-zone contract v2 · Main 80×88, ticker, QR + Map 50/50</option><option value="FOUR_ZONE_V3">Map-enabled four-zone V3 · Main 80×85, Sponsored 15, QR + Map 50/50</option><option value="THREE_ZONE_AD_SPONSOR_QR_V1">Three-zone · Main + Sponsored + QR · no map</option><option value="SPLIT_50_25_25">Split-screen · Main + navigation + offer</option><option value="FULLSCREEN_AD">Fullscreen ad</option></select></label>
    </div>
    <div ref={canvasRef} className="relative mx-auto mt-3 aspect-video w-full max-w-2xl overflow-hidden border border-neutral-500 bg-[#080b0e]" aria-label={`Screen preview ${layout}`} data-testid="campaign-screen-layout-preview">
      {layout === "SCREEN_ASSIGNED" && <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-neutral-300">Each screen uses its own assigned layout. Choose a specific layout to preview its zones.</div>}
      {layout === "FOUR_ZONE" && <><div className={`${zoneLabel} right-0 top-0 h-1/2 w-[20%] bg-[#20252b]`}>QR Offer · 20% × 50%</div><div className={`${zoneLabel} bottom-0 left-0 h-[12%] w-[80%] bg-[#1c232a]`}>News ticker · 80% × 12%</div><div className={`${zoneLabel} bottom-0 right-0 h-1/2 w-[20%] bg-[#121820]`}>Map · fixed runtime widget · 20% × 50%</div></>}
      {layout === "FOUR_ZONE_V3" && <><div className={`${zoneLabel} bottom-0 left-0 h-[15%] w-[80%] bg-[#20252b]`}>Sponsored Ad · 80% × 15%</div><div className={`${zoneLabel} bottom-0 right-0 h-1/2 w-[20%] bg-[#121820]`}>Map · fixed runtime widget</div><div className={`${zoneLabel} left-0 top-0 h-[85%] w-[80%] border-0 bg-transparent`}>Main Ad · 80% × 85%</div></>}
      {layout === "SPLIT_50_25_25" && <><div className={`${zoneLabel} left-1/2 top-0 h-full w-1/4 bg-[#121820]`}>Navigation / Map</div><div className={`${zoneLabel} right-0 top-0 h-full w-1/4 bg-[#20252b]`}>QR Offer</div></>}
      {layout === "THREE_ZONE_AD_SPONSOR_QR_V1" && <><div className={`${zoneLabel} bottom-0 right-0 h-1/4 w-[35%] bg-[#20252b]`}>Sponsored Ad · 35% × 25%</div><div className={`${zoneLabel} left-0 top-0 h-full w-[65%] border-0 bg-transparent`}>Main Ad · 65%</div></>}
      {layout !== "SCREEN_ASSIGNED" && layout !== "FULLSCREEN_AD" && <div data-testid="preview-qr-offer-slot" aria-label="QR offer zone" className="absolute overflow-hidden" style={qrSlotStyle}><BrandedQrOfferCard offer={offer} previewOnly previewScale={previewScale} className="rounded-none border-0 p-1 sm:p-1"/></div>}
      {layout !== "SCREEN_ASSIGNED" && <div className="absolute overflow-hidden bg-black" style={{ left: `${placement.x * 100}%`, top: `${placement.y * 100}%`, width: `${placement.width * 100}%`, height: `${placement.height * 100}%` }}>
        {file && url && file.type.startsWith("image/") && <Image src={url} alt="Creative preview with contain fit" fill unoptimized className="object-contain"/>}
        {file && url && file.type.startsWith("video/") && <video src={url} aria-label="Video creative preview with contain fit" autoPlay loop controls muted playsInline onError={() => setVideoPreviewError(true)} className="h-full w-full object-contain"/>}
        {videoPreviewError && <p role="status" className="absolute inset-x-2 bottom-2 rounded bg-black/80 p-2 text-center text-[11px] leading-4 text-white">This browser cannot preview the source video. OORO will optimize it for screen playback when you save.</p>}
        {!file && <p className="absolute inset-0 grid place-items-center px-2 text-center text-xs text-neutral-500">Choose an image or video to preview</p>}
      </div>}
    </div>
    {layout === "THREE_ZONE_AD_SPONSOR_QR_V1" && <p className="mt-2 text-xs text-neutral-600">Built-in v1 requires at least {THREE_ZONE_AD_SPONSOR_QR_MIN_RESOLUTION.width}×{THREE_ZONE_AD_SPONSOR_QR_MIN_RESOLUTION.height}; smaller targets are blocked to preserve scan size.</p>}
    <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-neutral-500"><span>Ad region {Math.round(placement.width * 100)}% × {Math.round(placement.height * 100)}% · {placement.aspectRatio.toFixed(2)}:1</span>{dimensions && <span>Creative {dimensions.width} × {dimensions.height}</span>}</div>
    {warning && <p role="status" className="mt-2 text-sm text-amber-800">{warning}</p>}
  </section>;
}
