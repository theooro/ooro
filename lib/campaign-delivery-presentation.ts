export function campaignDeliveryStateLabel(status: string): string {
  return status === "SCHEDULED" ? "LEGACY · REVIEW REQUIRED" : status.replaceAll("_", " ")
}

export function campaignQuotaLabel(_campaign?: { unlimitedOfflineDelivery?: boolean; offlinePlaysPerDisplay?: number | null }): string {
  return "No per-screen play limit"
}

export function withoutCampaignDeliveryDates<T extends { startsAt?: unknown; endsAt?: unknown }>(campaign: T): Omit<T, "startsAt" | "endsAt"> {
  const publicCampaign = { ...campaign }
  delete publicCampaign.startsAt
  delete publicCampaign.endsAt
  return publicCampaign
}
