package com.ooro.screenplayer

import com.ooro.screenplayer.model.*
import com.ooro.screenplayer.player.ScheduleEngine
import org.junit.Assert.*
import org.junit.Test
import java.time.*

class SchedulingTest {
    private fun item(id: String, quota: Int? = 4, priority: Int = 1) = ManifestItem(
        id, "campaign-$id", "creative-$id", CreativeType.IMAGE, "", null, 10, priority,
        Instant.parse("2000-01-01T00:00:00Z"), Instant.parse("2100-01-01T00:00:00Z"), emptySet(), null, null,
        deliveryQuota = quota?.let { DeliveryQuota("campaign-$id:screen", 1, it, false) }
    )

    @Test fun campaignDatesGateDeliveryAndLegacyDaypartsAreIgnored() {
        val active = item("active").copy(
            startAt = Instant.parse("2026-11-19T00:00:00Z"),
            endAt = Instant.parse("2026-11-20T00:00:00Z"),
            daysOfWeek = setOf(DayOfWeek.SUNDAY),
            startTime = LocalTime.of(23, 0), endTime = LocalTime.of(23, 1),
        )
        assertTrue(active.hasAuthorizedDeliveryQuota)
        assertEquals("active", ScheduleEngine().next(DeviceManifest(1, "screen", "UTC", listOf(active), null), Instant.parse("2026-11-19T12:00:00Z"))?.id)
    }

    @Test fun inclusiveAsiaKolkataCalendarDatesUseHalfOpenUtcBounds() {
        val start = Instant.parse("2026-11-21T18:30:00Z") // midnight at the start of 22 Nov in Asia/Kolkata
        val end = Instant.parse("2026-11-22T18:30:00Z") // midnight after the inclusive 22 Nov end date
        val campaign = item("inclusive-date").copy(startAt = start, endAt = end)
        val engine = ScheduleEngine()
        val manifest = DeviceManifest(1, "screen", "Asia/Kolkata", listOf(campaign), null)

        assertNull(engine.next(manifest, start.minusNanos(1)))
        assertEquals(campaign.id, engine.next(manifest, start)?.id)
        assertEquals(campaign.id, engine.next(manifest, end.minusNanos(1))?.id)
        assertNull(engine.next(manifest, end))
    }

    @Test fun missingFutureAndExpiredDateWindowsFailClosed() {
        val now = Instant.parse("2026-11-19T12:00:00Z")
        val variants = listOf(
            item("missing").copy(startAt = null, endAt = null),
            item("future").copy(startAt = now.plusSeconds(86_400), endAt = now.plusSeconds(172_800)),
            item("expired").copy(startAt = now.minusSeconds(172_800), endAt = now.minusSeconds(86_400)),
            item("inactive-daypart").copy(daysOfWeek = emptySet(), startTime = LocalTime.of(23, 59), endTime = LocalTime.MIDNIGHT),
        )

        assertNull(ScheduleEngine().next(DeviceManifest(1, "screen", "Pacific/Honolulu", listOf(variants[0]), null), now, availableItemIds = setOf(variants[0].id)))
        assertNull(ScheduleEngine().next(DeviceManifest(1, "screen", "Pacific/Honolulu", listOf(variants[1]), null), now, availableItemIds = setOf(variants[1].id)))
        assertNull(ScheduleEngine().next(DeviceManifest(1, "screen", "Pacific/Honolulu", listOf(variants[2]), null), now, availableItemIds = setOf(variants[2].id)))
        assertEquals(variants[3].id, ScheduleEngine().next(DeviceManifest(1, "screen", "Pacific/Honolulu", listOf(variants[3]), null), now, availableItemIds = setOf(variants[3].id))?.id)
    }

    @Test fun absentOrExhaustedQuotaFailsClosed() {
        val noGrant = item("missing", quota = null)
        val exhausted = item("exhausted", quota = 0)
        assertFalse(noGrant.hasAuthorizedDeliveryQuota)
        assertFalse(exhausted.hasAuthorizedDeliveryQuota)
        assertTrue(item("authorized", quota = 1).hasAuthorizedDeliveryQuota)
        assertTrue(item("unlimited", quota = null).copy(deliveryQuota = DeliveryQuota("g", 1, null, true)).hasAuthorizedDeliveryQuota)
    }

    @Test fun quotaEligibilityDoesNotDependOnWallClockOrTimezone() {
        val authorized = item("authorized")
        val manifest = DeviceManifest(1, "screen", "UTC", listOf(authorized), null)
        val engine = ScheduleEngine()
        val trustedNow = Instant.parse("2026-11-19T12:00:00Z")
        assertEquals("authorized", engine.next(manifest, trustedNow, 0)?.id)
        assertEquals("authorized", engine.next(manifest.copy(timezone = "Pacific/Honolulu"), trustedNow, 0)?.id)
    }

    @Test fun completionOffsetAdvancesAcrossAuthorizedCreativesAndQuotaExhaustionRemovesItem() {
        val first = item("a", quota = 2).copy(offer = OfferMetadata(offerTitle = "Offer A", qrUrl = "https://example.com/a"))
        val second = item("b", quota = 2).copy(offer = OfferMetadata(offerTitle = "Offer B", qrUrl = "https://example.com/b"))
        val manifest = DeviceManifest(1, "screen", "UTC", listOf(first, second), null)
        val engine = ScheduleEngine()
        assertEquals("creative-a", engine.next(manifest, offset = 0)?.creativeId)
        assertEquals("Offer B", engine.next(manifest, offset = 1)?.offer?.offerTitle)
        assertEquals("creative-b", engine.next(manifest.copy(items = listOf(first.copy(deliveryQuota = DeliveryQuota("a", 2, 0, false)), second)), offset = 0)?.creativeId)
    }

    @Test fun priorityOrdersOnlyStateAndQuotaEligibleItems() {
        val paid = item("paid", priority = 100)
        val emergency = item("emergency", priority = 1000)
        val exhausted = item("exhausted", quota = 0, priority = 2000)
        val manifest = DeviceManifest(1, "screen", "Asia/Kolkata", listOf(paid, emergency, exhausted), null)
        assertEquals("emergency", ScheduleEngine().next(manifest)?.id)
    }
}
