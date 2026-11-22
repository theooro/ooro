import test from "node:test"
import assert from "node:assert/strict"
import { validateAdvertiserCampaignDraft, hasRemovedCampaignTiming } from "./campaign-draft-validation"
import { campaignDeliveryStateLabel, campaignQuotaLabel } from "./campaign-delivery-presentation"

test("advertiser campaign setup succeeds with inclusive calendar dates and no daily windows", () => {
  assert.equal(validateAdvertiserCampaignDraft({ name: "Draft", goal: "Awareness", audience: "Local", city: "Bengaluru", area: "Indiranagar", budget: 500 }), null)
  assert.equal(validateAdvertiserCampaignDraft({ name: "Date only", goal: "Awareness", audience: "Local", city: "Bengaluru", area: "Indiranagar", startDate: "2026-11-22", endDate: "2026-11-22" }), null)
  assert.equal(validateAdvertiserCampaignDraft({ name: "Citywide brief", goal: "Reach", audience: "Local customers", city: "Bengaluru", area: "Bengaluru", startDate: "2026-11-22", endDate: "2026-11-27", metadata: { target: { mode: "CITYWIDE" } } }), null)
  assert.equal(validateAdvertiserCampaignDraft({ name: "Partial dates", goal: "Awareness", audience: "Local", city: "Bengaluru", area: "Indiranagar", startDate: "2026-11-22" }), "Choose both a start date and an end date")
  assert.equal(validateAdvertiserCampaignDraft({ name: "Invalid date", goal: "Awareness", audience: "Local", city: "Bengaluru", area: "Indiranagar", startDate: "2026-02-30", endDate: "2026-03-01" }), "Choose valid inclusive campaign dates in Asia/Kolkata")
})

test("legacy timing inputs are rejected rather than silently treated as campaign state", () => {
  assert.equal(hasRemovedCampaignTiming({ name: "Draft", startsAt: "2026-01-01" }), true)
  assert.equal(hasRemovedCampaignTiming({ name: "Draft", startTime: "08:00", weekdays: [1, 2] }), true)
  assert.equal(hasRemovedCampaignTiming({ name: "Draft", startDate: "2026-01-01", endDate: "2026-01-02", metadata: { timezone: "Asia/Kolkata" } }), false)
  assert.equal(hasRemovedCampaignTiming({ name: "Draft", startDate: "2026-01-01", endDate: "2026-01-02", metadata: { adminSchedule: { startTime: "08:00" } } }), true)
  assert.equal(hasRemovedCampaignTiming({ name: "Draft", startDate: "2026-01-01", endDate: "2026-01-02", metadata: { timezone: "UTC" } }), true)
  assert.equal(hasRemovedCampaignTiming({ name: "Draft", status: "DRAFT" }), false)
})

test("campaign presentation reports state and explicit quota, including safe legacy labeling", () => {
  assert.equal(campaignDeliveryStateLabel("ACTIVE"), "ACTIVE")
  assert.equal(campaignDeliveryStateLabel("SCHEDULED"), "LEGACY · REVIEW REQUIRED")
  assert.equal(campaignQuotaLabel({ offlinePlaysPerDisplay: 250 }), "250")
  assert.equal(campaignQuotaLabel({ unlimitedOfflineDelivery: true }), "Unlimited · explicit authorization")
  assert.equal(campaignQuotaLabel({}), "Not authorized")
})
