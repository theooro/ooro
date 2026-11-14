package com.ooro.screenplayer.sync

import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeout
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

internal object RestartPlayerCoordinator {
    const val ACTION = "com.ooro.screenplayer.action.RESTART_PLAYER"
    private const val PREFS = "ooro_player_lifecycle"
    private const val PENDING = "pending_restart_request"
    private val waiting = ConcurrentHashMap<String, CompletableDeferred<Unit>>()

    suspend fun request(context: Context) {
        val requestId = UUID.randomUUID().toString()
        val resumed = CompletableDeferred<Unit>()
        waiting[requestId] = resumed
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        check(preferences.edit().putString(PENDING, requestId).commit()) { "restart request could not be persisted" }
        try {
            context.sendBroadcast(Intent(ACTION).setPackage(context.packageName).putExtra("requestId", requestId))
            withTimeout(15_000L) { resumed.await() }
        } finally {
            waiting.remove(requestId)
            if (preferences.getString(PENDING, null) == requestId) preferences.edit().remove(PENDING).commit()
        }
    }

    fun shouldRestart(context: Context, requestId: String?): Boolean =
        requestId != null && context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PENDING, null) == requestId

    fun activityResumed(context: Context) {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val requestId = preferences.getString(PENDING, null) ?: return
        if (preferences.edit().remove(PENDING).commit()) waiting.remove(requestId)?.complete(Unit)
    }
}
