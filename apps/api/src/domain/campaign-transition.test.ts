import test from "node:test"
import assert from "node:assert/strict"
import { validateCampaignContinuation } from "./campaign-transition.js"

const valid = {
  status: "DRAFT",
  hasCreative: true,
  activeDisplayCount: 1,
  budget: 500,
}

test("allows a valid campaign with pending display delivery", () => {
  assert.equal(validateCampaignContinuation(valid), null)
})

test("requires a persisted creative", () => {
  assert.equal(validateCampaignContinuation({ ...valid, hasCreative: false }), "Persist a creative before continuing setup")
})

test("requires an active display assignment", () => {
  assert.equal(validateCampaignContinuation({ ...valid, activeDisplayCount: 0 }), "Assign at least one display before continuing setup")
})

test("campaign continuation does not require delivery dates", () => {
  assert.equal(validateCampaignContinuation(valid), null)
  assert.equal(validateCampaignContinuation({ ...valid, budget: 0 }), "Budget must be greater than zero")
})

test("keeps legacy scheduled campaigns out until explicitly reviewed", () => {
  assert.equal(validateCampaignContinuation({ ...valid, status: "SCHEDULED" }), "Legacy scheduled campaign needs an administrator review before state-based delivery")
})

test("makes an already active retry idempotent", () => {
  assert.equal(validateCampaignContinuation({ ...valid, status: "ACTIVE", hasCreative: false, activeDisplayCount: 0 }), null)
})
