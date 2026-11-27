/** First-party layouts accepted by the Admin campaign create/update contract. */
export const CAMPAIGN_PRESENTATION_LAYOUTS = [
  "FULLSCREEN_AD",
  "FOUR_ZONE",
  "FOUR_ZONE_V3",
  "SPLIT_50_25_25",
  "MBOX_AD_QR_SPONSOR_V1",
] as const;

export type CampaignPresentationLayout = typeof CAMPAIGN_PRESENTATION_LAYOUTS[number];
