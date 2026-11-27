"use client";

import { useState } from 'react';
import Image from 'next/image';
import type { LayoutZone } from '@/apps/api/src/domain/layout-studio';
import { mboxProfile } from '@/apps/api/src/domain/layout-studio';
import { matchingLayoutCreatives, type LayoutCatalog } from '@/lib/admin/layout-studio-model';
import { BrandedQrOfferCard } from '@/components/consumer/branded-qr-offer-card';

export function LayoutWidgetPreview({ zone, catalog }: { zone: LayoutZone; catalog: LayoutCatalog }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const reference = zone.rotation?.items[0]?.referenceId ?? zone.contentBinding.referenceId;
  const creative = matchingLayoutCreatives(catalog, zone).find(creative => creative.id === reference);
  const provider = mboxProfile.widgets[zone.type];
  const image = ['IMAGE', 'LOGO', 'BACKGROUND_IMAGE'].includes(zone.type) && creative?.type === 'IMAGE' ? creative : null;
  const destination = zone.type === 'QR_OFFER' ? catalog.destinations.find(item => item.id === reference) : null;
  const offerPreview = destination ? <BrandedQrOfferCard offer={{ id: destination.id, campaignId: destination.campaign.id, creativeId: destination.creative?.id, brandName: destination.brandName, offerTitle: destination.offerTitle, promotionalText: destination.promotionalText, offerSubtitle: destination.offerSubtitle, offerValue: destination.offerValue, ctaLabel: destination.ctaLabel }} qrUrl={destination.consumerUrl} ctaHref={destination.destinationUrl} className="rounded-none border-0 p-1 sm:p-1"/> : null;
  if (zone.type === 'QR_OFFER') return <div className="pointer-events-none h-full w-full overflow-hidden" data-testid={`widget-preview-${zone.id}`}>{offerPreview ?? <div role="status" className="grid h-full place-items-center p-2 text-center text-[clamp(8px,1vw,12px)] text-amber-100">{reference ? 'Bound QR offer unavailable: check its approved campaign and destination.' : 'Select an authorized destination to preview the OORO offer card.'}<span className="mt-1 block text-[10px]">Publishing remains blocked until this device profile is certified.</span></div>}</div>;
  return <div className="pointer-events-none flex h-full w-full flex-col items-center justify-center overflow-hidden text-center" data-testid={`widget-preview-${zone.id}`}>
    {image?.previewUrl && failedUrl !== image.previewUrl ? <Image src={image.previewUrl} width={1600} height={900} unoptimized alt={`Approved image: ${image.name}`} onError={() => setFailedUrl(image.previewUrl!)} className="h-full w-full" style={{ objectFit: zone.fit === 'CENTER_CROP' ? 'cover' : 'contain' }}/> : <span className="px-2">{zone.type === 'TEXT' ? zone.label : zone.type.replaceAll('_', ' ')}</span>}
    {zone.type !== 'TEXT' && <span className="absolute bottom-0 left-0 right-0 bg-black/80 px-2 py-1 text-[10px]">{creative ? `${creative.name} · ${zone.type} · ${zone.rotation ? 'first rotation item' : 'bound'}` : `${zone.type} · ${!provider.provider ? 'runtime unavailable' : reference ? 'binding unavailable or wrong media type' : 'no approved binding'}`}</span>}
    {image && (!image.previewUrl || failedUrl === image.previewUrl) && <span role="alert" className="px-2 text-amber-200">Approved image preview unavailable</span>}
    {!provider.provider && <span className="px-2 text-[10px] text-amber-200">Unavailable: {provider.reason}</span>}
    {zone.type === 'VIDEO' && <span className="px-2 text-[10px] text-amber-200">Draft only · playback not certified</span>}
  </div>;
}
