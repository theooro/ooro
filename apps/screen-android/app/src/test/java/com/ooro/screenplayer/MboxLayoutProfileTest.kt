package com.ooro.screenplayer

import com.ooro.screenplayer.layoutstudio.*
import org.junit.Assert.*
import org.junit.Test

class MboxLayoutProfileTest {
    private fun json(version: Int = 1, width: Int = 1280, type: String = "IMAGE") = """{
      "contractVersion":1,"mode":"CUSTOM","profileId":"MBOX_ANDROID10_1280_720_V1",
      "capabilityProfileVersion":$version,"screenType":"AUTO_SCREEN","target":{"width":$width,"height":720},
      "zones":[{"id":"image","type":"$type","label":"Approved binding","schemaVersion":1,
      "geometry":{"x":0,"y":0,"width":1,"height":1},"zIndex":0,"fit":"FIT",
      "contentBinding":{"kind":"NONE"},"visible":true}]}
    """

    @Test fun candidateProfileRoundTripsMetadataAndMatchesOnlyItsActualRuntime() {
        val contract = (LayoutStudioInterpreter.parse(json()) as LayoutParseResult.Valid).contract
        assertEquals(MboxLayoutProfile.ID, contract.profileId)
        assertFalse(MboxLayoutProfile.matchesRuntime(contract, "MBOX", 29, listOf("armeabi-v7a"), 1280, 720, MboxLayoutProfile.HARDWARE, "wrong-firmware"))
        assertEquals(1, contract.capabilityProfileVersion)
        assertTrue(MboxLayoutProfile.matchesRuntime(contract, "MBOX", 29, listOf("armeabi-v7a"), 1280, 720, MboxLayoutProfile.HARDWARE, MboxLayoutProfile.FIRMWARE_SHA256))
        assertFalse(MboxLayoutProfile.matchesRuntime(contract, "MBOX", 29, listOf("arm64-v8a"), 1280, 720, MboxLayoutProfile.HARDWARE, MboxLayoutProfile.FIRMWARE_SHA256))
        assertFalse(MboxLayoutProfile.matchesRuntime(contract, "MBOX", 30, listOf("armeabi-v7a"), 1280, 720, MboxLayoutProfile.HARDWARE, MboxLayoutProfile.FIRMWARE_SHA256))
        assertFalse(MboxLayoutProfile.matchesRuntime(contract, "MBOX", 29, listOf("armeabi-v7a"), 720, 1280, MboxLayoutProfile.HARDWARE, MboxLayoutProfile.FIRMWARE_SHA256))
        assertFalse(MboxLayoutProfile.matchesRuntime(contract, "Other board", 29, listOf("armeabi-v7a"), 1280, 720, MboxLayoutProfile.HARDWARE, MboxLayoutProfile.FIRMWARE_SHA256))
    }

    @Test fun wrongProfileRevisionResolutionAndDecoderWorkFailClosed() {
        assertEquals("PROFILE_TARGET_MISMATCH", (LayoutStudioInterpreter.parse(json(version = 2)) as LayoutParseResult.Invalid).code)
        assertEquals("PROFILE_TARGET_MISMATCH", (LayoutStudioInterpreter.parse(json(width = 1920)) as LayoutParseResult.Invalid).code)
        assertEquals("PROFILE_RESOURCE_LIMIT_EXCEEDED", (LayoutStudioInterpreter.parse(json(type = "VIDEO")) as LayoutParseResult.Invalid).code)
    }

    @Test fun flagsCannotCreateAWeatherOrClockProvider() {
        for (type in listOf("CLOCK", "WEATHER", "TICKER", "NAVIGATION_MAP")) {
            assertEquals("WIDGET_PROVIDER_UNAVAILABLE", (LayoutStudioInterpreter.parse(json(type = type), setOf(type)) as LayoutParseResult.Invalid).code)
        }
    }
}
