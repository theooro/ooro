package com.ooro.screenplayer.sync

import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import androidx.room.withTransaction
import com.ooro.screenplayer.ManifestRefreshBus
import com.ooro.screenplayer.UnpairPendingBus
import com.ooro.screenplayer.recordManifestSync
import com.ooro.screenplayer.api.CommandResult
import com.ooro.screenplayer.api.DeviceApi
import com.ooro.screenplayer.data.DeviceStore
import com.ooro.screenplayer.data.AuthorizationRevocationAttempt
import com.ooro.screenplayer.data.retryAuthorizationRevocation
import com.ooro.screenplayer.data.ManifestEntity
import com.ooro.screenplayer.data.OoroDatabase
import com.ooro.screenplayer.model.DeviceCredentials
import com.ooro.screenplayer.player.AssetManager
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal const val RESTART_RESUME_EXTRA = "com.ooro.screenplayer.command.RESUME_ID"
private const val MAX_ERROR_LENGTH = 180
private val allowedDeviceCommands = setOf(
    "REFRESH_MANIFEST", "SYNC_MANIFEST", "HEALTH_CHECK", "RESTART_PLAYER", "RESTART_APP", "UNPAIR",
)

internal fun commandIdIsValid(id: String): Boolean = runCatching { UUID.fromString(id); true }.getOrDefault(false)
internal fun commandIsExpired(expiresAt: Instant?, now: Instant): Boolean = expiresAt != null && !now.isBefore(expiresAt)
internal fun supportedDeviceCommand(type: String): Boolean = type.uppercase() in allowedDeviceCommands
internal fun shouldFinalizeAcknowledgedUnpair(confirmedUnpairPending: Boolean, hasAcknowledgedUnpair: Boolean): Boolean =
    confirmedUnpairPending && hasAcknowledgedUnpair
internal enum class ReceiptRecovery { RETRY_ACK, FAIL_INTERRUPTED, FAIL_EXPIRED, WAIT_FOR_RESUME, REPLAY_NOT_STARTED, NONE }
internal fun receiptRecovery(phase: CommandReceiptPhase, expired: Boolean): ReceiptRecovery = when (phase) {
    CommandReceiptPhase.ACK_PENDING -> ReceiptRecovery.RETRY_ACK
    CommandReceiptPhase.RUNNING -> ReceiptRecovery.FAIL_INTERRUPTED
    CommandReceiptPhase.WAITING_RESUME -> if (expired) ReceiptRecovery.FAIL_EXPIRED else ReceiptRecovery.WAIT_FOR_RESUME
    CommandReceiptPhase.RECEIVED -> if (expired) ReceiptRecovery.FAIL_EXPIRED else ReceiptRecovery.REPLAY_NOT_STARTED
    CommandReceiptPhase.ACKED -> ReceiptRecovery.NONE
}
internal fun sanitizedCommandError(value: String?): String = (value ?: "Command failed")
    .replace(Regex("Bearer\\s+\\S+", RegexOption.IGNORE_CASE), "Bearer [redacted]")
    .replace(Regex("(token|password|secret|jwt)=?[^ ,;]+", RegexOption.IGNORE_CASE), "$1=[redacted]")
    .take(MAX_ERROR_LENGTH)

/** Executes only the small command vocabulary authorized by the paired-screen API. */
class CommandProcessor(private val context: Context, private val api: DeviceApi, private val store: DeviceStore) {
    private val receipts = CommandReceiptStore(context)

    suspend fun poll() {
        com.ooro.screenplayer.RuntimeDiagnostics.increment(com.ooro.screenplayer.RuntimeDiagnostics.Counter.COMMAND_POLL)
        val credentials = store.credentials() ?: return
        val credentialSavedAt = store.credentialsSavedAt()
        try {
            // An acknowledged UNPAIR receipt is only a crash-recovery signal while
            // its revocation marker is still pending. Replaying it after a later
            // successful pairing would clear the newly stored credentials.
            val hasAcknowledgedUnpair = receipts.forDevice(credentials.deviceId).any {
                it.commandId == store.confirmedUnpairCommandId() && it.commandType == "UNPAIR" && it.phase == CommandReceiptPhase.ACKED && it.result?.status == "SUCCEEDED"
            }
            if (shouldFinalizeAcknowledgedUnpair(store.confirmedUnpairPending(), hasAcknowledgedUnpair)) {
                invalidateAuthorizationAfterConfirmedUnpair()
                store.clearIfCurrent(credentials, credentialSavedAt)
                ManifestRefreshBus.request()
                return
            }
            val commands = api.pendingCommands(credentials)
            Log.i("OoroScreen", "command poll accepted displayId=${credentials.screenId} count=${commands.size}")
            for (command in commands) {
                process(command, credentials)
                if (store.credentials() == null) return
            }
            receipts.forDevice(credentials.deviceId).forEach { receipt ->
                when (receiptRecovery(receipt.phase, commandIsExpired(receipt.expiresAt, Instant.now()))) {
                    ReceiptRecovery.RETRY_ACK -> receipt.result?.let { acknowledge(credentials, receipt, it) }
                    ReceiptRecovery.FAIL_INTERRUPTED -> finish(credentials, receipt, failure(receipt, "FAILED", "COMMAND_INTERRUPTED", "Previous execution was interrupted; action was not repeated"))
                    ReceiptRecovery.FAIL_EXPIRED -> finish(credentials, receipt, failure(receipt, "FAILED", "COMMAND_EXPIRED", "Command expired before execution or player resume"))
                    ReceiptRecovery.WAIT_FOR_RESUME, ReceiptRecovery.NONE -> Unit
                    ReceiptRecovery.REPLAY_NOT_STARTED -> process(com.ooro.screenplayer.api.DeviceCommand(receipt.commandId, receipt.commandType, null, receipt.expiresAt), credentials)
                }
            }
        } catch (error: Throwable) {
            Log.w("OoroScreen", "command poll failed displayId=${credentials.screenId}", error)
            throw error
        }
    }

    private suspend fun process(command: com.ooro.screenplayer.api.DeviceCommand, credentials: DeviceCredentials) = processingMutex.withLock {
        processLocked(command, credentials)
    }

    private suspend fun processLocked(command: com.ooro.screenplayer.api.DeviceCommand, credentials: DeviceCredentials) {
        if (!commandIdIsValid(command.id)) {
            Log.w("OoroScreen", "invalid command ignored idFormat=invalid type=${command.type.take(48)}")
            return
        }
        if (!credentials.deviceId.isNotBlank() || !credentials.screenId.isNotBlank() || !credentials.token.isNotBlank()) {
            Log.w("OoroScreen", "command skipped because paired identity is incomplete commandId=${command.id}")
            return
        }
        val previous = receipts.get(command.id)
        if (previous != null && previous.deviceId != credentials.deviceId) {
            Log.w("OoroScreen", "command receipt device mismatch commandId=${command.id}")
            return
        }
        if (previous?.phase == CommandReceiptPhase.ACKED) {
            previous.result?.let { acknowledge(credentials, previous, it) }
            return
        }
        if (previous?.phase == CommandReceiptPhase.ACK_PENDING) {
            previous.result?.let { acknowledge(credentials, previous, it) }
            return
        }
        if (previous?.phase == CommandReceiptPhase.WAITING_RESUME) {
            if (commandIsExpired(previous.expiresAt, Instant.now())) {
                finish(credentials, previous, failure(previous, "FAILED", "COMMAND_EXPIRED", "Command expired before the player resumed"))
            }
            return
        }
        if (previous?.phase == CommandReceiptPhase.RUNNING) {
            finish(credentials, previous, failure(previous, "FAILED", "COMMAND_INTERRUPTED", "Previous execution was interrupted; action was not repeated"))
            return
        }

        val receipt = previous ?: CommandReceipt(
            commandId = command.id,
            commandType = command.type.uppercase(),
            deviceId = credentials.deviceId,
            phase = CommandReceiptPhase.RECEIVED,
            expiresAt = command.expiresAt,
        ).also(receipts::put)

        if (!supportedDeviceCommand(command.type)) {
            finish(credentials, receipt, failure(receipt, "UNSUPPORTED", "UNSUPPORTED_COMMAND", "This player does not support this command"))
            return
        }
        if (commandIsExpired(command.expiresAt, Instant.now())) {
            finish(credentials, receipt, failure(receipt, "FAILED", "COMMAND_EXPIRED", "Command expired before execution"))
            return
        }
        // The receipt is durable before side effects. If this process dies after
        // execution begins, a retry reports interruption rather than repeating it.
        val received = receipt.copy(phase = CommandReceiptPhase.RECEIVED, updatedAt = System.currentTimeMillis())
        receipts.put(received)
        val receivedAt = Instant.now()

        if (command.type.uppercase() in setOf("RESTART_PLAYER", "RESTART_APP")) {
            val waiting = received.copy(phase = CommandReceiptPhase.WAITING_RESUME, updatedAt = System.currentTimeMillis())
            receipts.put(waiting)
            try {
                val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
                    ?: throw IllegalStateException("player launch intent unavailable")
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                launch.putExtra(RESTART_RESUME_EXTRA, command.id)
                context.startActivity(launch)
            } catch (error: Exception) {
                finish(credentials, waiting, failure(waiting, "FAILED", "PLAYER_RESTART_FAILED", sanitizedCommandError(error.message)))
            }
            return
        }

        val running = received.copy(phase = CommandReceiptPhase.RUNNING, updatedAt = System.currentTimeMillis())
        receipts.put(running)
        try {
            execute(command.type, credentials)
            val completedAt = Instant.now()
            val result = CommandResult(command.id, credentials.deviceId, "SUCCEEDED", receivedAt, running.updatedAt.toInstant(), completedAt)
            finish(credentials, running, result)
        } catch (error: Exception) {
            val unsupported = error is UnsupportedOperationException
            finish(credentials, running, failure(running, if (unsupported) "UNSUPPORTED" else "FAILED", if (unsupported) "UNSUPPORTED_COMMAND" else "COMMAND_FAILED", sanitizedCommandError(error.message)))
        }
    }

    /** Called only when the restart command's marker survives into this resumed Activity. */
    suspend fun confirmRestartResumed(commandId: String?) {
        if (commandId.isNullOrBlank() || !commandIdIsValid(commandId)) return
        val credentials = store.credentials() ?: return
        val receipt = receipts.get(commandId) ?: return
        if (receipt.deviceId != credentials.deviceId || receipt.phase != CommandReceiptPhase.WAITING_RESUME) return
        val now = Instant.now()
        val result = if (commandIsExpired(receipt.expiresAt, now)) {
            failure(receipt, "FAILED", "COMMAND_EXPIRED", "Command expired before the player resumed")
        } else {
            CommandResult(commandId, credentials.deviceId, "SUCCEEDED", receipt.updatedAt.toInstant(), receipt.updatedAt.toInstant(), now)
        }
        finish(credentials, receipt, result)
    }

    private suspend fun finish(credentials: DeviceCredentials, receipt: CommandReceipt, result: CommandResult) {
        val pending = receipt.copy(phase = CommandReceiptPhase.ACK_PENDING, result = result, updatedAt = System.currentTimeMillis())
        receipts.put(pending)
        acknowledge(credentials, pending, result)
    }

    private suspend fun acknowledge(credentials: DeviceCredentials, receipt: CommandReceipt, result: CommandResult) {
        if (receipt.commandType == "UNPAIR" && result.receivedAt.toEpochMilli() < store.credentialsSavedAt()) return
        if (store.credentials() != credentials) return
        val credentialSavedAt = store.credentialsSavedAt()
        try {
            if (receipt.commandType == "UNPAIR" && result.status == "SUCCEEDED") UnpairPendingBus.request()
            if (receipt.commandType == "UNPAIR" && result.status == "SUCCEEDED" && !store.confirmedUnpairPending() && !store.beginAuthorizationRevocation(forUnpair = true, unpairCommandId = receipt.commandId)) throw IllegalStateException("authorization revocation marker could not be persisted")
            api.acknowledgeCommand(credentials, result)
            receipts.put(receipt.copy(phase = CommandReceiptPhase.ACKED, result = result, updatedAt = System.currentTimeMillis()))
            if (receipt.commandType == "UNPAIR" && result.status == "SUCCEEDED") {
                val cleanup = retryAuthorizationRevocation(store) { OoroDatabase.get(context).manifestDao().invalidateAuthorization() }
                if (cleanup is AuthorizationRevocationAttempt.Pending) Log.w("OoroScreen", "unpair acknowledged; cached authorization remains blocked until cleanup succeeds")
                store.clearIfCurrent(credentials, credentialSavedAt)
                ManifestRefreshBus.request()
            }
            Log.i("OoroScreen", "command acknowledged type=${result.status} commandId=${result.commandId}")
        } catch (error: Exception) {
            Log.w("OoroScreen", "command acknowledgement retry pending commandId=${result.commandId}", error)
        }
    }

    private fun failure(receipt: CommandReceipt, status: String, code: String, message: String): CommandResult {
        val receivedAt = receipt.updatedAt.takeIf { it > 0 }?.toInstant() ?: Instant.now()
        val startedAt = receipt.updatedAt.takeIf { receipt.phase in setOf(CommandReceiptPhase.RUNNING, CommandReceiptPhase.WAITING_RESUME) }?.toInstant()
        return CommandResult(receipt.commandId, receipt.deviceId, status, receivedAt, startedAt, Instant.now(), code, sanitizedCommandError(message))
    }

    private suspend fun execute(type: String, credentials: DeviceCredentials) {
        when (type.uppercase()) {
            "REFRESH_MANIFEST", "SYNC_MANIFEST" -> refreshManifest(credentials)
            "HEALTH_CHECK" -> Unit
            // The command acknowledgement is the server's unpair transaction;
            // calling /unpair first would revoke the token before that ack.
            "UNPAIR" -> Unit
            "RESTART_PLAYER", "RESTART_APP" -> error("restart must use the resume acknowledgement path")
            else -> throw UnsupportedOperationException("Unsupported command")
        }
    }

    private suspend fun refreshManifest(credentials: DeviceCredentials) {
        val db = OoroDatabase.get(context)
        val assets = AssetManager(context)
        val manifest = api.manifest(credentials)
        val receivedElapsed = SystemClock.elapsedRealtime()
        val bootCount = runCatching { Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT) }.getOrNull()
        check(manifest.screenId == credentials.screenId) { "manifest is assigned to a different screen" }
        val authorization = com.ooro.screenplayer.issueOfflineAuthorization(credentials.screenId, manifest.generatedAt, manifest.validUntil, manifest.authenticatedServerTime, receivedElapsed, bootCount)
            ?: error("authenticated offline authorization lease is missing, expired, or invalid")
        val previousEntity = db.manifestDao().active()?.takeIf { it.authorizationScreenId == credentials.screenId }
        val previousServerTime = previousEntity?.authorizationServerTimeUtcMillis
        check(com.ooro.screenplayer.serverTimeDoesNotRollback(previousServerTime, authorization.serverTimeUtcMillis)) { "authenticated server time moved backwards; previous authorization retained" }
        val required = manifest.items.filter { it.url.isNotBlank() }
        val cached = required.mapNotNull { assets.ensure(it) }
        manifest.sponsoredItem?.let { sponsor -> runCatching { assets.ensure(sponsor) } }
        check(com.ooro.screenplayer.canCommitDownloadedManifest(required.size, cached.size)) { "required assets are unavailable" }
        check(com.ooro.screenplayer.offlineAuthorizationRemainingMillis(authorization, credentials.screenId, SystemClock.elapsedRealtime(), runCatching { Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT) }.getOrNull()) > 0L) { "manifest authorization expired while assets were prepared" }
        db.withTransaction {
            (manifest.items + listOfNotNull(manifest.sponsoredItem)).mapNotNull { it.deliveryQuota }.distinctBy { it.id }.forEach { quota ->
                val campaignId = manifest.items.firstOrNull { it.deliveryQuota?.id == quota.id }?.campaignId ?: manifest.sponsoredItem?.takeIf { it.deliveryQuota?.id == quota.id }?.campaignId.orEmpty()
                db.deliveryQuotaDao().mergeIncoming(com.ooro.screenplayer.data.DeliveryQuotaEntity(quota.id, campaignId, quota.revision, quota.remainingPlays, quota.unlimited))
            }
            db.manifestDao().put(ManifestEntity(version = manifest.version, timezone = manifest.timezone, validUntil = manifest.validUntil?.toString(), json = com.ooro.screenplayer.api.ManifestCodec.encode(manifest), authorizationReceivedElapsedMillis = authorization.receivedElapsedMillis, authorizationBootCount = authorization.bootCount, authorizationDurationMillis = authorization.durationMillis, authorizationScreenId = authorization.screenId, authorizationServerTimeUtcMillis = authorization.serverTimeUtcMillis))
        }
        recordManifestSync(context)
        ManifestRefreshBus.request()
    }

    private suspend fun invalidateAuthorizationAfterConfirmedUnpair() {
        if (!store.confirmedUnpairPending() && !store.beginAuthorizationRevocation(forUnpair = true)) return
        retryAuthorizationRevocation(store) { OoroDatabase.get(context).manifestDao().invalidateAuthorization() }
    }

    companion object { private val processingMutex = Mutex() }
}

private fun Long.toInstant(): Instant = Instant.ofEpochMilli(this)
