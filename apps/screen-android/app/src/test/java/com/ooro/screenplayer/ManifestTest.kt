package com.ooro.screenplayer

import com.ooro.screenplayer.model.*
import com.ooro.screenplayer.player.ScheduleEngine
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

class ManifestTest { @Test fun creativeOrderMatchesServerManifestOrder() { val first = ManifestItem("b", "c", "b", CreativeType.IMAGE, "", null, 1, 1, Instant.parse("2000-01-01T00:00:00Z"), Instant.parse("2100-01-01T00:00:00Z"), emptySet(), null, null, deliveryQuota = DeliveryQuota("c:s", 1, 2, false)); val second = first.copy(id = "a", priority = 2); val result = ScheduleEngine().eligible(DeviceManifest(1, "s", "UTC", listOf(first, second), null), Instant.parse("2026-08-22T00:00:00Z")); assertEquals(listOf("b", "a"), result.map { it.id }) } }
