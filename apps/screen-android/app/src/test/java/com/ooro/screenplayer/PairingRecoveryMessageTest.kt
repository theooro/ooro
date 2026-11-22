package com.ooro.screenplayer

import com.ooro.screenplayer.api.DeviceFailureKind
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingRecoveryMessageTest {
    @Test fun offlinePairingKeepsTheExistingScreenRecoveryCodeActionable() {
        for (kind in listOf(DeviceFailureKind.DNS_ERROR, DeviceFailureKind.CONNECTION_REFUSED, DeviceFailureKind.TIMEOUT, DeviceFailureKind.NETWORK_UNAVAILABLE)) {
            val message = pairingFailureMessage(kind)
            assertTrue(message, message.contains("Waiting for internet access"))
            assertTrue(message, message.contains("Keep this screen recovery code"))
        }
    }

    @Test fun tlsAndInvalidSessionErrorsStaySpecific() {
        assertTrue(pairingFailureMessage(DeviceFailureKind.TLS_ERROR).contains("Secure connection"))
        assertTrue(pairingFailureMessage(DeviceFailureKind.AUTH_INVALID).contains("Admin > Screens"))
    }
}
