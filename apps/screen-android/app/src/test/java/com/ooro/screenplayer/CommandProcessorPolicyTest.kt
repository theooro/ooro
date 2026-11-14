package com.ooro.screenplayer

import androidx.test.core.app.ApplicationProvider
import android.content.Context
import com.ooro.screenplayer.api.CommandResult
import com.ooro.screenplayer.api.DeviceCommand
import com.ooro.screenplayer.sync.CommandDisposition
import com.ooro.screenplayer.sync.CommandJournal
import com.ooro.screenplayer.sync.JournalDecision
import com.ooro.screenplayer.sync.journalDecision
import com.ooro.screenplayer.sync.validateScreenCommand
import com.ooro.screenplayer.sync.RestartPlayerCoordinator
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Instant

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class CommandProcessorPolicyTest {
    private val now = Instant.parse("2026-11-14T10:00:00Z")
    private val screen = "11111111-1111-4111-8111-111111111111"
    private val commandId = "22222222-2222-4222-8222-222222222222"

    private fun command(type: String = "SYNC_MANIFEST", status: String = "DELIVERED", expiry: Instant? = now.plusSeconds(60), display: String? = screen, payload: JSONObject? = null) =
        DeviceCommand(commandId, type, payload, expiry, display, status)

    @Test fun expiryAndCancellationPreventExecution() {
        assertEquals("COMMAND_EXPIRED", validateScreenCommand(command(expiry = now), screen, now).errorCode)
        assertEquals(CommandDisposition.SKIP_CANCELLED, validateScreenCommand(command(status = "CANCELLED"), screen, now).disposition)
        assertEquals(CommandDisposition.SKIP_CANCELLED, validateScreenCommand(command(status = "EXPIRED"), screen, now).disposition)
    }

    @Test fun rejectsWrongDeviceAndMalformedPayload() {
        assertEquals("COMMAND_DEVICE_MISMATCH", validateScreenCommand(command(display = "33333333-3333-4333-8333-333333333333"), screen, now).errorCode)
        assertEquals("COMMAND_PAYLOAD_INVALID", validateScreenCommand(command(type = "RESTART_PLAYER", payload = JSONObject().put("shell", "reboot")), screen, now).errorCode)
    }

    @Test fun unknownAndInstallCommandsAreExplicitlyUnsupported() {
        val update = validateScreenCommand(command(type = "INSTALL_APPROVED_RELEASE"), screen, now)
        assertEquals(CommandDisposition.REJECT, update.disposition)
        assertTrue(update.unsupported)
        assertTrue(validateScreenCommand(command(type = "UNRECOGNIZED"), screen, now).unsupported)
    }

    @Test fun duplicateDeliveryReplaysSavedResultAndDurableAckSkips() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val prefsName = "command-journal-test-${System.nanoTime()}"
        val first = CommandJournal(context.getSharedPreferences(prefsName, Context.MODE_PRIVATE))
        val result = CommandResult(commandId, "device-a", "SUCCEEDED", now, now, now.plusSeconds(1))
        first.markStarted(commandId)
        first.saveResult(result)

        val afterProcessRestart = CommandJournal(context.getSharedPreferences(prefsName, Context.MODE_PRIVATE))
        assertEquals(JournalDecision.REPLAY_RESULT, journalDecision(afterProcessRestart.isAcknowledged(commandId), afterProcessRestart.result(commandId) != null, afterProcessRestart.hasStarted(commandId)))
        assertEquals(result, afterProcessRestart.result(commandId))
        afterProcessRestart.markAcknowledged(commandId, now.toEpochMilli())
        assertTrue(CommandJournal(context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)).isAcknowledged(commandId))
        assertEquals(JournalDecision.SKIP_ACKED, journalDecision(true, true, true))
    }

    @Test fun processInterruptionIsNeverRetriedAsASecondSideEffect() {
        assertEquals(JournalDecision.FAIL_INTERRUPTED, journalDecision(acknowledged = false, hasResult = false, started = true))
        assertEquals(JournalDecision.EXECUTE_ONCE, journalDecision(acknowledged = false, hasResult = false, started = false))
        assertFalse(journalDecision(acknowledged = false, hasResult = false, started = true) == JournalDecision.EXECUTE_ONCE)
    }

    @Test fun oldAcknowledgedRecordsAreBoundedButUnacknowledgedRecordsRemain() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val journal = CommandJournal(context.getSharedPreferences("command-prune-${System.nanoTime()}", Context.MODE_PRIVATE))
        val old = "44444444-4444-4444-8444-444444444444"
        val pending = "55555555-5555-4555-8555-555555555555"
        journal.markStarted(pending)
        journal.saveResult(CommandResult(old, "device-a", "FAILED", now, now, now))
        journal.markAcknowledged(old, now.minusSeconds(31L * 24 * 60 * 60).toEpochMilli())
        assertTrue(journal.hasStarted(pending))
        assertFalse(journal.isAcknowledged(old))
    }

    @Test fun homeResolutionNeverImpliesManagedKioskAcceptance() {
        val status = deviceManagementStatus("com.ooro.screenplayer", "com.ooro.screenplayer", owner = false, allowlisted = false, lockTaskActive = false)
        assertEquals("OORO", status.homeResolution)
        assertFalse(status.deviceOwner)
        assertFalse(status.lockTaskAllowlisted)
        assertFalse(status.lockTaskActive)

        val unresolved = deviceManagementStatus("com.ooro.screenplayer", null, owner = true, allowlisted = true, lockTaskActive = false)
        assertEquals("Unverified", unresolved.homeResolution)
        assertTrue(unresolved.deviceOwner)
        assertTrue(unresolved.lockTaskAllowlisted)
        assertFalse(unresolved.lockTaskActive)
    }

    @Test fun restartAcknowledgementWaitsForMatchingActivityResumeRequest() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val requestId = "66666666-6666-4666-8666-666666666666"
        context.getSharedPreferences("ooro_player_lifecycle", Context.MODE_PRIVATE).edit()
            .putString("pending_restart_request", requestId).commit()
        assertTrue(RestartPlayerCoordinator.shouldRestart(context, requestId))
        assertFalse(RestartPlayerCoordinator.shouldRestart(context, "77777777-7777-4777-8777-777777777777"))
        RestartPlayerCoordinator.activityResumed(context)
        assertFalse(RestartPlayerCoordinator.shouldRestart(context, requestId))
    }
}
