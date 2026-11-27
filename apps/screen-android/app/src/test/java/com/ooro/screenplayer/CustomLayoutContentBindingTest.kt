package com.ooro.screenplayer

import com.ooro.screenplayer.layoutstudio.CustomWidgetContent
import com.ooro.screenplayer.layoutstudio.LayoutStudioZone
import com.ooro.screenplayer.layoutstudio.resolveCustomWidgetContent
import com.ooro.screenplayer.model.CreativeType
import com.ooro.screenplayer.model.DeviceManifest
import com.ooro.screenplayer.model.DisplayLayout
import com.ooro.screenplayer.model.DeliveryQuota
import com.ooro.screenplayer.model.FitMode
import com.ooro.screenplayer.model.ManifestItem
import com.ooro.screenplayer.model.OfferMetadata
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class CustomLayoutContentBindingTest {
    private val now = Instant.parse("2026-11-06T10:00:00Z")
    private val main = item("main", "creative-main", CreativeType.IMAGE)
    private val decorative = item("decor", "creative-decor", CreativeType.IMAGE)
    private val video = item("video", "creative-video", CreativeType.VIDEO)
    private val sponsor = item("sponsor", "creative-sponsor", CreativeType.IMAGE)
    private val manifest = DeviceManifest(
        version = 9, screenId = "screen-a", timezone = "UTC", items = listOf(main, decorative, video),
        validUntil = now.plusSeconds(900), layout = DisplayLayout.FOUR_ZONE, layoutContractVersion = 3,
        sponsoredItem = sponsor,
    )
    private fun item(id: String, creativeId: String, type: CreativeType, offer: OfferMetadata = OfferMetadata()) = ManifestItem(
        id = id, campaignId = "campaign-$id", creativeId = creativeId, type = type,
        url = "https://cdn.example/$id", checksum = "sha256-$id", durationSeconds = 10,
        priority = 0, startAt = now.minusSeconds(86_400), endAt = now.plusSeconds(86_400),
        daysOfWeek = emptySet(), startTime = null, endTime = null, assetId = "asset-$id",
        fitMode = FitMode.FIT, offer = offer,
        deliveryQuota = DeliveryQuota("campaign-$id:screen-a", 1, 10, false),
    )
    private fun zone(type: String, binding: String = "NONE", reference: String? = null) = LayoutStudioZone(
        id = "zone-$type", type = type, label = "Test $type", x = 0.0, y = 0.0,
        width = 1.0, height = 1.0, zIndex = 0, fit = "FIT", bindingKind = binding,
        referenceId = reference, visible = true,
    )
    private val verified = setOf("main", "decor", "video", "sponsor")

    @Test fun `main slot uses scheduler-selected verified creative and owns main proof attribution`() {
        val resolved = resolveCustomWidgetContent(zone("MAIN_AD"), manifest, "screen-a", verified, main, now)
        assertEquals(CustomWidgetContent.MainAd(main), resolved)
        assertEquals("MAIN", resolved.proofSlot)
        assertTrue(resolveCustomWidgetContent(zone("MAIN_AD"), manifest, "screen-a", verified - "main", main, now) is CustomWidgetContent.Fallback)
    }

    @Test fun `decorative media requires a verified active manifest creative and never owns paid proof`() {
        val resolved = resolveCustomWidgetContent(zone("IMAGE"), manifest, "screen-a", verified, main, now)
        assertEquals(CustomWidgetContent.DecorativeMedia(main), resolved)
        assertNull(resolved.proofSlot)
        assertTrue(resolveCustomWidgetContent(zone("VIDEO"), manifest, "screen-a", verified - "video", main, now) is CustomWidgetContent.Fallback)
        assertTrue(resolveCustomWidgetContent(zone("IMAGE"), manifest, "screen-a", verified - "main", main, now) is CustomWidgetContent.Fallback)
    }

    @Test fun `sponsor is independently manifest authorized and attributed only to sponsor slot`() {
        val resolved = resolveCustomWidgetContent(zone("SPONSORED_AD"), manifest, "screen-a", verified, main, now)
        assertEquals(CustomWidgetContent.Sponsor(sponsor), resolved)
        assertEquals("SPONSORED", resolved.proofSlot)
        assertTrue(resolveCustomWidgetContent(zone("SPONSORED_AD"), manifest.copy(sponsoredItem = null), "screen-a", verified, main, now) is CustomWidgetContent.Fallback)
        assertTrue(resolveCustomWidgetContent(zone("SPONSORED_AD"), manifest.copy(layoutContractVersion = 2), "screen-a", verified, main, now) is CustomWidgetContent.Fallback)
    }

    @Test fun `QR requires matching authorized destination metadata and verified active manifest content`() {
        val offer = main.copy(offer = OfferMetadata(qrUrl = "https://theooro.com/go/abcdefghijklmnopqrstuvwxyzABCDEF", qrEnabled = true, authorizedDestinationId = "destination-1"))
        val withOffer = manifest.copy(items = listOf(offer, decorative, video),)
        val resolved = resolveCustomWidgetContent(zone("QR_OFFER"), withOffer, "screen-a", verified, offer, now)
        assertNull(resolved.proofSlot)
        assertEquals(CustomWidgetContent.Offer(offer), resolved)
        val ctaOnly = item("cta-only", "creative-cta", CreativeType.IMAGE, OfferMetadata(ctaUrl = "https://theooro.com/go/abcdefghijklmnopqrstuvwxyzABCDEF", authorizedDestinationId = "destination-3"))
        assertTrue(resolveCustomWidgetContent(zone("QR_OFFER"), withOffer.copy(items = withOffer.items + ctaOnly), "screen-a", verified + "cta-only", ctaOnly, now) is CustomWidgetContent.Fallback)
    }

    @Test fun `expired manifest and screen mismatch fail closed`() {
        assertEquals(CustomWidgetContent.MainAd(main), resolveCustomWidgetContent(zone("MAIN_AD"), manifest.copy(validUntil = now), "screen-a", verified, main, now, allowCachedOffline = true))
        assertEquals(CustomWidgetContent.Fallback("manifest-authorization-invalid"), resolveCustomWidgetContent(zone("MAIN_AD"), manifest, "screen-a", verified, main, now, authorizationExpired = true))
        assertTrue(resolveCustomWidgetContent(zone("MAIN_AD"), manifest, "screen-b", verified, main, now) is CustomWidgetContent.Fallback)
    }

    @Test fun `verified cached binding resolves identically after a process-like resolver recreation`() {
        val unbound = zone("IMAGE")
        val first = resolveCustomWidgetContent(unbound, manifest, "screen-a", verified, main, now)
        val afterRecreation = resolveCustomWidgetContent(unbound, manifest, "screen-a", verified, main, now)
        assertEquals(CustomWidgetContent.DecorativeMedia(main), first)
        assertEquals(first, afterRecreation)
        assertNull(afterRecreation.proofSlot)
    }

    @Test fun `plain text is non billable and unsupported capability widgets fall back`() {
        val text = resolveCustomWidgetContent(zone("TEXT", "NONE", null), manifest, "screen-a", verified, main, now)
        assertEquals(CustomWidgetContent.Text("Test TEXT"), text)
        assertNull(text.proofSlot)
        val clock = resolveCustomWidgetContent(zone("CLOCK", "NONE", null), manifest, "screen-a", verified, main, now)
        assertTrue(clock is CustomWidgetContent.Fallback)
        assertNull(clock.proofSlot)
    }
}
