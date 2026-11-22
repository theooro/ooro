export type AdminRole = "SUPER_ADMIN" | "ADMIN" | "OPERATIONS" | "SUPPORT" | "FINANCE";
export type ScreenType = "AUTO_SCREEN" | "CAB_SCREEN" | "RETAIL_SCREEN" | "BILLBOARD_SCREEN" | "OTHER";
export type PairingStatus = "UNPAIRED" | "PAIRING_CODE_ACTIVE" | "PAIRING" | "PAIRED" | "PAIRING_FAILED" | "PAIRING_EXPIRED" | "REMOVAL_PENDING";
export type ConnectivityStatus = "ONLINE" | "STALE" | "OFFLINE" | "NEVER_CONNECTED";
export type PlayerStatus = "STARTING" | "SYNCING" | "READY" | "IDLE" | "LOADING" | "PLAYING" | "PAUSED" | "FAILED" | "FALLBACK" | "OFFLINE_PLAYBACK" | "ERROR";
export type ManifestStatus = "CURRENT" | "DOWNLOADING" | "PENDING_ACTIVATION" | "OUTDATED" | "ERROR";
export type HealthSeverity = "HEALTHY" | "INFO" | "WARNING" | "CRITICAL";
export type NetworkType = "WIFI" | "CELLULAR" | "ETHERNET" | "OFFLINE" | "UNKNOWN";

export interface AdminUser { id: string; name: string; role: AdminRole }
export interface Screen {
  screenId: string; deviceId: string; screenName: string; inventoryId?: string; vehicleId?: string;
  screenType: ScreenType; city: string; area: string; createdAt: string; pairedAt?: string; pairingStatus: PairingStatus;
  vehicleIdentifier?: string | null; latitude?: number | null; longitude?: number | null; lastLocationAt?: string | null; lastHeartbeatAt?: string | null;
  connectivity?: ConnectivityStatus;
  currentCampaignId?: string | null; currentCampaignName?: string | null; currentCreativeId?: string | null; currentCreativeName?: string | null;
  currentCreativeUrl?: string | null; currentCreativeMimeType?: string | null; currentCreativeFileName?: string | null;
  playbackState?: string | null; playbackStartedAt?: string | null; playbackPositionMs?: number | null; expectedDurationMs?: number | null;
  manifestVersion?: number | null; networkType?: string | null; appVersion?: string | null; playerUpdateStatus?: "UP_TO_DATE" | "UPDATE_AVAILABLE" | "UNKNOWN";
  currentCreativeTrust?: "VERIFIED_RECENT_PROOF" | "UNKNOWN"; currentLayout?: string | null; currentLayoutVersion?: number | null; layoutReportStatus?: "CURRENT" | "STALE" | "UNREPORTED"; assignedLayout?: string | null; assignedLayoutVersion?: number | null;
  lastSuccessfulSync?: string | null; latestProof?: { creativeId?: string | null; campaignId?: string | null; playbackStartedAt?: string; slot?: string; status?: string } | null;
  latestCommand?: DeviceCommand | null; diagnostics?: { networkType?: string | null; networkConnected?: boolean | null; storageFreeBytes?: number | null; storageTotalBytes?: number | null; playerState?: string | null; manifestVersion?: number | null; activeLayout?: string | null; layoutContractVersion?: number | null; layoutReportedAt?: string | null } | null;
}
export interface DeviceHeartbeat {
  id: string; screenId: string; deviceId: string; timestamp: string; appVersion: string; appVersionCode?: number;
  androidVersion: string; manufacturer: string; model: string; networkType: NetworkType; networkConnected: boolean;
  signalStrength?: number; freeStorageBytes?: number; totalStorageBytes?: number; currentCampaignId?: string;
  currentCreativeId?: string; currentCreativeName?: string; currentCampaignName?: string; playbackStartedAt?: string;
  expectedDurationSeconds?: number; manifestVersion?: number; kioskActive?: boolean; deviceOwner?: boolean;
  playerState: PlayerStatus; syncState?: string; lastManifestSync?: string; availableAssetCount?: number;
  pendingAssetCount?: number; failedAssetCount?: number; errorMessage?: string;
  currentAssetId?: string; playbackPositionMs?: number; expectedDurationMs?: number; latitude?: number; longitude?: number; accuracyMeters?: number; locationOccurredAt?: string;
  currentCreativeUrl?: string; currentCreativeMimeType?: string; currentCreativeFileName?: string; vehicleIdentifier?: string; batteryLevel?: number; chargingState?: string;
  connectivity?: ConnectivityStatus; lastProof?: { eventType?: string; occurredAt?: string; campaignId?: string; creativeId?: string; playbackCompleted?: boolean; status?: string } | null;
}
export interface HealthIssue { code: string; label: string; severity: HealthSeverity; detail: string }
export interface DeviceHealth extends DeviceHeartbeat { connectivity: ConnectivityStatus; issues: HealthIssue[]; storageHealth: "NORMAL" | "LOW" | "CRITICAL" | "UNKNOWN" }
export interface DeviceActivity { id: string; screenId: string; type: string; timestamp: string; detail?: string }
export interface PairingCode { code: string | null; screenId: string; status: "ACTIVE" | "USED" | "EXPIRED" | "REVOKED"; expiresAt: string | null; createdAt: string }
export interface CreateScreenInput { screenName: string; screenType: ScreenType; city: string; area: string; vehicleId?: string; inventoryId?: string; notes?: string }
export interface DeviceCommand { id: string; screenId: string; type: "SYNC_NOW" | "SYNC_MANIFEST" | "REFRESH_MANIFEST" | "HEALTH_CHECK" | "RESTART_PLAYER" | "REBOOT_DEVICE" | "UNPAIR"; status: "QUEUED" | "DELIVERED" | "RECEIVED" | "PROCESSING" | "ACKNOWLEDGED" | "SUCCESS" | "SUCCEEDED" | "FAILED" | "EXPIRED" | "CANCELLED"; createdAt: string; deliveredAt?: string | null; acknowledgedAt?: string | null; failedAt?: string | null; cancelledAt?: string | null; expiresAt?: string | null; error?: string | null }
export interface ScreenFilters { search?: string; status?: ConnectivityStatus; pairing?: PairingStatus; screenType?: ScreenType; city?: string; area?: string; appVersion?: string; manifestVersion?: string; issuesOnly?: boolean; sort?: "heartbeat" | "name" | "app" | "storage" | "created" | "status" }
