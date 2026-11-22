export type CampaignAssignmentPlaybackReport = {
  connectivity?: string | null;
  lastHeartbeatAt?: string | null;
  currentCampaignId?: string | null;
  currentCreativeId?: string | null;
  currentPlaybackState?: string | null;
  currentPlaybackStartedAt?: string | null;
  proofs?: Array<{
    creativeId?: string | null;
    playbackStartedAt: string;
    playbackCompleted?: boolean;
    status: string;
  }>;
};

export type CampaignAssignmentPlaybackStatus = {
  report: string;
  proof: string;
  lastReportedAt: string | null;
};

const HEARTBEAT_ONLINE_MS = 90_000;
const PROOF_RECENT_MS = 5 * 60_000;

export function campaignAssignmentPlaybackStatus(
  screen: CampaignAssignmentPlaybackReport,
  campaignId: string,
  now = Date.now(),
): CampaignAssignmentPlaybackStatus {
  const reportTime = screen.lastHeartbeatAt ? Date.parse(screen.lastHeartbeatAt) : NaN;
  const reportTimeValid = Number.isFinite(reportTime) && reportTime <= now + 30_000;
  const reportFresh = reportTimeValid && now - reportTime <= HEARTBEAT_ONLINE_MS && screen.connectivity === "ONLINE";
  const stateIsPlaying = screen.currentPlaybackState === "PLAYING";
  const proof = screen.proofs?.[0];
  const proofTime = proof ? Date.parse(proof.playbackStartedAt) : NaN;
  const samePlaybackProof = Boolean(
    proof && proof.status === "VALID" && proof.playbackCompleted === true &&
    proof.creativeId && proof.creativeId === screen.currentCreativeId &&
    Number.isFinite(proofTime) && proofTime <= now + 30_000 && now - proofTime <= PROOF_RECENT_MS &&
    screen.currentPlaybackStartedAt && Math.abs(proofTime - Date.parse(screen.currentPlaybackStartedAt)) <= 30_000,
  );

  let report: string;
  if (!reportTimeValid || !reportFresh) {
    report = stateIsPlaying ? "LAST REPORTED PLAYING · STALE" : "PLAYBACK STATUS UNKNOWN · STALE";
  } else if (stateIsPlaying && screen.currentCampaignId === campaignId) {
    report = samePlaybackProof ? "CURRENTLY PLAYING · PROOF ACKNOWLEDGED" : "DEVICE REPORTS PLAYING · PROOF NOT ACKNOWLEDGED";
  } else if (stateIsPlaying) {
    report = "DEVICE REPORTS PLAYING · CAMPAIGN MISMATCH";
  } else if (screen.currentPlaybackState === "IDLE" || screen.currentPlaybackState === "READY") {
    report = "DEVICE REPORTS IDLE";
  } else {
    report = "DEVICE REPORTS " + (screen.currentPlaybackState?.replaceAll("_", " ") || "UNKNOWN");
  }

  const proofStatus = proof?.status === "VALID" && proof.playbackCompleted === true
    ? "ACKNOWLEDGED"
    : proof?.status === "INVALID"
      ? "REJECTED"
      : proof
        ? "PENDING"
        : "NO PROOF RECEIVED";

  return { report, proof: proofStatus, lastReportedAt: Number.isFinite(reportTime) ? new Date(reportTime).toISOString() : null };
}
