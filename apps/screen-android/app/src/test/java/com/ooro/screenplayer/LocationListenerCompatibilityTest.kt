package com.ooro.screenplayer

import com.ooro.screenplayer.location.createLocationListener
import org.junit.Assert.assertEquals
import org.junit.Test

class LocationListenerCompatibilityTest {
    @Test fun android10ProviderLifecycleCallbacksAreImplementedAndDoNotCrash() {
        var locationCallbacks = 0
        val listener = createLocationListener { locationCallbacks++ }

        listener.onProviderDisabled("network")
        listener.onProviderEnabled("network")
        @Suppress("DEPRECATION")
        listener.onStatusChanged("network", 0, null)

        assertEquals(0, locationCallbacks)
    }
}
