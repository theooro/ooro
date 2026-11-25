package com.ooro.screenplayer

import com.ooro.screenplayer.api.DeviceFailureKind
import com.ooro.screenplayer.api.DeviceApiException
import com.ooro.screenplayer.api.classifyDeviceFailure
import com.ooro.screenplayer.api.classifyNetworkFailure
import com.ooro.screenplayer.api.safeContentType
import com.ooro.screenplayer.api.safeDiagnosticId
import java.io.IOException
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
        assertEquals(DeviceFailureKind.REQUEST_FAILED, classifyDeviceFailure(404, ""))
    }

    @Test fun rebootTimeRecoveryFailuresAreClassifiedWithoutCredentialDetails() {
        assertEquals(DeviceFailureKind.DNS_ERROR, classifyNetworkFailure(UnknownHostException("api.example")))
        assertEquals(DeviceFailureKind.TLS_ERROR, classifyNetworkFailure(SSLHandshakeException("certificate rejected")))
        assertEquals(DeviceFailureKind.CONNECTION_REFUSED, classifyNetworkFailure(ConnectException("refused")))
        assertEquals(DeviceFailureKind.TIMEOUT, classifyNetworkFailure(SocketTimeoutException("timed out")))
        assertEquals(DeviceFailureKind.AUTH_INVALID, classifyDeviceFailure(401, "INVALID_DEVICE_CREDENTIALS"))
        assertEquals(DeviceFailureKind.SERVER_UNAVAILABLE, classifyDeviceFailure(503, "UPSTREAM_UNAVAILABLE"))
    }

    @Test fun edgeRejectionIsDistinctFromDeviceAuthenticationFailure() {
        assertEquals(DeviceFailureKind.EDGE_REJECTED, classifyDeviceFailure(403, null, edgeRejected = true))
        assertEquals(DeviceFailureKind.REQUEST_FAILED, classifyDeviceFailure(403, null, edgeRejected = false))
        assertEquals(DeviceFailureKind.AUTH_INVALID, classifyDeviceFailure(401, "INVALID_DEVICE_CREDENTIALS"))
    }

    @Test fun manifestDiagnosticIdentifiersAndContentTypeAreBoundedAndSanitized() {
        assertEquals("req-abc.123", safeDiagnosticId("req-abc.123"))
        assertEquals(null, safeDiagnosticId("Bearer top-secret-token"))
        assertEquals("application/json; charset=utf-8", safeContentType("application/json; charset=utf-8"))
        assertEquals(null, safeContentType("application/json\nAuthorization: Bearer secret"))
    }

    @Test fun syncFailureClassificationDistinguishesNetworkAuthEdgeTimeAndSchemaFailures() {
        assertEquals("API_TIMEOUT", manifestAttemptFailureClass(DeviceApiException(DeviceFailureKind.TIMEOUT, endpoint = "/api/device/manifest"), "NOT_RECEIVED"))
        assertEquals("DEVICE_AUTH_REJECTED", manifestAttemptFailureClass(DeviceApiException(DeviceFailureKind.AUTH_INVALID, status = 401, endpoint = "/api/device/manifest"), "NOT_RECEIVED"))
        assertEquals("CLOUDFLARE_WAF_REJECTED", manifestAttemptFailureClass(DeviceApiException(DeviceFailureKind.EDGE_REJECTED, status = 403, endpoint = "/api/device/manifest"), "NOT_RECEIVED"))
        assertEquals("RESPONSE_SCHEMA_FAILURE", manifestAttemptFailureClass(DeviceApiException(DeviceFailureKind.MANIFEST_PARSE_FAILED, status = 200, endpoint = "/api/device/manifest"), "NOT_RECEIVED"))
        assertEquals("TRUSTED_TIME_ROLLBACK", manifestAttemptFailureClass(IllegalStateException("authenticated time regressed"), "ROLLBACK"))
        assertEquals("TRUSTED_TIME_MALFORMED", manifestAttemptFailureClass(IllegalStateException("bad time"), "MALFORMED"))
    }

    @Test fun manifestFailureDetailUsesBoundedCategoriesInsteadOfRawExceptionText() {
        assertEquals("ROOM_MIGRATION_ERROR", manifestAttemptFailureDetail(IllegalStateException("Migration failed with sensitive detail")))
        assertEquals("UNCLASSIFIED_FAILURE", manifestAttemptFailureDetail(IllegalStateException("Bearer secret-token")))
        assertEquals("DNS_RESOLUTION_FAILED", manifestAttemptFailureDetail(IOException("DNS request failed", UnknownHostException("api-staging.theooro.com"))))
    }
}
