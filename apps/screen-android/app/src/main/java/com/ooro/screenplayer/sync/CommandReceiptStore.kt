package com.ooro.screenplayer.sync

import android.content.Context
import com.ooro.screenplayer.api.CommandResult
import org.json.JSONObject
import java.time.Instant

internal enum class CommandReceiptPhase { RECEIVED, RUNNING, WAITING_RESUME, ACK_PENDING, ACKED }

internal data class CommandReceipt(
    val commandId: String,
    val commandType: String,
    val deviceId: String,
    val phase: CommandReceiptPhase,
    val expiresAt: Instant?,
    val result: CommandResult? = null,
    val updatedAt: Long = System.currentTimeMillis(),
)

/** Small durable journal for the bounded, idempotent screen-command set. */
internal class CommandReceiptStore(context: Context, private val maxEntries: Int = 200) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    fun get(commandId: String): CommandReceipt? = synchronized(lock) {
        prefs.getString(commandId, null)?.let(::decode)
    }

    fun forDevice(deviceId: String): List<CommandReceipt> = synchronized(lock) {
        prefs.all.values.mapNotNull { (it as? String)?.let(::decode) }
            .filter { it.deviceId == deviceId }
            .sortedBy { it.updatedAt }
    }

    fun put(receipt: CommandReceipt) = synchronized(lock) {
        val encoded = encode(receipt)
        check(prefs.edit().putString(receipt.commandId, encoded).commit()) { "Could not persist command receipt" }
        pruneLocked()
    }

    private fun pruneLocked() {
        val decoded = prefs.all.mapNotNull { (key, value) ->
            if (value !is String) null else decode(value)?.let { key to it }
        }
        val invalidKeys = prefs.all.keys - decoded.map { it.first }.toSet()
        val removableTerminal = decoded.filter { it.second.phase == CommandReceiptPhase.ACKED }
            .sortedByDescending { it.second.updatedAt }
            .drop(maxEntries.coerceAtLeast(1))
            .map { it.first }
        val remove = invalidKeys + removableTerminal
        if (remove.isNotEmpty()) prefs.edit().also { editor -> remove.forEach { key -> editor.remove(key) } }.commit()
    }

    private fun encode(receipt: CommandReceipt) = JSONObject()
        .put("commandId", receipt.commandId)
        .put("commandType", receipt.commandType)
        .put("deviceId", receipt.deviceId)
        .put("phase", receipt.phase.name)
        .put("expiresAt", receipt.expiresAt?.toString())
        .put("updatedAt", receipt.updatedAt)
        .put("result", receipt.result?.let(::encodeResult))
        .toString()

    private fun decode(value: String): CommandReceipt? = runCatching {
        val json = JSONObject(value)
        val result = json.optJSONObject("result")?.let(::decodeResult)
        CommandReceipt(
            commandId = json.getString("commandId"),
            commandType = json.getString("commandType"),
            deviceId = json.getString("deviceId"),
            phase = CommandReceiptPhase.valueOf(json.getString("phase")),
            expiresAt = json.optString("expiresAt").takeIf { it.isNotBlank() && it != "null" }?.let(Instant::parse),
            result = result,
            updatedAt = json.optLong("updatedAt", 0L),
        )
    }.getOrNull()

    private fun encodeResult(result: CommandResult) = JSONObject()
        .put("commandId", result.commandId)
        .put("deviceId", result.deviceId)
        .put("status", result.status)
        .put("receivedAt", result.receivedAt.toString())
        .put("startedAt", result.startedAt?.toString())
        .put("completedAt", result.completedAt?.toString())
        .put("errorCode", result.errorCode)
        .put("errorMessage", result.errorMessage)

    private fun decodeResult(json: JSONObject) = CommandResult(
        commandId = json.getString("commandId"),
        deviceId = json.getString("deviceId"),
        status = json.getString("status"),
        receivedAt = Instant.parse(json.getString("receivedAt")),
        startedAt = json.optString("startedAt").takeIf { it.isNotBlank() && it != "null" }?.let(Instant::parse),
        completedAt = json.optString("completedAt").takeIf { it.isNotBlank() && it != "null" }?.let(Instant::parse),
        errorCode = json.optString("errorCode").takeIf { it.isNotBlank() && it != "null" },
        errorMessage = json.optString("errorMessage").takeIf { it.isNotBlank() && it != "null" },
    )

    companion object {
        private const val PREFERENCES = "ooro_command_receipts_v1"
        private val lock = Any()
    }
}
