package com.ooro.screenplayer.map

import java.net.URI

/** Provider-neutral MapLibre style endpoint supplied by the device build configuration. */
fun interface MapStyleProvider {
    fun styleUri(): String?
}

class ConfiguredMapStyleProvider(private val configuredStyleUri: String) : MapStyleProvider {
    override fun styleUri(): String? {
        val candidate = configuredStyleUri.trim()
        val parsed = runCatching { URI(candidate) }.getOrNull() ?: return null
        return candidate.takeIf {
            parsed.scheme.equals("https", ignoreCase = true) &&
                !parsed.host.isNullOrBlank() &&
                parsed.userInfo == null
        }
    }
}
