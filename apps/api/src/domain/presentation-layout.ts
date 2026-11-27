export const THREE_ZONE_AD_SPONSOR_QR_V1 = 'THREE_ZONE_AD_SPONSOR_QR_V1' as const

/** First-party, fixed geometry for the 1280x720 MBOX profile. Slot contents remain scheduler-owned. */
export const THREE_ZONE_AD_SPONSOR_QR_CONTRACT_V1 = {
  type: THREE_ZONE_AD_SPONSOR_QR_V1,
  contractVersion: 1,
  layoutVersion: 1,
  primaryWidthPercent: 65,
  qrHeightPercent: 75,
  sponsoredHeightPercent: 25,
  minWidthPx: 1280,
  minHeightPx: 720,
} as const

export const PRESENTATION_LAYOUTS = [
  'SCREEN_ASSIGNED',
  'FULLSCREEN_AD',
  'FOUR_ZONE',
  'FOUR_ZONE_V3',
  'SPLIT_50_25_25',
  THREE_ZONE_AD_SPONSOR_QR_V1,
] as const

export type PresentationLayout = typeof PRESENTATION_LAYOUTS[number]

export function isMapEnabledFourZone(layout: string): boolean {
  return layout === 'FOUR_ZONE_V3'
}
