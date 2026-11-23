import assert from "node:assert/strict";
import test from "node:test";
import { campaignAssignmentPlaybackStatus } from "./playback-status";

const now = Date.parse("2026-11-22T12:00:00.000Z");
const base = {
  connectivity: "ONLINE",
  lastHeartbeatAt: new Date(now - 5_000).toISOString(),
  currentCampaignId: "campaign-a",
  currentCreativeId: "creative-a",
  currentPlaybackState: "PLAYING",
  currentPlaybackStartedAt: new Date(now - 20_000).toISOString(),
  proofs: [{ creativeId: "creative-a", playbackStartedAt: new Date(now - 20_000).toISOString(), playbackCompleted: true, status: "VALID" }],
};

test("only a fresh matching device report and proof are labeled currently playing", () => {
  assert.deepEqual(campaignAssignmentPlaybackStatus(base, "campaign-a", now), {
    report: "CURRENTLY PLAYING · PROOF ACKNOWLEDGED",
    proof: "ACKNOWLEDGED",
    lastReportedAt: base.lastHeartbeatAt,
  });
  assert.equal(campaignAssignmentPlaybackStatus({ ...base, proofs: [] }, "campaign-a", now).report, "DEVICE REPORTS PLAYING · PROOF NOT ACKNOWLEDGED");
  assert.equal(campaignAssignmentPlaybackStatus({ ...base, currentCampaignId: "campaign-b" }, "campaign-a", now).report, "DEVICE REPORTS PLAYING · CAMPAIGN MISMATCH");
});

test("stale reports and old proof history never become current playback", () => {
  const stale = { ...base, connectivity: "STALE", lastHeartbeatAt: new Date(now - 90_001).toISOString() };
  assert.equal(campaignAssignmentPlaybackStatus(stale, "campaign-a", now).report, "LAST REPORTED PLAYING · STALE");
  assert.equal(campaignAssignmentPlaybackStatus(stale, "campaign-a", now).proof, "ACKNOWLEDGED");

  const oldProof = { ...base, proofs: [{ ...base.proofs[0]!, playbackStartedAt: new Date(now - 6 * 60_000).toISOString() }] };
  assert.equal(campaignAssignmentPlaybackStatus(oldProof, "campaign-a", now).report, "DEVICE REPORTS PLAYING · PROOF NOT ACKNOWLEDGED");
});

test("idle reports remain distinct from scheduled campaign state and historical proofs", () => {
  const idle = { ...base, currentPlaybackState: "IDLE" };
  assert.equal(campaignAssignmentPlaybackStatus(idle, "campaign-a", now).report, "DEVICE REPORTS IDLE");
  assert.equal(campaignAssignmentPlaybackStatus(idle, "campaign-a", now).proof, "ACKNOWLEDGED");
  assert.equal(campaignAssignmentPlaybackStatus({ ...idle, connectivity: "ONLINE", lastHeartbeatAt: null }, "campaign-a", now).report, "PLAYBACK STATUS UNKNOWN · STALE");
});
