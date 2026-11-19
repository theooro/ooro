export type CampaignContinuationInput = {
  status: string
  hasCreative: boolean
  activeDisplayCount: number
  budget?: unknown
  today?: Date
}

export function validateCampaignContinuation(input: CampaignContinuationInput): string | null {
  // A retry after the transition is intentionally a successful no-op.
  if (input.status === "SCHEDULED") return "Legacy scheduled campaign needs an administrator review before state-based delivery"
  if (input.status === "ACTIVE") return null
  if (!["DRAFT", "CREATIVE_REQUIRED", "READY"].includes(input.status)) return "Campaign is not in a state that can continue"
  if (!input.hasCreative) return "Persist a creative before continuing setup"
  if (input.activeDisplayCount < 1) return "Assign at least one display before continuing setup"
  if (typeof input.budget !== "number" || !Number.isFinite(input.budget) || input.budget <= 0) return "Budget must be greater than zero"
  return null
}
