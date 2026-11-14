package com.ooro.screenplayer.sync

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.ooro.screenplayer.ManifestRefreshBus
import com.ooro.screenplayer.api.CommandResult
import com.ooro.screenplayer.api.DeviceApi
import com.ooro.screenplayer.api.DeviceCommand
import com.ooro.screenplayer.data.DeviceStore
import com.ooro.screenplayer.data.ManifestEntity
import com.ooro.screenplayer.data.OoroDatabase
import com.ooro.screenplayer.manifestIsAuthorizedAt
import com.ooro.screenplayer.canCommitManifestResponse
import com.ooro.screenplayer.player.AssetManager
import com.ooro.screenplayer.api.ManifestCodec
import com.ooro.screenplayer.sanitizeDiagnosticError
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

internal enum class CommandDisposition { EXECUTE, SKIP_ACKED, SKIP_CANCELLED, REJECT }
internal enum class JournalDecision { SKIP_ACKED, REPLAY_RESULT, FAIL_INTERRUPTED, EXECUTE_ONCE }
internal data class CommandValidation(val disposition: CommandDisposition, val errorCode: String? = null, val unsupported: Boolean = false)

internal fun journalDecision(acknowledged: Boolean, hasResult: Boolean, started: Boolean): JournalDecision = when {
    acknowledged -> JournalDecision.SKIP_ACKED
    hasResult -> JournalDecision.REPLAY_RESULT
    started -> JournalDecision.FAIL_INTERRUPTED
    else -> JournalDecision.EXECUTE_ONCE
}

internal fun validateScreenCommand(command: DeviceCommand, pairedDisplayId: String, now: Instant): CommandValidation {
    if (!runCatching { UUID.fromString(command.id) }.isSuccess || command.id.length != 36) return CommandValidation(CommandDisposition.REJECT, "COMMAND_ID_INVALID")
    if (command.displayId != pairedDisplayId) return CommandValidation(CommandDisposition.REJECT, "COMMAND_DEVICE_MISMATCH")
    if (command.status != "DELIVERED") return when (command.status) {
        "CANCELLED", "EXPIRED" -> CommandValidation(CommandDisposition.SKIP_CANCELLED)
        else -> CommandValidation(CommandDisposition.REJECT, "COMMAND_STATE_INVALID")
    }
    if (command.expiresAt == null && command.type.uppercase() !in setOf("SYNC_MANIFEST", "REFRESH_MANIFEST", "UNPAIR")) {
        return CommandValidation(CommandDisposition.REJECT, "COMMAND_EXPIRY_MISSING")
    }
    if (command.expiresAt?.let { !it.isAfter(now) } == true) return CommandValidation(CommandDisposition.REJECT, "COMMAND_EXPIRED")
    val payload = command.payload
    val payloadValid = when (command.type.uppercase()) {
        "SYNC_MANIFEST", "REFRESH_MANIFEST" -> payload == null || (payload.length() == 1 && payload.opt("manifestVersion") is Number && payload.optLong("manifestVersion", 0) > 0)
        "HEALTH_CHECK", "RESTART_PLAYER" -> payload == null || payload.length() == 0
        "UNPAIR" -> payload == null || (payload.length() == 1 && payload.has("deleteAfterUnpair") && payload.opt("deleteAfterUnpair") is Boolean)
        else -> return CommandValidation(CommandDisposition.REJECT, "UNSUPPORTED_COMMAND", unsupported = true)
    }
    return if (payloadValid) CommandValidation(CommandDisposition.EXECUTE) else CommandValidation(CommandDisposition.REJECT, "COMMAND_PAYLOAD_INVALID")
}

/** Local disk journal: execution guard and final result are committed before an acknowledgement is sent. */
internal class CommandJournal(private val prefs: SharedPreferences) {
    fun isAcknowledged(id: String) = prefs.getBoolean("acked:$id", false) || prefs.getBoolean(id, false)
    fun result(id: String): CommandResult? = prefs.getString("result:$id", null)?.let { runCatching { decodeCommandResult(it) }.getOrNull() }
    fun hasStarted(id: String) = prefs.getBoolean("started:$id", false)
    fun markStarted(id: String) = check(prefs.edit().putBoolean("started:$id", true).commit()) { "command start guard could not be persisted" }
    fun saveResult(result: CommandResult) = check(prefs.edit().putString("result:${result.commandId}", encodeCommandResult(result)).commit()) { "command result could not be persisted" }
    fun markAcknowledged(id: String, atMillis: Long = System.currentTimeMillis()) {
        check(prefs.edit().putBoolean("acked:$id", true).putLong("acked_at:$id", atMillis).commit()) { "command acknowledgement state could not be persisted" }
        prune(atMillis)
    }
    private fun prune(now: Long) {
        val cutoff = now - 30L * 24 * 60 * 60 * 1000
        val acknowledged = prefs.all.keys.asSequence().filter { it.startsWith("acked_at:") }
            .mapNotNull { key -> prefs.getLong(key, 0L).takeIf { it > 0L }?.let { key.removePrefix("acked_at:") to it } }
            .sortedByDescending { it.second }.toList()
        val expired = acknowledged.filter { it.second < cutoff }.map { it.first }.toMutableSet()
        acknowledged.drop(500).forEach { expired += it.first }
        if (expired.isNotEmpty()) {
            val edit = prefs.edit()
            expired.forEach { id -> listOf("result:$id", "started:$id", "acked:$id", "acked_at:$id").forEach { key -> edit.remove(key) } }
            check(edit.commit()) { "old command journal entries could not be pruned" }
        }
    }
}

class CommandProcessor(private val context: Context, private val api: DeviceApi, private val store: DeviceStore) {
    private val prefs = context.getSharedPreferences("ooro_commands", Context.MODE_PRIVATE)
    private val journal = CommandJournal(prefs)
    private val pollMutex = Mutex()

    suspend fun poll() = pollMutex.withLock {
        com.ooro.screenplayer.RuntimeDiagnostics.increment(com.ooro.screenplayer.RuntimeDiagnostics.Counter.COMMAND_POLL)
        val credentials = store.credentials() ?: return@withLock
        runCatching { api.pendingCommands(credentials) }
            .onFailure { error -> Log.w("OoroScreen", "command poll failed kind=${error.javaClass.simpleName}") }
            .getOrNull()?.forEach { command -> process(command, credentials) }
    }

    private suspend fun process(command: DeviceCommand, credentials: com.ooro.screenplayer.model.DeviceCredentials) {
        if (!runCatching { UUID.fromString(command.id) }.isSuccess || command.id.length != 36) {
            Log.w("OoroScreen", "invalid device command identifier ignored")
            return
        }
        val decision = journalDecision(journal.isAcknowledged(command.id), journal.result(command.id) != null, journal.hasStarted(command.id))
        if (decision == JournalDecision.SKIP_ACKED) return
        val validation = validateScreenCommand(command, credentials.screenId, Instant.now())
        if (validation.disposition == CommandDisposition.SKIP_CANCELLED) return
        val received = Instant.now()
        val result = journal.result(command.id) ?: run {
            val startedAt = if (decision == JournalDecision.FAIL_INTERRUPTED) null else received
            val completed = when {
                validation.disposition == CommandDisposition.REJECT -> CommandResult(
                    command.id, credentials.deviceId,
                    if (validation.unsupported) "UNSUPPORTED" else "FAILED", received, startedAt, Instant.now(),
                    validation.errorCode, validation.errorCode,
                )
                decision == JournalDecision.FAIL_INTERRUPTED -> CommandResult(command.id, credentials.deviceId, "FAILED", received, null, Instant.now(),
                    "COMMAND_INTERRUPTED", "Execution started previously but its result was not saved; the action was not repeated.")
                else -> {
                    journal.markStarted(command.id)
                    runCatching { execute(command, credentials) }
                        .fold(
                            onSuccess = { CommandResult(command.id, credentials.deviceId, "SUCCEEDED", received, startedAt, Instant.now()) },
                            onFailure = { error ->
                                val unsupported = error is UnsupportedOperationException
                                CommandResult(command.id, credentials.deviceId, if (unsupported) "UNSUPPORTED" else "FAILED", received, startedAt, Instant.now(),
                                    if (unsupported) "UNSUPPORTED_COMMAND" else "COMMAND_FAILED", safeFailure(error))
                            },
                        )
                }
            }
            journal.saveResult(completed)
            completed
        }
        runCatching { api.acknowledgeCommand(credentials, result) }
            .onSuccess { journal.markAcknowledged(command.id) }
            .onFailure { error -> Log.w("OoroScreen", "command acknowledgement pending type=${command.type} kind=${error.javaClass.simpleName}") }
    }

    private suspend fun execute(command: DeviceCommand, credentials: com.ooro.screenplayer.model.DeviceCredentials) {
        when (command.type.uppercase()) {
            "REFRESH_MANIFEST", "SYNC_MANIFEST" -> refreshManifest(credentials)
            "HEALTH_CHECK" -> api.health()
            "RESTART_PLAYER" -> RestartPlayerCoordinator.request(context)
            "UNPAIR" -> store.clear()
            "INSTALL_APPROVED_RELEASE" -> throw UnsupportedOperationException("Signed player updates are delivered through the separately enrolled DeviceOS agent.")
            else -> throw UnsupportedOperationException("Unsupported player command")
        }
    }

    private suspend fun refreshManifest(credentials: com.ooro.screenplayer.model.DeviceCredentials) {
        val db = OoroDatabase.get(context)
        val assets = AssetManager(context)
        val manifest = api.manifest(credentials)
        val receivedAt = Instant.now()
        check(manifest.screenId == credentials.screenId) { "manifest is for a different paired screen" }
        check(manifestIsAuthorizedAt(manifest, receivedAt)) { "manifest authorization is missing or expired" }
        val required = manifest.items.filter { it.url.isNotBlank() }
        val cached = required.mapNotNull { assets.ensure(it) }
        manifest.sponsoredItem?.let { sponsor -> runCatching { assets.ensure(sponsor) } }
        if (!canCommitManifestResponse(manifest, required.size, cached.size, Instant.now())) error("manifest is expired or required assets are unavailable")
        db.manifestDao().put(ManifestEntity(version = manifest.version, timezone = manifest.timezone, validUntil = manifest.validUntil?.toString(), json = ManifestCodec.encode(manifest)))
        store.recordSuccessfulManifestSync()
        ManifestRefreshBus.request()
    }
}

private fun safeFailure(error: Throwable): String = when (error) {
    is IllegalStateException -> error.message?.let(::sanitizeDiagnosticError) ?: "Player action failed"
    else -> error.javaClass.simpleName.take(80)
}

private fun encodeCommandResult(result: CommandResult): String = JSONObject()
    .put("commandId", result.commandId).put("deviceId", result.deviceId).put("status", result.status)
    .put("receivedAt", result.receivedAt.toString()).put("startedAt", result.startedAt?.toString())
    .put("completedAt", result.completedAt?.toString()).put("errorCode", result.errorCode)
    .put("errorMessage", result.errorMessage).toString()

private fun decodeCommandResult(encoded: String): CommandResult = JSONObject(encoded).let { value ->
    CommandResult(
        commandId = value.getString("commandId"), deviceId = value.getString("deviceId"), status = value.getString("status"),
        receivedAt = Instant.parse(value.getString("receivedAt")),
        startedAt = value.optString("startedAt").takeIf(String::isNotBlank)?.let(Instant::parse),
        completedAt = value.optString("completedAt").takeIf(String::isNotBlank)?.let(Instant::parse),
        errorCode = value.optString("errorCode").takeIf(String::isNotBlank),
        errorMessage = value.optString("errorMessage").takeIf(String::isNotBlank),
    )
}
