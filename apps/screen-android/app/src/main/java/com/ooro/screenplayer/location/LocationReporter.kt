package com.ooro.screenplayer.location

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.location.LocationListener
import android.os.Bundle
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat

data class LocationSnapshot(val latitude: Double, val longitude: Double, val accuracyMeters: Double, val speedMps: Double?, val headingDegrees: Double?, val occurredAt: Long)
object LocationSnapshots {
    fun fromLocation(location: Location): LocationSnapshot? = fromValues(location.latitude, location.longitude, location.accuracy.toDouble(), if (location.hasSpeed()) location.speed.takeIf { it.isFinite() && it >= 0f }?.toDouble() else null, if (location.hasBearing()) location.bearing.takeIf { it.isFinite() }?.toDouble() else null, location.time)
    fun fromValues(latitude: Double, longitude: Double, accuracyMeters: Double, speedMps: Double?, headingDegrees: Double?, occurredAt: Long): LocationSnapshot? {
        if (!latitude.isFinite() || !longitude.isFinite() || latitude !in -90.0..90.0 || longitude !in -180.0..180.0 || !accuracyMeters.isFinite() || accuracyMeters < 0.0) return null
        return LocationSnapshot(latitude, longitude, accuracyMeters, speedMps?.takeIf { it.isFinite() && it >= 0.0 }, headingDegrees?.takeIf { it.isFinite() }, occurredAt)
    }
}
object LocationCadence { fun heartbeatIntervalMs(speedMps: Double?): Long = if (speedMps != null && speedMps.isFinite() && speedMps >= 1.2) 15_000L else 30_000L }

class LocationReporter(private val context: Context) {
    @Volatile private var cached: LocationSnapshot? = null
    @Volatile private var started = false
    private val listener = createLocationListener { value ->
        Log.d("OoroScreen", "LOCATION_CALLBACK_RECEIVED accuracyBucket=${accuracyBucket(value.accuracy)}")
        LocationSnapshots.fromLocation(value)?.let { snapshot ->
            cached = snapshot
            Log.d("OoroScreen", "LOCATION_SNAPSHOT_UPDATED snapshotAvailable=true locationAgeSeconds=${ageSeconds(cached!!.occurredAt)}")
        }
    }
    fun start() {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED && ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return
        if (started) return
        started = true
        val manager = context.getSystemService(LocationManager::class.java)
        // Keep location fresh while the screen is parked. A large distance
        // threshold left the portal showing an old point indefinitely when a
        // display stayed in one place.
        manager.getProviders(true).filter { it == LocationManager.GPS_PROVIDER || it == LocationManager.NETWORK_PROVIDER }.forEach { provider -> runCatching { manager.requestLocationUpdates(provider, 30_000L, 0f, listener, Looper.getMainLooper()) } }
        cached = latest()
        Log.d("OoroScreen", "LOCATION_REPORTER_STARTED snapshotAvailable=${cached != null}")
    }
    fun stop() { runCatching { context.getSystemService(LocationManager::class.java).removeUpdates(listener) }; started = false; cached = null }
    fun latest(): LocationSnapshot? {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED && ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return null
        val manager = context.getSystemService(LocationManager::class.java)
        val location = manager.getProviders(true).asSequence().mapNotNull { provider -> runCatching { manager.getLastKnownLocation(provider) }.getOrNull() }.maxByOrNull { it.time } ?: return null
        return LocationSnapshots.fromLocation(location)?.also {
            cached = it
            Log.d("OoroScreen", "LOCATION_SNAPSHOT_UPDATED snapshotAvailable=true locationAgeSeconds=${ageSeconds(it.occurredAt)}")
        }
    }
    fun current(): LocationSnapshot? {
        val now = System.currentTimeMillis()
        val value = cached
        if (value != null && now - value.occurredAt in 0..60_000L) return value
        return latest().also { snapshot -> Log.d("OoroScreen", "LOCATION_CURRENT snapshotAvailable=${snapshot != null}") }
    }
    private fun accuracyBucket(value: Float) = when { !value.isFinite() || value < 0f -> "invalid"; value < 20f -> "<20m"; value < 100f -> "20-100m"; else -> ">=100m" }
    private fun ageSeconds(occurredAt: Long) = ((System.currentTimeMillis() - occurredAt).coerceAtLeast(0L) / 1000L)
}

/** Android 10 still invokes these callbacks as abstract interface methods. A Kotlin SAM
 * lambda only implements onLocationChanged and can crash the whole player with
 * AbstractMethodError when a provider is disabled during boot or network loss. */
internal fun createLocationListener(onLocation: (Location) -> Unit): LocationListener = object : LocationListener {
    override fun onLocationChanged(location: Location) = onLocation(location)
    @Suppress("DEPRECATION")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
    override fun onProviderEnabled(provider: String) = Unit
    override fun onProviderDisabled(provider: String) = Unit
}
