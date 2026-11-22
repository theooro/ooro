import test from "node:test"
import assert from "node:assert/strict"
import { getDisplayConnectivity, isVerifiedCurrentPlayback } from "./display-health.js"

const now = Date.parse("2026-09-09T12:00:00.000Z")

test("display heartbeat connectivity transitions from online to stale to offline", () => {
  const reference = new Date(now)
  assert.equal(getDisplayConnectivity(new Date("2026-09-09T11:59:30.000Z"), reference), "ONLINE")
  assert.equal(getDisplayConnectivity(new Date("2026-09-09T11:57:00.000Z"), reference), "STALE")
  assert.equal(getDisplayConnectivity(new Date("2026-09-09T11:50:00.000Z"), reference), "OFFLINE")
  assert.equal(getDisplayConnectivity(undefined, reference), "NEVER_CONNECTED")
})

test("fleet connectivity threshold boundaries are explicit and deterministic", () => {
  const reference = new Date(now)
  assert.equal(getDisplayConnectivity(new Date(now - 90_000), reference), "ONLINE")
  assert.equal(getDisplayConnectivity(new Date(now - 90_001), reference), "STALE")
  assert.equal(getDisplayConnectivity(new Date(now - 300_000), reference), "STALE")
  assert.equal(getDisplayConnectivity(new Date(now - 300_001), reference), "OFFLINE")
  assert.equal(getDisplayConnectivity(new Date("invalid"), reference), "NEVER_CONNECTED")
})

test("current playback requires a fresh device report and an acknowledged proof for that exact creative session", () => {
  const startedAt = new Date(now - 20_000)
  const base = {
    lastHeartbeatAt: new Date(now - 5_000),
    currentPlaybackState: "PLAYING",
    currentCampaignId: "campaign-current",
    currentCreativeId: "creative-current",
    currentPlaybackStartedAt: startedAt,
    proof: { campaignId: "campaign-current", creativeId: "creative-current", playbackStartedAt: startedAt, playbackCompleted: true, status: "VALID" },
  }

  assert.equal(isVerifiedCurrentPlayback(base, new Date(now)), true)
  assert.equal(isVerifiedCurrentPlayback({ ...base, proof: null }, new Date(now)), false)
  assert.equal(isVerifiedCurrentPlayback({ ...base, proof: { ...base.proof!, status: "PENDING" } }, new Date(now)), false)
  assert.equal(isVerifiedCurrentPlayback({ ...base, proof: { ...base.proof!, creativeId: "creative-older" } }, new Date(now)), false)
  assert.equal(isVerifiedCurrentPlayback({ ...base, proof: { ...base.proof!, campaignId: "campaign-older" } }, new Date(now)), false)
  assert.equal(isVerifiedCurrentPlayback({ ...base, proof: { ...base.proof!, playbackStartedAt: new Date(now - 90_000) } }, new Date(now)), false)
  assert.equal(isVerifiedCurrentPlayback({ ...base, lastHeartbeatAt: new Date(now - 90_001) }, new Date(now)), false)
  assert.equal(isVerifiedCurrentPlayback({ ...base, lastHeartbeatAt: new Date(now + 30_001) }, new Date(now)), false)
})
