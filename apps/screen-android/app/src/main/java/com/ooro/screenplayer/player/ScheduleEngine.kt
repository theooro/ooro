package com.ooro.screenplayer.player

import com.ooro.screenplayer.model.*
import java.time.Instant

class ScheduleEngine {
    fun recordStarted(item: ManifestItem, now: Instant = Instant.now()) = Unit
    fun eligible(manifest: DeviceManifest, now: Instant = Instant.now(), allowExhaustedOfflineGrant: Boolean = false): List<ManifestItem> {
        // Date bounds are server-issued UTC instants representing inclusive dates in the campaign timezone.
        // Daily hour/day legacy fields are intentionally ignored.
        return manifest.items.filter { item ->
            (item.deliveryQuota != null && (item.hasAuthorizedDeliveryQuota || allowExhaustedOfflineGrant)) && item.isCampaignDateEligibleAt(now)
        }
            .sortedWith(compareByDescending<ManifestItem> { it.priority }.thenBy { it.campaignId }.thenBy { it.id })
    }
    fun next(manifest: DeviceManifest, now: Instant = Instant.now(), offset: Int = 0, availableItemIds: Set<String>? = null, allowExhaustedOfflineGrant: Boolean = false): ManifestItem? {
        val eligible = eligible(manifest, now, allowExhaustedOfflineGrant)
        // Emergency delivery remains exclusive: an unavailable authorized
        // emergency asset must not silently fall through to lower priority.
        if (availableItemIds != null && eligible.any { it.priority >= 1000 && it.id !in availableItemIds }) return null
        val available = eligible.filter { availableItemIds == null || it.id in availableItemIds }
        return available.takeIf { it.isNotEmpty() }?.let { it[offset.mod(it.size)] }
    }
}
