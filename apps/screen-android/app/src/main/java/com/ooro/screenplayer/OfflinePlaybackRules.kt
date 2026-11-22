package com.ooro.screenplayer

import com.ooro.screenplayer.model.DeviceManifest
import com.ooro.screenplayer.model.ManifestItem
import com.ooro.screenplayer.api.DeviceApiException
import com.ooro.screenplayer.api.DeviceApi
import com.ooro.screenplayer.api.DeviceFailureKind
import com.ooro.screenplayer.model.DeviceCredentials
import com.ooro.screenplayer.player.ScheduleEngine
import com.ooro.screenplayer.model.CreativeType
import com.ooro.screenplayer.model.DisplayLayout
import java.time.Duration
import java.time.Instant

internal const val MANIFEST_REFRESH_LEAD_MILLIS = 120_000L
internal const val NETWORK_RECOVERY_THROTTLE_MILLIS = 30_000L
internal const val MANIFEST_UPDATE_POLL_INTERVAL_MILLIS = 180_000L
internal const val MAX_OFFLINE_AUTHORIZATION_MILLIS = 15 * 60_000L
internal const val OFFLINE_AUTHORIZATION_SAFETY_MILLIS = 5_000L

internal data class OfflineAuthorization(
    val screenId: String,
    val receivedElapsedMillis: Long,
    val bootCount: Int,
    val durationMillis: Long,
    val serverTimeUtcMillis: Long,
)

/** A manifest lease is measured from the authenticated HTTPS response using monotonic time. */
internal fun issueOfflineAuthorization(
    screenId: String,
    generatedAt: Instant?,
    validUntil: Instant?,
    authenticatedServerDate: Instant?,
    receivedElapsedMillis: Long,
    bootCount: Int?,
): OfflineAuthorization? {
    val issued = generatedAt ?: return null
    val expiry = validUntil ?: return null
    val serverNow = authenticatedServerDate ?: return null
    val boot = bootCount ?: return null
    if (screenId.isBlank() || receivedElapsedMillis < 0L || boot < 0) return null
    if (expiry <= issued || serverNow < issued.minusSeconds(5) || serverNow >= expiry) return null
    val authenticatedNow = maxOf(serverNow, issued)
    val remaining = Duration.between(authenticatedNow, expiry).toMillis() - OFFLINE_AUTHORIZATION_SAFETY_MILLIS
    if (remaining !in 1..MAX_OFFLINE_AUTHORIZATION_MILLIS) return null
    return OfflineAuthorization(screenId, receivedElapsedMillis, boot, remaining, serverNow.toEpochMilli())
}

internal fun serverTimeDoesNotRollback(previousServerTimeUtcMillis: Long?, incomingServerTimeUtcMillis: Long): Boolean =
    previousServerTimeUtcMillis == null || incomingServerTimeUtcMillis >= previousServerTimeUtcMillis

/** Expected authenticated time at request start, advanced only from a signed anchor and monotonic elapsed time. */
internal fun expectedAuthenticatedServerTimeUtcMillis(
    previousServerTimeUtcMillis: Long?,
    previousReceivedElapsedMillis: Long?,
    previousBootCount: Int?,
    requestStartElapsedMillis: Long,
    currentBootCount: Int?,
): Long? {
    val previous = previousServerTimeUtcMillis ?: return null
    if (previousBootCount == null || currentBootCount == null || previousBootCount != currentBootCount) return previous
    val received = previousReceivedElapsedMillis ?: return previous
    if (requestStartElapsedMillis < received) return previous
    return runCatching { Math.addExact(previous, requestStartElapsedMillis - received) }.getOrNull() ?: previous
}

internal fun authenticatedTimeDeltaMillis(expectedServerTimeUtcMillis: Long?, incomingServerTimeUtcMillis: Long?): Long? {
    if (expectedServerTimeUtcMillis == null || incomingServerTimeUtcMillis == null) return null
    return runCatching { Math.subtractExact(incomingServerTimeUtcMillis, expectedServerTimeUtcMillis) }.getOrNull()
}

internal fun offlineAuthorizationRemainingMillis(
    authorization: OfflineAuthorization?,
    pairedScreenId: String?,
    currentElapsedMillis: Long,
    currentBootCount: Int?,
): Long {
    if (authorization == null || pairedScreenId.isNullOrBlank() || authorization.screenId != pairedScreenId) return 0L
    if (currentBootCount == null || currentBootCount != authorization.bootCount) return 0L
    if (currentElapsedMillis < authorization.receivedElapsedMillis || authorization.durationMillis !in 1..MAX_OFFLINE_AUTHORIZATION_MILLIS) return 0L
    return (authorization.durationMillis - (currentElapsedMillis - authorization.receivedElapsedMillis)).coerceAtLeast(0L)
}

/** Secure schedule time advances from the HTTPS server Date using monotonic elapsed time only. */
internal fun trustedScheduleTime(
    authorization: OfflineAuthorization?,
    pairedScreenId: String?,
    currentElapsedMillis: Long,
    currentBootCount: Int?,
): Instant? {
    val remaining = offlineAuthorizationRemainingMillis(authorization, pairedScreenId, currentElapsedMillis, currentBootCount)
    if (remaining <= 0L) return null
    val value = authorization ?: return null
    return runCatching { Instant.ofEpochMilli(value.serverTimeUtcMillis + (currentElapsedMillis - value.receivedElapsedMillis)) }.getOrNull()
}

internal fun shouldPollForManifestUpdate(nowElapsedMillis: Long, lastPollElapsedMillis: Long): Boolean =
    lastPollElapsedMillis <= 0L || nowElapsedMillis - lastPollElapsedMillis >= MANIFEST_UPDATE_POLL_INTERVAL_MILLIS

internal fun shouldRefreshAfterNetworkRecovery(nowElapsedMillis: Long, lastRefreshElapsedMillis: Long): Boolean =
    lastRefreshElapsedMillis <= 0L || nowElapsedMillis - lastRefreshElapsedMillis >= NETWORK_RECOVERY_THROTTLE_MILLIS

internal fun syncRetryDelayMillis(attempt: Int, jitterMillis: Long): Long {
    val exponent = attempt.coerceIn(1, 8)
    val baseMillis = (1L shl exponent).coerceAtMost(300L) * 1_000L
    return baseMillis + jitterMillis.coerceIn(0L, 999L)
}

/** Fresh response authorization comes from the authenticated HTTPS server time and bounded lease, never device wall time. */
internal fun manifestIsAuthorizedAt(manifest: DeviceManifest, now: Instant): Boolean =
    issueOfflineAuthorization(manifest.screenId, manifest.generatedAt, manifest.validUntil, manifest.authenticatedServerTime, 0L, 0) != null

/** Compatibility timer for non-delivery UI refresh; no campaign time boundary controls playback. */
internal fun scheduleReevaluationDelayMillis(
    manifest: DeviceManifest?,
    now: Instant,
    fallbackPollMillis: Long = 60_000L,
): Long {
    return fallbackPollMillis.coerceAtLeast(1L)
}

/** Refresh before the manifest authorization lease ends; this never extends the authorization window. */
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

/** The authenticated manifest request is authoritative; /api/health is diagnostic only. */
internal suspend fun fetchAuthenticatedManifest(api: DeviceApi, credentials: DeviceCredentials): DeviceManifest =
    api.manifest(credentials)

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
    return scheduler.next(manifest, now, offset, verifiedItemIds)
}

/** Selects cached items only after the caller confirms the paired, unexpired monotonic lease. */
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
    allowExpiredForOfflinePlayback: Boolean = true,
): CachedStartupResolution {
    if (manifest == null) return CachedStartupResolution(null, null, CachedStartupBlock.NO_MANIFEST)
    if (pairedScreenId == null) return CachedStartupResolution(null, null, CachedStartupBlock.UNPAIRED)
    if (manifest.screenId != pairedScreenId) return CachedStartupResolution(null, null, CachedStartupBlock.SCREEN_ID_MISMATCH)
    val firstItem = nextVerifiedCachedItem(manifest, scheduler, now, 0, verifiedItemIds)
    return if (firstItem == null) CachedStartupResolution(manifest, null, CachedStartupBlock.NO_ELIGIBLE_VERIFIED_ASSET)
    else CachedStartupResolution(manifest, firstItem, CachedStartupBlock.NONE)
}

internal fun offlineEmptyMessage(
    manifest: DeviceManifest,
    now: Instant,
    verifiedItemIds: Set<String>,
    allowExpiredCachedManifest: Boolean = false,
    networkValidated: Boolean? = null,
    syncFailure: String? = null,
    paired: Boolean = true,
    trustedTimeAvailable: Boolean = true,
): String = when {
    manifest.version <= 0L && !paired -> "This screen is not paired\nPair it before syncing approved content."
    manifest.version <= 0L && syncFailure != null -> "$syncFailure\nNo verified ads are cached on this screen.${if (!trustedTimeAvailable) " Trusted schedule time must be re-established before playback." else ""}"
    manifest.version <= 0L && networkValidated == false -> "No verified ads are cached on this screen\nInternet is not available to sync approved content."
    manifest.version <= 0L && !trustedTimeAvailable -> "Trusted time is not established\nReconnect to OORO to authorize a manifest before playback."
    manifest.version <= 0L -> "No manifest has been synchronized yet\nWaiting for a successful OORO sync before playback."
    !trustedTimeAvailable && !allowExpiredCachedManifest -> "Trusted time is unavailable\nReconnect to establish authenticated schedule time before playback."
    manifest.deliveryReasons.isNotEmpty() -> manifest.deliveryReasons.distinct().joinToString("\n") { deliveryReasonMessage(it) }
    manifest.items.isEmpty() -> "No delivery is authorized for this screen\nCheck campaign state, funding, approval, assignment, and device quota in the admin console."
    manifest.items.none { it.id in verifiedItemIds } -> "No verified ads are cached\nReconnect to download approved content."
    manifest.items.any { it.id in verifiedItemIds && it.deliveryQuota == null } -> "The manifest has no per-screen delivery quota\nThe server must issue an explicit bounded quota or approved unlimited grant."
    manifest.items.none { it.hasAuthorizedDeliveryQuota } -> "Authorized delivery quota is exhausted\nReconnect for a new approved grant."
    else -> "No eligible verified creative is available\nCheck local asset integrity and campaign delivery state."
}

internal fun manifestSyncFailureMessage(error: Throwable?, networkValidated: Boolean): String {
    if (!networkValidated) return "Internet connectivity is not validated\nWaiting for a usable network before syncing this screen."
    val failure = error as? DeviceApiException
    return when (failure?.kind) {
        DeviceFailureKind.DNS_ERROR -> "OORO API DNS lookup failed\nCheck the screen network's DNS path."
        DeviceFailureKind.TLS_ERROR -> "Secure HTTPS connection to OORO failed\nCheck certificate validation and network interception."
        DeviceFailureKind.TIMEOUT -> "OORO API request timed out\nThe screen is paired, but no manifest response was received."
        DeviceFailureKind.CONNECTION_REFUSED, DeviceFailureKind.NETWORK_UNAVAILABLE -> "OORO API is unreachable\nThe screen is paired, but manifest sync did not complete."
        DeviceFailureKind.AUTH_EXPIRED, DeviceFailureKind.AUTH_INVALID, DeviceFailureKind.AUTH_REVOKED,
        DeviceFailureKind.DEVICE_NOT_FOUND, DeviceFailureKind.PAIRING_REQUIRED -> "OORO rejected this screen's authentication\nAn administrator must restore this screen's pairing."
        DeviceFailureKind.SERVER_UNAVAILABLE -> "OORO returned a server error\nThe screen will retry manifest sync."
        else -> when {
            error?.message?.contains("authenticated server time", ignoreCase = true) == true ||
                error?.message?.contains("authorization lease", ignoreCase = true) == true ->
                "OORO returned missing or invalid authenticated time\nPlayback remains paused until a valid manifest is authorized."
            error?.message?.contains("asset", ignoreCase = true) == true ||
                error?.message?.contains("checksum", ignoreCase = true) == true ->
                "Manifest asset download or checksum verification failed\nThe last verified manifest remains active."
            error?.message?.contains("different screen", ignoreCase = true) == true ->
                "OORO returned a manifest for a different screen\nThe response was rejected and playback remains paused."
            else -> "OORO manifest sync failed\nThe last verified manifest remains active while the screen retries."
        }
    }
}

internal fun deliveryReasonMessage(reason: String): String = when (reason) {
    "NO_ASSIGNMENT" -> "No campaign is assigned to this screen."
    "DISPLAY_DISABLED" -> "This screen is disabled or unavailable for delivery."
    "CLIENT_QUOTA_UNSUPPORTED" -> "This player version cannot enforce delivery quotas; update the player before assigning campaigns."
    "CAMPAIGN_INACTIVE" -> "Assigned campaigns are not active. An administrator must explicitly activate an approved campaign."
    "APPROVAL_REQUIRED" -> "Campaign approval is required before delivery."
    "FUNDING_REQUIRED" -> "Campaign funding or payment is not complete."
    "NO_DELIVERY_QUOTA" -> "No per-screen delivery quota is authorized."
    "NO_APPROVED_CREATIVE" -> "No campaign has an approved creative."
    "ASSET_UNAVAILABLE" -> "Approved creative assets are missing or do not have valid checksum metadata."
    "NO_ELIGIBLE_CREATIVE" -> "No approved creative asset is eligible for this screen."
    else -> "Delivery is unavailable ($reason). Check the campaign and screen authorization in admin."
}

internal fun eligibleSponsoredItem(manifest: DeviceManifest, now: Instant, verifiedItemIds: Set<String>): ManifestItem? {
    if (manifest.layoutContractVersion < 3 || manifest.layout !in setOf(DisplayLayout.FOUR_ZONE, DisplayLayout.AD_NAV_OFFER)) return null
    val item = manifest.sponsoredItem ?: return null
    if (item.type != CreativeType.IMAGE || item.id !in verifiedItemIds) return null
    return item.takeIf { it.hasAuthorizedDeliveryQuota && it.isCampaignDateEligibleAt(now) }
}

internal fun acknowledgedProofEventIds(selectedIds: Set<String>, serverAcceptedIds: Set<String>): Set<String> =
    selectedIds intersect serverAcceptedIds
