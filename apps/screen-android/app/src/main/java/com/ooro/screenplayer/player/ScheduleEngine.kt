package com.ooro.screenplayer.player

import com.ooro.screenplayer.model.*
import java.time.Instant

class ScheduleEngine {
    fun recordStarted(item: ManifestItem, now: Instant = Instant.now()) = Unit
    fun eligible(manifest: DeviceManifest, now: Instant = Instant.now()): List<ManifestItem> {
        // `now` is retained for call-site compatibility; legacy campaign windows
        // are not delivery gates. The server-issued quota is the eligibility bound.
        return manifest.items.filter { it.hasAuthorizedDeliveryQuota }
            .sortedWith(compareByDescending<ManifestItem> { it.priority }.thenBy { it.campaignId }.thenBy { it.id })
    }
    fun next(manifest: DeviceManifest, now: Instant = Instant.now(), offset: Int = 0, availableItemIds: Set<String>? = null): ManifestItem? {
        val eligible = eligible(manifest, now)
        // Emergency delivery remains exclusive: an unavailable authorized
        // emergency asset must not silently fall through to lower priority.
        if (availableItemIds != null && eligible.any { it.priority >= 1000 && it.id !in availableItemIds }) return null
        val available = eligible.filter { availableItemIds == null || it.id in availableItemIds }
        return available.takeIf { it.isNotEmpty() }?.let { it[offset.mod(it.size)] }
    }
}
