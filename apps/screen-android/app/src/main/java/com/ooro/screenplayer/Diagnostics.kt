package com.ooro.screenplayer

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.location.LocationManager
import com.ooro.screenplayer.model.DeviceManifest
import com.ooro.screenplayer.model.ManifestItem
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
    val activeLayout: String? = null,
    val activeLayoutVersion: Int? = null,
    val lastDiagnosis: String? = null,
    val message: String? = null
)

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

data class DeviceManagementStatus(
    val homeResolution: String,
    val deviceOwner: Boolean,
    val lockTaskAllowlisted: Boolean,
    val lockTaskActive: Boolean,
)

fun deviceManagementStatus(context: Context): DeviceManagementStatus {
    val packageName = context.packageName
    val home = runCatching {
        val intent = android.content.Intent(android.content.Intent.ACTION_MAIN).addCategory(android.content.Intent.CATEGORY_HOME)
        context.packageManager.resolveActivity(intent, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY)
            ?.activityInfo?.packageName
    }.getOrNull()
    val owner = runCatching { context.getSystemService(android.app.admin.DevicePolicyManager::class.java).isDeviceOwnerApp(packageName) }.getOrDefault(false)
    val allowlisted = owner && runCatching { context.getSystemService(android.app.admin.DevicePolicyManager::class.java).isLockTaskPermitted(packageName) }.getOrDefault(false)
    val active = runCatching {
        val manager = context.getSystemService(android.app.ActivityManager::class.java)
        manager.lockTaskModeState != android.app.ActivityManager.LOCK_TASK_MODE_NONE &&
            manager.appTasks.any { it.taskInfo.topActivity?.packageName == packageName }
    }.getOrDefault(false)
    return deviceManagementStatus(packageName, home, owner, allowlisted, active)
}

internal fun deviceManagementStatus(packageName: String, resolvedHomePackage: String?, owner: Boolean, allowlisted: Boolean, lockTaskActive: Boolean) = DeviceManagementStatus(
    homeResolution = when (resolvedHomePackage) { packageName -> "OORO"; null -> "Unverified"; else -> "Other app" },
    deviceOwner = owner,
    lockTaskAllowlisted = owner && allowlisted,
    lockTaskActive = lockTaskActive,
)

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
    val internet = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
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
