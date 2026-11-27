package com.ooro.screenplayer

import com.ooro.screenplayer.api.ManifestCodec
import com.ooro.screenplayer.model.CreativeType
import com.ooro.screenplayer.model.DeviceManifest
import com.ooro.screenplayer.model.DisplayLayout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ManifestCodecTest {
    @Test fun splitLayoutSurvivesStringObjectAndRoundTripWithoutChangingCreativeFit() {
        for (layout in listOf("\"SPLIT_50_25_25\"", "{\"type\":\"SPLIT_50_25_25\"}")) {
            val manifest = ManifestCodec.parse("""{"version":1,"screenId":"screen","timezone":"UTC","layout":$layout,"items":[]}""")
            assertEquals(DisplayLayout.SPLIT_50_25_25, manifest.layout)
            assertEquals(DisplayLayout.SPLIT_50_25_25, ManifestCodec.parse(ManifestCodec.encode(manifest)).layout)
        }
    }

    private val payload = """{"version":42,"screenId":"screen-1","timezone":"Asia/Kolkata","layout":{"type":"FOUR_ZONE","primaryWidthPercent":67,"adHeightPercent":86,"qrHeightPercent":47,"newsScrollSpeed":42},"news":{"scrollSpeed":42,"announcements":[{"id":"news-a","text":"Service update","priority":5}]},"items":[{"id":"item-a","campaignId":"campaign-a","creativeId":"creative-a","assetId":"asset-a","type":"IMAGE","url":"https://cdn.example/a.png","checksum":"aaa","durationSeconds":10,"priority":2,"playsPerLoop":1,"daysOfWeek":[1,2],"fitMode":"FIT","qrEnabled":true,"offer":{"brandName":"Brand A","promotionalText":"10% OFF","offerTitle":"Offer A","ctaUrl":"https://example.com/a","qrUrl":"https://theooro.com/go/abcdefghijklmnopqrstuvwxyzABCDEF"}},{"id":"item-b","campaignId":"campaign-b","creativeId":"creative-b","assetId":"asset-b","type":"VIDEO","url":"https://cdn.example/b.mp4","checksum":"bbb","durationSeconds":15,"priority":1,"playsPerLoop":2,"qrEnabled":true,"offer":{"brandName":"Brand B","offerTitle":"Offer B","qrUrl":"https://theooro.com/go/bcdefghijklmnopqrstuvwxyzABCDEFG"}}]}"""

    @Test fun parsesImageVideoOfferAndQrAtomically() {
        val manifest = ManifestCodec.parse(payload)
        assertEquals(42, manifest.version)
        assertEquals(DisplayLayout.FOUR_ZONE, manifest.layout)
        assertEquals(1, manifest.news.announcements.size)
        assertEquals(listOf(CreativeType.IMAGE, CreativeType.VIDEO), manifest.items.map { it.type })
        assertEquals("creative-a", manifest.items[0].creativeId)
        assertEquals("Offer A", manifest.items[0].offer.offerTitle)
        assertEquals("10% OFF", manifest.items[0].offer.promotionalText)
        assertEquals("https://theooro.com/go/abcdefghijklmnopqrstuvwxyzABCDEF", manifest.items[0].offer.qrUrl)
        assertEquals("creative-b", manifest.items[1].creativeId)
        assertEquals("Offer B", manifest.items[1].offer.offerTitle)
        assertEquals(null, manifest.items[1].offer.promotionalText)
        assertEquals("https://theooro.com/go/bcdefghijklmnopqrstuvwxyzABCDEFG", manifest.items[1].offer.qrUrl)
    }

    @Test fun manifestQrFlagSurvivesCacheRoundTripAndFalseCannotBeOverriddenByCta() {
        val trackingUrl = "https://theooro.com/go/abcdefghijklmnopqrstuvwxyzABCDEF"
        val body = """{"version":1,"screenId":"screen","items":[{"id":"enabled","campaignId":"c","creativeId":"cr","type":"IMAGE","url":"https://cdn.example/a.png","qrEnabled":true,"offer":{"qrUrl":"$trackingUrl"}},{"id":"disabled","campaignId":"c","creativeId":"cr2","type":"IMAGE","url":"https://cdn.example/b.png","qrEnabled":false,"offer":{"qrUrl":"$trackingUrl","ctaUrl":"https://merchant.example/offer"}}]}"""
        val manifest = ManifestCodec.parse(body)
        assertEquals(trackingUrl, manifest.items[0].offer.consumerQrUrl)
        assertEquals(null, manifest.items[1].offer.consumerQrUrl)
        val restored = ManifestCodec.parse(ManifestCodec.encode(manifest))
        assertEquals(true, restored.items[0].qrEnabled)
        assertEquals(false, restored.items[1].qrEnabled)
        assertEquals(null, restored.items[1].offer.consumerQrUrl)
    }

    @Test fun missingFlagAndStaleNoncanonicalDestinationCannotCreateCachedQr() {
        val body = """{"version":1,"screenId":"screen","items":[{"id":"stale","campaignId":"c","creativeId":"cr","type":"IMAGE","url":"https://cdn.example/a.png","offer":{"qrUrl":"https://staging.theooro.com/go/abcdefghijklmnopqrstuvwxyzABCDEF","ctaUrl":"https://theooro.com/offer"}}]}"""
        val item = ManifestCodec.parse(body).items.single()
        assertEquals(null, item.offer.qrEnabled)
        assertEquals(null, item.offer.consumerQrUrl)
        assertEquals(false, ManifestCodec.parse(ManifestCodec.encode(DeviceManifest(1, "screen", "UTC", listOf(item), null))).items.single().qrEnabled)
    }

    @Test fun layoutVersionDefaultsToV1AndV2RoundTrips() {
        val legacy = ManifestCodec.parse(payload)
        assertEquals(1, legacy.layoutContractVersion)
        val v2 = ManifestCodec.parse(payload.replace("\"type\":\"FOUR_ZONE\"", "\"type\":\"FOUR_ZONE\",\"contractVersion\":2"))
        assertEquals(2, v2.layoutContractVersion)
        assertEquals(2, ManifestCodec.parse(ManifestCodec.encode(v2)).layoutContractVersion)
    }

    @Test fun threeZonePresetContractAndResolvedSponsoredCreativeSurviveCacheRoundTrip() {
        val body = """{"version":44,"screenId":"screen-1","timezone":"UTC","layout":{"type":"THREE_ZONE_AD_SPONSOR_QR_V1","contractVersion":3,"layoutVersion":1,"primaryWidthPercent":65,"qrHeightPercent":75,"sponsoredHeightPercent":25,"minWidthPx":1280,"minHeightPx":720},"items":[{"id":"main","campaignId":"main-campaign","creativeId":"main-creative","type":"IMAGE","url":"https://cdn.example/main.png","sequence":3,"deliverySlot":"MAIN","qrEnabled":true,"offer":{"qrUrl":"https://theooro.com/go/abcdefghijklmnopqrstuvwxyzABCDEF"}}],"sponsoredItem":{"id":"sponsor","campaignId":"sponsor-campaign","creativeId":"sponsor-creative","type":"IMAGE","url":"https://cdn.example/sponsor.png","sequence":1,"deliverySlot":"SPONSORED"}}"""
        val parsed = ManifestCodec.parse(body)
        assertEquals(DisplayLayout.THREE_ZONE_AD_SPONSOR_QR_V1, parsed.layout)
        assertEquals(3, parsed.layoutContractVersion)
        assertEquals(1, parsed.layoutConfig.layoutVersion)
        assertEquals(1280, parsed.layoutConfig.minWidthPx)
        assertEquals("SPONSORED", parsed.sponsoredItem?.deliverySlot)
        assertEquals("main", parsed.items.single().id)
        val cached = ManifestCodec.parse(ManifestCodec.encode(parsed))
        assertEquals(DisplayLayout.THREE_ZONE_AD_SPONSOR_QR_V1, cached.layout)
        assertEquals("SPONSORED", cached.sponsoredItem?.deliverySlot)
        assertEquals("https://theooro.com/go/abcdefghijklmnopqrstuvwxyzABCDEF", cached.items.single().offer.consumerQrUrl)
    }

    @Test fun v3SponsoredImageIsSeparateAndSurvivesCachedManifestEncoding() {
        val body = """{"version":43,"screenId":"screen-1","timezone":"UTC","validUntil":"2030-01-01T00:00:00Z","layout":{"type":"FOUR_ZONE","contractVersion":3,"primaryWidthPercent":80,"adHeightPercent":85,"qrHeightPercent":50},"news":{"announcements":[]},"items":[{"id":"main","campaignId":"main-campaign","creativeId":"main-creative","type":"VIDEO","url":"https://cdn.example/main.mp4","durationSeconds":15}],"sponsoredItem":{"id":"sponsor","campaignId":"sponsor-campaign","creativeId":"sponsor-creative","assetId":"asset-s","type":"IMAGE","url":"https://cdn.example/sponsor.png","checksum":"sha256-value","durationSeconds":10,"fitMode":"FIT"}}"""
        val parsed = ManifestCodec.parse(body)
        assertEquals(3, parsed.layoutContractVersion)
        assertEquals("main", parsed.items.single().id)
        assertEquals(CreativeType.IMAGE, parsed.sponsoredItem?.type)
        assertEquals("sponsor", parsed.sponsoredItem?.id)
        val restored = ManifestCodec.parse(ManifestCodec.encode(parsed))
        assertEquals("sponsor", restored.sponsoredItem?.id)
        assertEquals("sha256-value", restored.sponsoredItem?.checksum)
    }

    @Test fun customLayoutContractRoundTripsAsPresentationMetadata() {
        val contract = """{"contractVersion":1,"mode":"CUSTOM","target":{"width":1280,"height":720},"zones":[]}"""
        val parsed = ManifestCodec.parse(payload.replace("\"items\":", "\"layoutStudioContract\":$contract,\"items\":"))
        assertTrue(parsed.layoutStudioContract?.contains("\"mode\":\"CUSTOM\"") == true)
        val restored = ManifestCodec.parse(ManifestCodec.encode(parsed))
        assertTrue(restored.layoutStudioContract?.contains("\"contractVersion\":1") == true)
        // Layout metadata remains a presentation field; creative and authorization data are unchanged.
        assertEquals(parsed.items.map { it.id }, restored.items.map { it.id })
        assertEquals(parsed.screenId, restored.screenId)
    }

    @Test fun acceptsEmptyManifestAndMissingOptionalOfferMetadata() {
        val empty = ManifestCodec.parse("""{"version":0,"screenId":"screen-1","timezone":"UTC","items":[]}""")
        assertTrue(empty.items.isEmpty())
        val withoutOffer = ManifestCodec.parse("""{"version":1,"screenId":"screen-1","items":[{"id":"i","campaignId":"c","creativeId":"cr","type":"IMAGE","url":"https://example.com/a.png"}]}""")
        assertEquals(null, withoutOffer.items.single().offer.offerTitle)
    }

    @Test fun dateBoundsRoundTripWhileLegacyTimeOfDayFieldsAreIgnored() {
        val legacy = ManifestCodec.parse("""{"version":3,"screenId":"screen-1","timezone":"Pacific/Honolulu","items":[{"id":"legacy","campaignId":"campaign","creativeId":"creative","type":"IMAGE","url":"https://cdn.example/a.png","checksum":"${"a".repeat(64)}","durationSeconds":10,"startAt":"2026-11-19T00:00:00Z","endAt":"2026-11-21T00:00:00Z","daysOfWeek":[],"startTime":"23:55","endTime":"00:05","deliveryQuota":{"id":"campaign:screen-1","revision":1,"remainingPlays":3,"unlimited":false}}]}""")
        val item = legacy.items.single()

        assertEquals(java.time.Instant.parse("2026-11-19T00:00:00Z"), item.startAt)
        assertEquals(java.time.Instant.parse("2026-11-21T00:00:00Z"), item.endAt)
        assertEquals(emptySet< java.time.DayOfWeek >(), item.daysOfWeek)
        assertEquals("legacy", com.ooro.screenplayer.player.ScheduleEngine().next(legacy, java.time.Instant.parse("2026-11-19T12:00:00Z"))?.id)
    }

    @Test fun trustedTimeMustComeFromTheAuthenticatedManifestBody() {
        val serverTime = "2026-11-20T10:15:30Z"
        val response = """{"version":3,"screenId":"screen-1","generatedAt":"2026-11-20T10:15:00Z","authenticatedServerTime":"$serverTime","validUntil":"2026-11-20T10:30:00Z","items":[]}"""
        assertEquals(java.time.Instant.parse(serverTime), ManifestCodec.parse(response).authenticatedServerTime)

        val missing = """{"version":3,"screenId":"screen-1","generatedAt":"2026-11-20T10:15:00Z","validUntil":"2026-11-20T10:30:00Z","items":[]}"""
        assertEquals(null, ManifestCodec.parse(missing).authenticatedServerTime)

        val invalid = response.replace(serverTime, "not-a-server-time")
        val invalidParsed = ManifestCodec.parse(invalid)
        assertEquals("not-a-server-time", invalidParsed.rawAuthenticatedServerTime)
        assertEquals(null, invalidParsed.authenticatedServerTime)
    }

    @Test fun `authorized QR destination record ID survives manifest cache round trip`() {
        val trackingUrl = "https://theooro.com/go/abcdefghijklmnopqrstuvwxyzABCDEF"
        val payloadWithDestination = payload.replace("\"qrUrl\":\"$trackingUrl\"", "\"qrUrl\":\"$trackingUrl\",\"authorizedDestinationId\":\"destination-uuid\"")
        val parsed = ManifestCodec.parse(payloadWithDestination)
        assertEquals("destination-uuid", parsed.items.first().offer.authorizedDestinationId)
        assertEquals("destination-uuid", ManifestCodec.parse(ManifestCodec.encode(parsed)).items.first().offer.authorizedDestinationId)
    }

    @Test fun malformedOrUnknownMediaManifestIsRejectedForLastKnownGoodFallback() {
        listOf("not-json", """{"version":1,"items":[{"id":"i","type":"AUDIO","url":"https://example.com/a"}]}""").forEach { body ->
            try { ManifestCodec.parse(body); fail("Expected invalid manifest to be rejected") } catch (_: Exception) { }
        }
    }
}
