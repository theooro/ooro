import type { PreviewLayout } from './creative-fit.js';

export type CampaignLayoutSelection = PreviewLayout;

const campaignLayouts = new Set<CampaignLayoutSelection>([
  'SCREEN_ASSIGNED', 'FULLSCREEN_AD', 'FOUR_ZONE', 'FOUR_ZONE_V3', 'SPLIT_50_25_25', 'THREE_ZONE_AD_SPONSOR_QR_V1',
]);

export function readCampaignLayoutSelection(value: unknown): CampaignLayoutSelection {
  return typeof value === 'string' && campaignLayouts.has(value as CampaignLayoutSelection)
    ? value as CampaignLayoutSelection
    : 'SCREEN_ASSIGNED';
}

/** Both selectors write the same value so the preview always describes the saved playback choice. */
export function campaignLayoutSelection(value: CampaignLayoutSelection) {
  return { campaignLayout: value, previewLayout: value };
}
