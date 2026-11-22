package com.ooro.screenplayer

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.location.LocationManager
import com.ooro.screenplayer.model.DeviceManifest
import com.ooro.screenplayer.model.ManifestItem
import com.ooro.screenplayer.api.safeContentType
import com.ooro.screenplayer.api.safeDiagnosticId
import com.ooro.screenplayer.api.DeviceApiException
import com.ooro.screenplayer.api.DeviceFailureKind
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import java.util.Locale

data class ApiProbe(
    val host: String,
    val dns: Boolean?,
    val tcp: Boolean,
    val tls: Boolean?,
    val httpStatus: Int?,
    val latencyMs: Long?,
    val error: String?
) {
    val connected get() = tcp && httpStatus in 200..299
    val failureKind: String? get() = when {
        connected -> null
        dns == false -> "DNS_ERROR"
        error?.contains("refused", ignoreCase = true) == true -> "CONNECTION_REFUSED"
        error?.contains("timeout", ignoreCase = true) == true -> "TIMEOUT"
        error?.contains("ssl", ignoreCase = true) == true || error?.contains("tls", ignoreCase = true) == true -> "TLS_ERROR"
        httpStatus != null && httpStatus >= 500 -> "SERVER_UNAVAILABLE"
        else -> "NETWORK_UNAVAILABLE"
    }
}

data class DiagnosticsState(
    val running: Boolean = false,
    val probe: ApiProbe? = null,
    val apiLastSuccessAt: Long? = null,
    val apiLastError: String? = null,
    val heartbeatLastAttemptAt: Long? = null,
    val heartbeatLastSuccessAt: Long? = null,
    val heartbeatStatus: Int? = null,
    val heartbeatError: String? = null,
    val manifestLastSyncAt: Long? = null,
    val manifestLastAttemptAt: Long? = null,
    val manifestError: String? = null,
    val verifiedAssets: Int = 0,
    val missingAssets: Int = 0,
    val proofQueued: Int = 0,
    val recentErrors: List<String> = emptyList(),
    val lastManifestAttempt: LastManifestAttemptDiagnostic? = null,
    val lastDiagnosis: String? = null,
    val message: String? = null
)

data class LastManifestAttemptDiagnostic(
    val attemptedAtMillis: Long,
    val clientRequestId: String,
    val androidNetworkValidated: Boolean? = null,
    val requestId: String? = null,
    val httpStatus: Int? = null,
    val contentType: String? = null,
    val failureClass: String = "IN_PROGRESS",
    val failureStage: String = "STARTING",
    val exceptionClass: String? = null,
    val failureDetail: String? = null,
    val serverInstanceId: String? = null,
    val trustedTimeResult: String = "NOT_CHECKED",
    val authenticatedServerTimeUtc: String? = null,
    val expectedServerTimeUtc: String? = null,
    val rollbackDeltaMillis: Long? = null,
    val manifestVersion: Long? = null,
    val manifestItemCount: Int? = null,
)

private const val LAST_MANIFEST_ATTEMPT_KEY = "last_manifest_attempt_diagnostic_v1"

internal fun recordLastManifestAttempt(context: Context, value: LastManifestAttemptDiagnostic) {
    val clean = value.copy(
        clientRequestId = safeDiagnosticId(value.clientRequestId) ?: "unavailable",
        requestId = safeDiagnosticId(value.requestId),
        contentType = safeContentType(value.contentType),
        failureClass = value.failureClass.takeIf { it.matches(Regex("[A-Z0-9_]{1,48}")) } ?: "REQUEST_FAILED",
        failureStage = value.failureStage.takeIf { it.matches(Regex("[A-Z0-9_]{1,48}")) } ?: "UNKNOWN",
        exceptionClass = value.exceptionClass?.takeIf { it.matches(Regex("[A-Za-z0-9_$]{1,80}")) },
        serverInstanceId = safeDiagnosticId(value.serverInstanceId),
        trustedTimeResult = value.trustedTimeResult.takeIf { it.matches(Regex("[A-Z0-9_]{1,48}")) } ?: "NOT_CHECKED",
        authenticatedServerTimeUtc = safeUtcInstant(value.authenticatedServerTimeUtc),
        expectedServerTimeUtc = safeUtcInstant(value.expectedServerTimeUtc),
        rollbackDeltaMillis = value.rollbackDeltaMillis?.coerceIn(-86_400_000L, 86_400_000L),
        manifestVersion = value.manifestVersion?.takeIf { it >= 0L },
        manifestItemCount = value.manifestItemCount?.takeIf { it in 0..10_000 },
    )
    val json = org.json.JSONObject()
        .put("attemptedAtMillis", clean.attemptedAtMillis)
        .put("clientRequestId", clean.clientRequestId)
        .put("androidNetworkValidated", clean.androidNetworkValidated)
        .put("requestId", clean.requestId)
        .put("httpStatus", clean.httpStatus)
        .put("contentType", clean.contentType)
        .put("failureClass", clean.failureClass)
        .put("failureStage", clean.failureStage)
        .put("exceptionClass", clean.exceptionClass)
        .put("failureDetail", clean.failureDetail)
        .put("serverInstanceId", clean.serverInstanceId)
        .put("trustedTimeResult", clean.trustedTimeResult)
        .put("authenticatedServerTimeUtc", clean.authenticatedServerTimeUtc)
        .put("expectedServerTimeUtc", clean.expectedServerTimeUtc)
        .put("rollbackDeltaMillis", clean.rollbackDeltaMillis)
        .put("manifestVersion", clean.manifestVersion)
        .put("manifestItemCount", clean.manifestItemCount)
    context.getSharedPreferences("ooro_local_health", Context.MODE_PRIVATE)
        .edit().putString(LAST_MANIFEST_ATTEMPT_KEY, json.toString()).commit()
}

internal fun loadLastManifestAttempt(context: Context): LastManifestAttemptDiagnostic? = runCatching {
    val raw = context.getSharedPreferences("ooro_local_health", Context.MODE_PRIVATE)
        .getString(LAST_MANIFEST_ATTEMPT_KEY, null) ?: return null
    val json = org.json.JSONObject(raw)
    LastManifestAttemptDiagnostic(
        attemptedAtMillis = json.optLong("attemptedAtMillis").takeIf { it > 0L } ?: return null,
        clientRequestId = safeDiagnosticId(json.optString("clientRequestId")) ?: return null,
        androidNetworkValidated = if (json.isNull("androidNetworkValidated")) null else json.optBoolean("androidNetworkValidated"),
        requestId = safeDiagnosticId(json.optString("requestId")),
        httpStatus = json.optInt("httpStatus").takeIf { it in 100..599 },
        contentType = safeContentType(json.optString("contentType")),
        failureClass = json.optString("failureClass").takeIf { it.matches(Regex("[A-Z0-9_]{1,48}")) } ?: "REQUEST_FAILED",
        failureStage = json.optString("failureStage").takeIf { it.matches(Regex("[A-Z0-9_]{1,48}")) } ?: "UNKNOWN",
        exceptionClass = json.optString("exceptionClass").takeIf { it.matches(Regex("[A-Za-z0-9_$]{1,80}")) },
        failureDetail = json.optString("failureDetail").takeIf { it.matches(Regex("[A-Z0-9_]{1,48}")) },
        serverInstanceId = safeDiagnosticId(json.optString("serverInstanceId")),
        trustedTimeResult = json.optString("trustedTimeResult").takeIf { it.matches(Regex("[A-Z0-9_]{1,48}")) } ?: "NOT_CHECKED",
        authenticatedServerTimeUtc = safeUtcInstant(json.optString("authenticatedServerTimeUtc")),
        expectedServerTimeUtc = safeUtcInstant(json.optString("expectedServerTimeUtc")),
        rollbackDeltaMillis = if (json.isNull("rollbackDeltaMillis")) null else json.optLong("rollbackDeltaMillis").coerceIn(-86_400_000L, 86_400_000L),
        manifestVersion = if (json.isNull("manifestVersion")) null else json.optLong("manifestVersion").takeIf { it >= 0L },
        manifestItemCount = if (json.isNull("manifestItemCount")) null else json.optInt("manifestItemCount").takeIf { it in 0..10_000 },
    )
}.getOrNull()

private fun safeUtcInstant(value: String?): String? = value?.takeIf { runCatching { java.time.Instant.parse(it) }.isSuccess }

internal fun manifestAttemptFailureClass(error: Throwable, trustedTimeResult: String): String {
    val apiError = error as? DeviceApiException
    return when (apiError?.kind) {
        DeviceFailureKind.DNS_ERROR -> "DNS_ERROR"
        DeviceFailureKind.CONNECTION_REFUSED -> "CONNECTION_REFUSED"
        DeviceFailureKind.TIMEOUT -> "API_TIMEOUT"
        DeviceFailureKind.TLS_ERROR -> "TLS_FAILURE"
        DeviceFailureKind.NETWORK_UNAVAILABLE -> "NETWORK_UNAVAILABLE"
        DeviceFailureKind.AUTH_EXPIRED -> "DEVICE_AUTH_EXPIRED"
        DeviceFailureKind.AUTH_INVALID, DeviceFailureKind.AUTH_REVOKED, DeviceFailureKind.DEVICE_NOT_FOUND, DeviceFailureKind.PAIRING_REQUIRED -> "DEVICE_AUTH_REJECTED"
        DeviceFailureKind.EDGE_REJECTED -> "CLOUDFLARE_WAF_REJECTED"
        DeviceFailureKind.SERVER_UNAVAILABLE -> "API_SERVER_ERROR"
        DeviceFailureKind.MANIFEST_PARSE_FAILED -> "RESPONSE_SCHEMA_FAILURE"
        DeviceFailureKind.REQUEST_FAILED -> "HTTP_REQUEST_FAILURE"
        null -> when {
            trustedTimeResult == "ROLLBACK" -> "TRUSTED_TIME_ROLLBACK"
            trustedTimeResult == "MALFORMED" -> "TRUSTED_TIME_MALFORMED"
            trustedTimeResult == "MISSING" -> "TRUSTED_TIME_MISSING"
            error.message.orEmpty().contains("authenticated offline authorization", ignoreCase = true) -> "TRUSTED_TIME_AUTHORIZATION_INVALID"
            error.message.orEmpty().contains("different screen", ignoreCase = true) -> "MANIFEST_SCREEN_MISMATCH"
            error.message.orEmpty().contains("asset", ignoreCase = true) || error.message.orEmpty().contains("checksum", ignoreCase = true) -> "ASSET_VERIFICATION_FAILURE"
            else -> "MANIFEST_PROCESSING_FAILURE"
        }
    }
}

internal fun manifestAttemptFailureDetail(error: Throwable): String {
    val causes = generateSequence(error) { it.cause }.toList()
    val messages = causes.mapNotNull { it.message?.lowercase() }
    return when {
        messages.any { "migration" in it } -> "ROOM_MIGRATION_ERROR"
        messages.any { "no such column" in it || "no such table" in it || "schema" in it } -> "ROOM_SCHEMA_ERROR"
        messages.any { "database is locked" in it || "database locked" in it } -> "ROOM_DATABASE_LOCKED"
        messages.any { "database is closed" in it } -> "ROOM_DATABASE_CLOSED"
        messages.any { "main thread" in it } -> "ROOM_MAIN_THREAD_ACCESS"
        causes.any { it is java.net.UnknownHostException } -> "DNS_RESOLUTION_FAILED"
        causes.any { it is javax.net.ssl.SSLException } -> "TLS_HANDSHAKE_FAILED"
        else -> "UNCLASSIFIED_FAILURE"
    }
}

internal fun recordManifestSync(context: Context, atMillis: Long = System.currentTimeMillis()) {
    context.getSharedPreferences("ooro_local_health", Context.MODE_PRIVATE).edit()
        .putLong("manifest_sync_at", atMillis).commit()
}

internal fun lastManifestSyncAt(context: Context): Long? = context
    .getSharedPreferences("ooro_local_health", Context.MODE_PRIVATE)
    .getLong("manifest_sync_at", 0L).takeIf { it > 0L }

fun probeApi(baseUrl: String): ApiProbe {
    val url = URL(baseUrl.trimEnd('/') + "/api/health")
    val host = url.host
    var dns: Boolean? = null
    var tcp = false
    var tls: Boolean? = if (url.protocol.equals("https", true)) false else null
    var status: Int? = null
    var latency: Long? = null
    var error: String? = null
    val started = System.nanoTime()
    try {
        dns = runCatching { java.net.InetAddress.getByName(host) }.isSuccess
        if (dns != true) error = "Host could not be resolved"
        val address = java.net.InetAddress.getByName(host)
        Socket().use { socket -> socket.connect(InetSocketAddress(address, url.port.takeIf { it > 0 } ?: url.defaultPort), 5_000); tcp = true }
        val connection = (url.openConnection() as HttpURLConnection).apply { connectTimeout = 5_000; readTimeout = 5_000; requestMethod = "GET"; setRequestProperty("Accept", "application/json") }
        status = connection.responseCode
        if (connection is javax.net.ssl.HttpsURLConnection) tls = true
        connection.disconnect()
        latency = (System.nanoTime() - started) / 1_000_000
        if (status !in 200..299) error = "HTTP $status"
    } catch (throwable: Throwable) {
        error = sanitizeDiagnosticError(throwable.message)
        latency = (System.nanoTime() - started) / 1_000_000
    }
    return ApiProbe(host, dns, tcp, tls, status, latency, error)
}

fun sanitizeDiagnosticError(message: String?): String = (message ?: "Unknown network error")
    .replace(Regex("Bearer\\s+\\S+", RegexOption.IGNORE_CASE), "Bearer [redacted]")
    .replace(Regex("(token|password|secret|jwt)=?[^ ,;]+", RegexOption.IGNORE_CASE), "$1=[redacted]")
    .replace(Regex("https?://[^ ]+@"), "https://[redacted]@")
    .take(180)

data class DeviceNetworkInfo(val type: String, val internet: Boolean, val localNetwork: Boolean, val ip: String?)

fun networkInfo(context: Context): DeviceNetworkInfo {
    val cm = context.getSystemService(ConnectivityManager::class.java)
    val network = cm.activeNetwork
    val caps = network?.let(cm::getNetworkCapabilities)
    val type = when {
        caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true -> "Wi-Fi"
        caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true -> "Cellular"
        caps?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true -> "Ethernet"
        else -> "None"
    }
    val local = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_RESTRICTED) == true
    val internet = caps?.let {
        it.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            it.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    } == true
    val ip = runCatching {
        val address = java.net.NetworkInterface.getNetworkInterfaces().toList().flatMap { it.inetAddresses.toList() }
            .firstOrNull { !it.isLoopbackAddress && it.hostAddress?.contains(':') == false }
        address?.hostAddress
    }.getOrNull()
    return DeviceNetworkInfo(type, internet, local, ip)
}

data class LocationDiagnostics(val permission: Boolean, val gps: Boolean, val network: Boolean)
fun locationDiagnostics(context: Context): LocationDiagnostics {
    val permission = androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED || androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_COARSE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
    val manager = context.getSystemService(LocationManager::class.java)
    return LocationDiagnostics(permission, runCatching { manager.isProviderEnabled(LocationManager.GPS_PROVIDER) }.getOrDefault(false), runCatching { manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) }.getOrDefault(false))
}

fun relativeTime(timestamp: Long?): String = timestamp?.let {
    val seconds = ((System.currentTimeMillis() - it).coerceAtLeast(0) / 1000)
    when { seconds < 5 -> "just now"; seconds < 60 -> "${seconds}s ago"; seconds < 3600 -> "${seconds / 60}m ago"; else -> "${seconds / 3600}h ago" }
} ?: "never"

fun storageSummary(context: Context): Triple<Long, Long, Long> {
    val stat = android.os.StatFs(context.filesDir.absolutePath)
    val total = stat.blockCountLong * stat.blockSizeLong
    val available = stat.availableBytes
    val cache = java.io.File(context.filesDir, "creative-cache").walkTopDown().filter { it.isFile }.sumOf { it.length() }
    return Triple(total, available, cache)
}

fun ManifestItem.safeCacheName() = id.replace(Regex("[^A-Za-z0-9._-]"), "_").take(120)
