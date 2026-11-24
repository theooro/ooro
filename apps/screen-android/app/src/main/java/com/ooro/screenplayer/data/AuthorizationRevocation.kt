package com.ooro.screenplayer.data

import android.util.Log

internal sealed interface AuthorizationRevocationAttempt {
    data object NotPending : AuthorizationRevocationAttempt
    data object Cleared : AuthorizationRevocationAttempt
    data class Pending(val diagnostic: String) : AuthorizationRevocationAttempt
}

internal suspend fun retryAuthorizationRevocation(store: DeviceStore, invalidateAuthorization: suspend () -> Unit): AuthorizationRevocationAttempt {
    if (!store.authorizationRevocationPending()) return AuthorizationRevocationAttempt.NotPending
    var stage = AuthorizationCleanupStage.ROOM_INVALIDATE
    return try {
        invalidateAuthorization()
        stage = AuthorizationCleanupStage.REVOCATION_MARKER_CLEAR
        check(store.completeAuthorizationRevocation()) { "revocation marker commit failed" }
        AuthorizationRevocationAttempt.Cleared
    } catch (error: Exception) {
        val diagnostic = store.recordAuthorizationRevocationFailure(error, stage)
        val failure = parseAuthorizationRevocationFailure(diagnostic)
        Log.w("OoroScreen", "authorization cleanup failed stage=${failure.stage.name} exceptionClass=${failure.exceptionClass} sqliteCode=${failure.sqliteCode ?: "unknown"} origin=${failure.origin}")
        AuthorizationRevocationAttempt.Pending(diagnostic)
    }
}

internal fun cachedAuthorizationMayBeUsed(revocationPending: Boolean, remainingMillis: Long): Boolean = !revocationPending && remainingMillis > 0L

internal fun parseAuthorizationRevocationFailure(value: String?): AuthorizationRevocationFailure {
    val message = value.orEmpty()
    val name = Regex("\\(([A-Za-z][A-Za-z0-9]{0,79})").find(message)?.groupValues?.getOrNull(1) ?: "UnknownDatabaseFailure"
    val code = Regex("SQLite code (\\d{1,3})\\)").find(message)?.groupValues?.getOrNull(1)?.toIntOrNull()?.takeIf { it in 0..255 }
    val stage = Regex("pending \\[([A-Z_]+)]").find(message)?.groupValues?.getOrNull(1)?.let { runCatching { AuthorizationCleanupStage.valueOf(it) }.getOrNull() } ?: AuthorizationCleanupStage.ROOM_INVALIDATE
    val origin = Regex("origin=([A-Za-z0-9_.$#]+)").find(message)?.groupValues?.getOrNull(1) ?: "unknown"
    return AuthorizationRevocationFailure(name, code, stage, origin)
}
