package com.ooro.screenplayer.data

import android.util.Log

internal sealed interface AuthorizationRevocationAttempt {
    data object NotPending : AuthorizationRevocationAttempt
    data object Cleared : AuthorizationRevocationAttempt
    data class Pending(val diagnostic: String) : AuthorizationRevocationAttempt
}

internal suspend fun retryAuthorizationRevocation(store: DeviceStore, invalidateAuthorization: suspend () -> Unit): AuthorizationRevocationAttempt {
    if (!store.authorizationRevocationPending()) return AuthorizationRevocationAttempt.NotPending
    return try {
        invalidateAuthorization()
        check(store.completeAuthorizationRevocation()) { "revocation marker commit failed" }
        AuthorizationRevocationAttempt.Cleared
    } catch (error: Exception) {
        val diagnostic = store.recordAuthorizationRevocationFailure(error)
        val failure = parseAuthorizationRevocationFailure(diagnostic)
        Log.w("OoroScreen", "authorization cleanup failed stage=AUTHORIZATION_RESET exceptionClass=${failure.exceptionClass} sqliteCode=${failure.sqliteCode ?: "unknown"}")
        AuthorizationRevocationAttempt.Pending(diagnostic)
    }
}

internal fun cachedAuthorizationMayBeUsed(revocationPending: Boolean, remainingMillis: Long): Boolean = !revocationPending && remainingMillis > 0L

internal fun parseAuthorizationRevocationFailure(value: String?): AuthorizationRevocationFailure {
    val message = value.orEmpty()
    val name = Regex("\\(([A-Za-z][A-Za-z0-9]{0,79})").find(message)?.groupValues?.getOrNull(1) ?: "UnknownDatabaseFailure"
    val code = Regex("SQLite code (\\d{1,3})\\)").find(message)?.groupValues?.getOrNull(1)?.toIntOrNull()?.takeIf { it in 0..255 }
    return AuthorizationRevocationFailure(name, code)
}
