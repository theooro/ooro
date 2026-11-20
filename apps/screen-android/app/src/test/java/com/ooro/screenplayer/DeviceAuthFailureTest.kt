package com.ooro.screenplayer

import com.ooro.screenplayer.api.DeviceFailureKind
import com.ooro.screenplayer.api.classifyDeviceFailure
import com.ooro.screenplayer.api.classifyNetworkFailure
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException
import org.junit.Assert.assertEquals
import org.junit.Test

class DeviceAuthFailureTest {
    @Test fun expiredAndRevokedCredentialsAreDistinguished() {
        assertEquals(DeviceFailureKind.AUTH_EXPIRED, classifyDeviceFailure(401, "TOKEN_EXPIRED"))
        assertEquals(DeviceFailureKind.AUTH_REVOKED, classifyDeviceFailure(401, "DEVICE_REVOKED"))
        assertEquals(DeviceFailureKind.AUTH_INVALID, classifyDeviceFailure(401, "INVALID_DEVICE_CREDENTIALS"))
    }

    @Test fun connectivityAndServerFailuresAreNotReportedAsAuthFailures() {
        assertEquals(DeviceFailureKind.SERVER_UNAVAILABLE, classifyDeviceFailure(503, "UPSTREAM_UNAVAILABLE"))
        assertEquals(DeviceFailureKind.DEVICE_NOT_FOUND, classifyDeviceFailure(404, "DEVICE_NOT_FOUND"))
        assertEquals(DeviceFailureKind.PAIRING_REQUIRED, classifyDeviceFailure(404, ""))
    }

    @Test fun rebootTimeRecoveryFailuresAreClassifiedWithoutCredentialDetails() {
        assertEquals(DeviceFailureKind.DNS_ERROR, classifyNetworkFailure(UnknownHostException("api.example")))
        assertEquals(DeviceFailureKind.TLS_ERROR, classifyNetworkFailure(SSLHandshakeException("certificate rejected")))
        assertEquals(DeviceFailureKind.CONNECTION_REFUSED, classifyNetworkFailure(ConnectException("refused")))
        assertEquals(DeviceFailureKind.TIMEOUT, classifyNetworkFailure(SocketTimeoutException("timed out")))
        assertEquals(DeviceFailureKind.AUTH_INVALID, classifyDeviceFailure(401, "INVALID_DEVICE_CREDENTIALS"))
        assertEquals(DeviceFailureKind.SERVER_UNAVAILABLE, classifyDeviceFailure(503, "UPSTREAM_UNAVAILABLE"))
    }
}
