export function campaignDeliveryStateLabel(status: string): string {
  return status === "SCHEDULED" ? "LEGACY · REVIEW REQUIRED" : status.replaceAll("_", " ")
}

export function campaignQuotaLabel(campaign: { unlimitedOfflineDelivery?: boolean; offlinePlaysPerDisplay?: number | null }): string {
  if (campaign.unlimitedOfflineDelivery === true) return "Unlimited · explicit authorization"
  return campaign.offlinePlaysPerDisplay != null && campaign.offlinePlaysPerDisplay > 0
    ? campaign.offlinePlaysPerDisplay.toLocaleString("en-IN")
    : "Not authorized"
}

export function withoutCampaignDeliveryDates<T extends { startsAt?: unknown; endsAt?: unknown }>(campaign: T): Omit<T, "startsAt" | "endsAt"> {
  const publicCampaign = { ...campaign }
  delete publicCampaign.startsAt
  delete publicCampaign.endsAt
  return publicCampaign
}
