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
