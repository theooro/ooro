import { hasLegacyCampaignTimingFields } from "../apps/api/src/domain/state-based-delivery"

export type AdvertiserCampaignDraft = {
  name?: string; description?: string; goal?: string; audience?: string; city?: string; area?: string;
  media?: string; budget?: number; currency?: string; metadata?: Record<string, unknown>;
  status?: "DRAFT"; pricingPlanId?: string; deliveryTier?: "STANDARD" | "PREMIUM_PLUS";
  campaignCenterLat?: number; campaignCenterLng?: number; radiusKm?: number;
  forecastSnapshot?: Record<string, unknown>; forecastGeneratedAt?: string; forecastExpiresAt?: string; forecastVersion?: string;
}

export function validateAdvertiserCampaignDraft(input: AdvertiserCampaignDraft | null, partial = false): string | null {
  if (!input?.name?.trim()) return "Campaign name is required"
  if (!partial && (!input.goal?.trim() || !input.audience?.trim() || !input.city?.trim() || !input.area?.trim())) return "Goal, audience, city and area are required"
  if (input.budget !== undefined && (!Number.isFinite(input.budget) || input.budget <= 0)) return "Budget must be greater than zero"
  if (input.radiusKm !== undefined && (!Number.isFinite(input.radiusKm) || input.radiusKm < 1 || input.radiusKm > 10)) return "Radius must be between 1 km and 10 km"
  if (input.campaignCenterLat !== undefined && (!Number.isFinite(input.campaignCenterLat) || input.campaignCenterLat < -90 || input.campaignCenterLat > 90)) return "Campaign latitude is invalid"
  if (input.campaignCenterLng !== undefined && (!Number.isFinite(input.campaignCenterLng) || input.campaignCenterLng < -180 || input.campaignCenterLng > 180)) return "Campaign longitude is invalid"
  return null
}

export function hasRemovedCampaignTiming(input: unknown): boolean {
  return hasLegacyCampaignTimingFields(input)
}
