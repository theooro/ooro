package com.ooro.screenplayer

import com.ooro.screenplayer.model.DeviceManifest
import com.ooro.screenplayer.model.ManifestItem
import com.ooro.screenplayer.player.ScheduleEngine
import com.ooro.screenplayer.model.CreativeType
import com.ooro.screenplayer.model.DisplayLayout
import java.time.Duration
import java.time.Instant

internal const val MANIFEST_REFRESH_LEAD_MILLIS = 120_000L
internal const val NETWORK_RECOVERY_THROTTLE_MILLIS = 30_000L
internal const val MANIFEST_UPDATE_POLL_INTERVAL_MILLIS = 180_000L

internal fun shouldPollForManifestUpdate(nowElapsedMillis: Long, lastPollElapsedMillis: Long): Boolean =
    lastPollElapsedMillis <= 0L || nowElapsedMillis - lastPollElapsedMillis >= MANIFEST_UPDATE_POLL_INTERVAL_MILLIS

internal fun shouldRefreshAfterNetworkRecovery(nowElapsedMillis: Long, lastRefreshElapsedMillis: Long): Boolean =
    lastRefreshElapsedMillis <= 0L || nowElapsedMillis - lastRefreshElapsedMillis >= NETWORK_RECOVERY_THROTTLE_MILLIS

internal fun syncRetryDelayMillis(attempt: Int, jitterMillis: Long): Long {
    val exponent = attempt.coerceIn(1, 8)
    val baseMillis = (1L shl exponent).coerceAtMost(300L) * 1_000L
    return baseMillis + jitterMillis.coerceIn(0L, 999L)
}

/** A cached manifest is usable only inside the server-issued authorization window. */
internal fun manifestIsAuthorizedAt(manifest: DeviceManifest, now: Instant): Boolean =
    manifest.validUntil?.isAfter(now) == true

/** Refresh before the server lease ends; this never extends the authorization window. */
internal fun manifestRefreshDelayMillis(
    validUntil: Instant?,
    now: Instant,
    leadMillis: Long = MANIFEST_REFRESH_LEAD_MILLIS,
): Long? {
    if (leadMillis < 0 || validUntil == null || !validUntil.isAfter(now)) return null
    return (Duration.between(now, validUntil).toMillis() - leadMillis).coerceAtLeast(0L)
}

/** Never publish a playlist until every URL-bearing item has a verified local asset. */
internal fun canCommitDownloadedManifest(requiredCount: Int, verifiedCount: Int): Boolean =
    requiredCount >= 0 && requiredCount == verifiedCount

internal fun canCommitManifestResponse(
    manifest: DeviceManifest,
    requiredCount: Int,
    verifiedCount: Int,
    now: Instant,
): Boolean = manifestIsAuthorizedAt(manifest, now) && canCommitDownloadedManifest(requiredCount, verifiedCount)

internal fun retainedAssetIds(requiredIds: Set<String>, currentlyPlayingItemId: String?): Set<String> =
    if (currentlyPlayingItemId == null) requiredIds else requiredIds + currentlyPlayingItemId

internal fun nextVerifiedManifestItem(
    manifest: DeviceManifest,
    scheduler: ScheduleEngine,
    now: Instant,
    offset: Int,
    verifiedItemIds: Set<String>,
): ManifestItem? {
    if (!manifestIsAuthorizedAt(manifest, now)) return null
    return scheduler.next(manifest, now, offset, verifiedItemIds)
}

/**
 * Selects from a previously accepted local snapshot during an outage. The
 * manifest lease is not renewed here: item campaign dates and daily schedules
 * still apply, and callers must only use this for a manifest already committed
 * from an authenticated response and whose assets have been checksum-verified.
 */
internal fun nextVerifiedCachedItem(
    manifest: DeviceManifest,
    scheduler: ScheduleEngine,
    now: Instant,
    offset: Int,
    verifiedItemIds: Set<String>,
): ManifestItem? = scheduler.next(manifest, now, offset, verifiedItemIds)

internal enum class CachedStartupBlock {
    NONE,
    NO_MANIFEST,
    UNPAIRED,
    SCREEN_ID_MISMATCH,
    AUTHORIZATION_EXPIRED,
    NO_ELIGIBLE_VERIFIED_ASSET,
}

internal data class CachedStartupResolution(
    /** Null means the cached manifest must not be rendered for this device identity. */
    val manifest: DeviceManifest?,
    val firstItem: ManifestItem?,
    val block: CachedStartupBlock,
)

/** Resolves the persisted playlist without any network access or proof side effects. */
internal fun resolveCachedStartup(
    manifest: DeviceManifest?,
    pairedScreenId: String?,
    verifiedItemIds: Set<String>,
    scheduler: ScheduleEngine,
    now: Instant,
    allowExpiredForOfflinePlayback: Boolean = false,
): CachedStartupResolution {
    if (manifest == null) return CachedStartupResolution(null, null, CachedStartupBlock.NO_MANIFEST)
    if (pairedScreenId == null) return CachedStartupResolution(null, null, CachedStartupBlock.UNPAIRED)
    if (manifest.screenId != pairedScreenId) return CachedStartupResolution(null, null, CachedStartupBlock.SCREEN_ID_MISMATCH)
    val authorized = manifestIsAuthorizedAt(manifest, now)
    if (!authorized && !allowExpiredForOfflinePlayback) return CachedStartupResolution(manifest, null, CachedStartupBlock.AUTHORIZATION_EXPIRED)
    val firstItem = if (authorized) nextVerifiedManifestItem(manifest, scheduler, now, 0, verifiedItemIds)
        else nextVerifiedCachedItem(manifest, scheduler, now, 0, verifiedItemIds)
    return if (firstItem == null) CachedStartupResolution(manifest, null, CachedStartupBlock.NO_ELIGIBLE_VERIFIED_ASSET)
    else CachedStartupResolution(manifest, firstItem, CachedStartupBlock.NONE)
}

internal fun offlineEmptyMessage(
    manifest: DeviceManifest,
    now: Instant,
    verifiedItemIds: Set<String>,
    allowExpiredCachedManifest: Boolean = false,
): String = when {
    manifest.version <= 0L -> "No cached ads are available\nConnect this screen and sync an approved campaign."
    !allowExpiredCachedManifest && !manifestIsAuthorizedAt(manifest, now) -> "Offline ads paused\nAuthorization expired. Reconnect to refresh approved content."
    manifest.items.isEmpty() -> "No approved ads are available\nAsk OORO to schedule a campaign for this screen."
    manifest.items.none { it.id in verifiedItemIds } -> "No verified ads are cached\nReconnect to download approved content."
    else -> "No ad is eligible right now\nPlayback will resume when an approved schedule is active."
}

internal fun eligibleSponsoredItem(manifest: DeviceManifest, now: Instant, verifiedItemIds: Set<String>): ManifestItem? {
    if (manifest.layoutContractVersion < 3 || manifest.layout !in setOf(DisplayLayout.FOUR_ZONE, DisplayLayout.AD_NAV_OFFER) || !manifestIsAuthorizedAt(manifest, now)) return null
    val item = manifest.sponsoredItem ?: return null
    if (item.type != CreativeType.IMAGE || item.id !in verifiedItemIds) return null
    val zone = runCatching { java.time.ZoneId.of(manifest.timezone) }.getOrNull() ?: return null
    return item.takeIf { it.isActive(now, zone) }
}

internal fun acknowledgedProofEventIds(selectedIds: Set<String>, serverAcceptedIds: Set<String>): Set<String> =
    selectedIds intersect serverAcceptedIds
