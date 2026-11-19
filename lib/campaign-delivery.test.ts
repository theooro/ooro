import test from "node:test"
import assert from "node:assert/strict"
import { validateAdvertiserCampaignDraft, hasRemovedCampaignTiming } from "./campaign-draft-validation"
import { campaignDeliveryStateLabel, campaignQuotaLabel } from "./campaign-delivery-presentation"

test("advertiser campaign setup succeeds without delivery dates or daily windows", () => {
  assert.equal(validateAdvertiserCampaignDraft({ name: "Draft", goal: "Awareness", audience: "Local", city: "Bengaluru", area: "Indiranagar", budget: 500 }), null)
})

test("legacy timing inputs are rejected rather than silently treated as campaign state", () => {
  assert.equal(hasRemovedCampaignTiming({ name: "Draft", startsAt: "2026-01-01" }), true)
  assert.equal(hasRemovedCampaignTiming({ name: "Draft", startTime: "08:00", weekdays: [1, 2] }), true)
  assert.equal(hasRemovedCampaignTiming({ name: "Draft", status: "DRAFT" }), false)
})

test("campaign presentation reports state and explicit quota, including safe legacy labeling", () => {
  assert.equal(campaignDeliveryStateLabel("ACTIVE"), "ACTIVE")
  assert.equal(campaignDeliveryStateLabel("SCHEDULED"), "LEGACY · REVIEW REQUIRED")
  assert.equal(campaignQuotaLabel({ offlinePlaysPerDisplay: 250 }), "250")
  assert.equal(campaignQuotaLabel({ unlimitedOfflineDelivery: true }), "Unlimited · explicit authorization")
  assert.equal(campaignQuotaLabel({}), "Not authorized")
})
