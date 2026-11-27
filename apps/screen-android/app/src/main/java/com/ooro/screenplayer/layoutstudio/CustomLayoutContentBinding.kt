package com.ooro.screenplayer.layoutstudio

import com.ooro.screenplayer.eligibleSponsoredItem
import com.ooro.screenplayer.model.CreativeType
import com.ooro.screenplayer.model.DeviceManifest
import com.ooro.screenplayer.model.ManifestItem
import com.ooro.screenplayer.player.ScheduleEngine
import java.time.Instant

/** A resolved, manifest-backed payload. This type carries no authority to create proof by itself. */
sealed interface CustomWidgetContent {
    val proofSlot: String?
    data class MainAd(val item: ManifestItem) : CustomWidgetContent { override val proofSlot = "MAIN" }
    data class Sponsor(val item: ManifestItem) : CustomWidgetContent { override val proofSlot = "SPONSORED" }
    data class DecorativeMedia(val item: ManifestItem) : CustomWidgetContent { override val proofSlot: String? = null }
    data class Offer(val item: ManifestItem) : CustomWidgetContent { override val proofSlot: String? = null }
    data class Text(val value: String) : CustomWidgetContent { override val proofSlot: String? = null }
    data class Fallback(val reason: String) : CustomWidgetContent { override val proofSlot: String? = null }
}

/**
 * Resolves Layout Studio references only through a screen-bound manifest accepted from the
 * device API. Accepted campaign state and its explicit quota govern offline main-creative playback; this resolver never
 * fetches media, selects campaigns, extends a lease, or attributes a proof.
 */
internal fun resolveCustomWidgetContent(
    zone: LayoutStudioZone,
    manifest: DeviceManifest,
    pairedScreenId: String?,
    verifiedItemIds: Set<String>,
    currentMainItem: ManifestItem?,
    now: Instant,
    enabledCapabilities: Set<String> = emptySet(),
    authorizationExpired: Boolean = false,
    allowCachedOffline: Boolean = false,
): CustomWidgetContent {
    if (pairedScreenId.isNullOrBlank() || manifest.screenId != pairedScreenId) return CustomWidgetContent.Fallback("screen-identity-mismatch")
    if (authorizationExpired) return CustomWidgetContent.Fallback("manifest-authorization-invalid")
    if (!zone.visible) return CustomWidgetContent.Fallback("hidden")
    fun activeAndVerified(item: ManifestItem?) = item?.takeIf {
        it.id in verifiedItemIds && it.hasAuthorizedDeliveryQuota && it.isCampaignDateEligibleAt(now)
    }

    return when (zone.type) {
        "MAIN_AD" -> {
            val item = activeAndVerified(currentMainItem)
            if (item != null && item.deliverySlot != "SPONSORED") CustomWidgetContent.MainAd(item)
            else CustomWidgetContent.Fallback("no-authorized-main-creative")
        }
        "SPONSORED_AD" -> {
            val sponsor = eligibleSponsoredItem(manifest, now, verifiedItemIds)
            if (sponsor != null) CustomWidgetContent.Sponsor(sponsor)
            else CustomWidgetContent.Fallback("no-eligible-sponsor")
        }
        "IMAGE", "VIDEO", "LOGO", "BACKGROUND_IMAGE" -> {
            val expectedType = if (zone.type == "VIDEO") CreativeType.VIDEO else CreativeType.IMAGE
            val selected = activeAndVerified(ScheduleEngine().eligible(manifest, now)
                .firstOrNull { it.deliverySlot != "SPONSORED" && it.type == expectedType })
            if (selected == null) CustomWidgetContent.Fallback("no-scheduler-assigned-eligible-media")
            else CustomWidgetContent.DecorativeMedia(selected.copy(durationSeconds = zone.rotationDurationSeconds ?: selected.durationSeconds))
        }
        "QR_OFFER" -> {
            val item = activeAndVerified(currentMainItem)?.takeIf { it.qrEnabled }
            if (item == null) CustomWidgetContent.Fallback("current-scheduled-offer-has-no-authorized-qr") else CustomWidgetContent.Offer(item)
        }
        "TEXT" -> CustomWidgetContent.Text(zone.label)
        "CLOCK", "WEATHER", "TICKER", "NAVIGATION_MAP" -> if (zone.type in enabledCapabilities) {
            CustomWidgetContent.Fallback("capability-enabled-widget-has-no-runtime-provider")
        } else CustomWidgetContent.Fallback("device-capability-unavailable")
        else -> CustomWidgetContent.Fallback("unsupported-widget")
    }
}
