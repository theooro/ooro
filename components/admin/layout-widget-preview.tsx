"use client";

import type { LayoutZone } from '@/apps/api/src/domain/layout-studio';
import { mboxProfile } from '@/apps/api/src/domain/layout-studio';

const slotCopy: Record<string, string> = {
  MAIN_AD: 'Scheduler fills this slot with the highest-ranked eligible main creative.',
  SPONSORED_AD: 'Scheduler fills this independent slot only with an eligible sponsored image.',
  IMAGE: 'Scheduler supplies eligible, approved image media at playback.',
  VIDEO: 'Scheduler supplies eligible media; video playback remains profile-gated.',
  LOGO: 'Scheduler supplies eligible, approved image media at playback.',
  BACKGROUND_IMAGE: 'Scheduler supplies eligible, approved image media at playback.',
  QR_OFFER: 'Uses the currently scheduled campaign’s explicitly enabled, authorized tracked offer.',
  NAVIGATION_MAP: 'Fixed runtime widget; requires device location and configured map tiles.',
  CLOCK: 'Fixed runtime widget; reads device time.',
  WEATHER: 'Fixed runtime widget; requires a configured weather provider.',
  TICKER: 'Runtime widget; requires an available announcement feed.',
  TEXT: 'Static layout label.',
};

export function LayoutWidgetPreview({ zone }: { zone: LayoutZone; catalog?: unknown }) {
  const certification = mboxProfile.widgets[zone.type];
  const isRuntime = ['NAVIGATION_MAP', 'CLOCK', 'WEATHER', 'TICKER'].includes(zone.type);
  return <div className="pointer-events-none flex h-full w-full flex-col items-center justify-center overflow-hidden bg-[#121815] p-2 text-center" data-testid={`widget-preview-${zone.id}`} data-widget-type={zone.type}>
    <span className="text-[clamp(9px,1.2vw,16px)] font-semibold text-white">{zone.label || zone.type.replaceAll('_', ' ')}</span>
    <span className="mt-1 max-w-full text-[clamp(7px,.8vw,11px)] leading-snug text-neutral-300">{slotCopy[zone.type] ?? 'Scheduler resolves eligible content at playback.'}</span>
    {isRuntime && <span className="mt-1 text-[clamp(7px,.75vw,10px)] text-amber-200">{certification.provider ? 'Runtime acceptance pending' : `Unavailable: ${certification.reason}`}</span>}
    {zone.type === 'QR_OFFER' && <span className="mt-1 text-[clamp(7px,.75vw,10px)] text-amber-200">No campaign QR is fabricated in layout preview.</span>}
    <span className="mt-1 text-[clamp(7px,.7vw,9px)] text-neutral-500">Custom publishing remains blocked until profile certification passes.</span>
  </div>;
}
