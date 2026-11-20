package com.ooro.screenplayer

import com.ooro.screenplayer.map.ConfiguredMapStyleProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MapStyleProviderTest {
    @Test fun acceptsConfiguredHttpsStyleFromAnyProvider() {
        assertEquals("https://tiles.example/style.json", ConfiguredMapStyleProvider(" https://tiles.example/style.json ").styleUri())
    }

    @Test fun missingOrInsecureProviderDoesNotFallBackToPublicTiles() {
        assertNull(ConfiguredMapStyleProvider("").styleUri())
        assertNull(ConfiguredMapStyleProvider("http://tiles.example/style.json").styleUri())
        assertNull(ConfiguredMapStyleProvider("https:///style.json").styleUri())
        assertNull(ConfiguredMapStyleProvider("https://user@tiles.example/style.json").styleUri())
    }
}
