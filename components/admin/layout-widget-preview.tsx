"use client";

import { useState } from 'react';
import type { LayoutZone } from '@/apps/api/src/domain/layout-studio';
import { mboxProfile } from '@/apps/api/src/domain/layout-studio';
import { matchingLayoutCreatives, type LayoutCatalog } from '@/lib/admin/layout-studio-model';

export function LayoutWidgetPreview({ zone, catalog }: { zone: LayoutZone; catalog: LayoutCatalog }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const reference = zone.rotation?.items[0]?.referenceId ?? zone.contentBinding.referenceId;
  const creative = matchingLayoutCreatives(catalog, zone).find(creative => creative.id === reference);
  const provider = mboxProfile.widgets[zone.type];
  const image = ['IMAGE', 'LOGO', 'BACKGROUND_IMAGE'].includes(zone.type) && creative?.type === 'IMAGE' ? creative : null;
  return <div className="pointer-events-none flex h-full w-full flex-col items-center justify-center overflow-hidden text-center" data-testid={`widget-preview-${zone.id}`}>
    {image?.previewUrl && failedUrl !== image.previewUrl ? <img src={image.previewUrl} alt={`Approved image: ${image.name}`} onError={() => setFailedUrl(image.previewUrl!)} className="h-full w-full" style={{ objectFit: zone.fit === 'CENTER_CROP' ? 'cover' : 'contain' }}/> : <span className="px-2">{zone.type === 'TEXT' ? zone.label : zone.type.replaceAll('_', ' ')}</span>}
    {zone.type !== 'TEXT' && <span className="absolute bottom-0 left-0 right-0 bg-black/80 px-2 py-1 text-[10px]">{creative ? `${creative.name} · ${zone.type} · ${zone.rotation ? 'first rotation item' : 'bound'}` : `${zone.type} · ${!provider.provider ? 'runtime unavailable' : reference ? 'binding unavailable or wrong media type' : 'no approved binding'}`}</span>}
    {image && (!image.previewUrl || failedUrl === image.previewUrl) && <span role="alert" className="px-2 text-amber-200">Approved image preview unavailable</span>}
    {!provider.provider && <span className="px-2 text-[10px] text-amber-200">Unavailable: {provider.reason}</span>}
    {zone.type === 'VIDEO' && <span className="px-2 text-[10px] text-amber-200">Draft only · playback not certified</span>}
  </div>;
}
