export type DisplayConnectivity = 'ONLINE' | 'STALE' | 'OFFLINE' | 'NEVER_CONNECTED'
export const DISPLAY_ONLINE_THRESHOLD_SECONDS = 90
export const DISPLAY_STALE_THRESHOLD_SECONDS = 300

export const getDisplayConnectivity = (lastHeartbeat: Date | undefined, now = new Date(), onlineSeconds = DISPLAY_ONLINE_THRESHOLD_SECONDS, staleSeconds = DISPLAY_STALE_THRESHOLD_SECONDS): DisplayConnectivity => {
  if (!lastHeartbeat) return 'NEVER_CONNECTED'
  if (!Number.isFinite(lastHeartbeat.getTime()) || !Number.isFinite(now.getTime())) return 'NEVER_CONNECTED'
  const ageSeconds = Math.max(0, (now.getTime() - lastHeartbeat.getTime()) / 1000)
  if (ageSeconds <= onlineSeconds) return 'ONLINE'
  if (ageSeconds <= staleSeconds) return 'STALE'
  return 'OFFLINE'
}

export type VerifiedPlaybackProof = {
  campaignId?: string | null
  creativeId?: string | null
  playbackStartedAt: Date
  playbackCompleted: boolean
  status: string
}

export type CurrentDisplayPlaybackReport = {
  lastHeartbeatAt?: Date | null
  currentPlaybackState?: string | null
  currentCampaignId?: string | null
  currentCreativeId?: string | null
  currentPlaybackStartedAt?: Date | null
  proof?: VerifiedPlaybackProof | null
}

/** A live playing status needs a fresh online report and a valid proof for that same creative session. */
export function isVerifiedCurrentPlayback(
  report: CurrentDisplayPlaybackReport,
  now = new Date(),
  onlineThresholdMs = DISPLAY_ONLINE_THRESHOLD_SECONDS * 1000,
  proofFreshnessMs = 5 * 60_000,
): boolean {
  const heartbeatAt = report.lastHeartbeatAt?.getTime()
  const playbackStartedAt = report.currentPlaybackStartedAt?.getTime()
  const proof = report.proof
  if (report.currentPlaybackState !== 'PLAYING' || !report.currentCampaignId || !report.currentCreativeId) return false
  if (heartbeatAt === undefined || !Number.isFinite(heartbeatAt) || heartbeatAt > now.getTime() + 30_000 || now.getTime() - heartbeatAt > onlineThresholdMs) return false
  if (playbackStartedAt === undefined || !Number.isFinite(playbackStartedAt) || playbackStartedAt > now.getTime() + 30_000) return false
  if (!proof || proof.status !== 'VALID' || !proof.playbackCompleted || proof.campaignId !== report.currentCampaignId || proof.creativeId !== report.currentCreativeId) return false
  const proofStartedAt = proof.playbackStartedAt.getTime()
  if (!Number.isFinite(proofStartedAt) || proofStartedAt > now.getTime() + 30_000 || now.getTime() - proofStartedAt > proofFreshnessMs) return false
  return Math.abs(proofStartedAt - playbackStartedAt) <= 30_000
}
