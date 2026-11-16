package com.ooro.screenplayer

import com.ooro.screenplayer.api.CommandResult
import com.ooro.screenplayer.sync.CommandReceipt
import com.ooro.screenplayer.sync.CommandReceiptPhase
import com.ooro.screenplayer.sync.CommandReceiptStore
import com.ooro.screenplayer.sync.ReceiptRecovery
import com.ooro.screenplayer.sync.commandIdIsValid
import com.ooro.screenplayer.sync.commandIsExpired
import com.ooro.screenplayer.sync.receiptRecovery
import com.ooro.screenplayer.sync.sanitizedCommandError
import com.ooro.screenplayer.sync.supportedDeviceCommand
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import java.time.Instant

@RunWith(RobolectricTestRunner::class)
class CommandProcessorPolicyTest {
    @Test fun commandValidationRejectsMalformedIdsAndUnknownOrInstallCommands() {
        assertTrue(commandIdIsValid("00000000-0000-0000-0000-000000000001"))
        assertFalse(commandIdIsValid("not-a-command-id"))
        assertTrue(supportedDeviceCommand("SYNC_MANIFEST"))
        assertTrue(supportedDeviceCommand("RESTART_PLAYER"))
        assertFalse(supportedDeviceCommand("INSTALL_RELEASE"))
        assertFalse(supportedDeviceCommand("SHELL"))
    }

    @Test fun expiryIsEnforcedAtExclusiveBoundary() {
        val now = Instant.parse("2026-11-16T00:00:00Z")
        assertFalse(commandIsExpired(now.plusSeconds(1), now))
        assertTrue(commandIsExpired(now, now))
        assertTrue(commandIsExpired(now.minusSeconds(1), now))
        assertFalse(commandIsExpired(null, now)) // Null expiry is used by API-owned reconciliation commands.
    }

    @Test fun receiptRecoveryRetriesAcknowledgementButNeverRepeatsInterruptedSideEffects() {
        assertEquals(ReceiptRecovery.RETRY_ACK, receiptRecovery(CommandReceiptPhase.ACK_PENDING, expired = false))
        assertEquals(ReceiptRecovery.FAIL_INTERRUPTED, receiptRecovery(CommandReceiptPhase.RUNNING, expired = false))
        assertEquals(ReceiptRecovery.REPLAY_NOT_STARTED, receiptRecovery(CommandReceiptPhase.RECEIVED, expired = false))
        assertEquals(ReceiptRecovery.FAIL_EXPIRED, receiptRecovery(CommandReceiptPhase.RECEIVED, expired = true))
        assertEquals(ReceiptRecovery.WAIT_FOR_RESUME, receiptRecovery(CommandReceiptPhase.WAITING_RESUME, expired = false))
        assertEquals(ReceiptRecovery.FAIL_EXPIRED, receiptRecovery(CommandReceiptPhase.WAITING_RESUME, expired = true))
        assertEquals(ReceiptRecovery.NONE, receiptRecovery(CommandReceiptPhase.ACKED, expired = false))
    }

    @Test fun diagnosticsErrorsAreSanitizedAndBounded() {
        assertEquals("Auth token=[redacted]", sanitizedCommandError("Auth token=secret-value"))
        assertTrue(sanitizedCommandError("x".repeat(300)).length <= 180)
    }

    @Test fun commandReceiptAndAcknowledgementSurviveStoreRecreation() {
        val context = RuntimeEnvironment.getApplication()
        context.getSharedPreferences("ooro_command_receipts_v1", 0).edit().clear().commit()
        val id = "00000000-0000-0000-0000-000000000002"
        val now = Instant.parse("2026-11-16T00:00:00Z")
        val result = CommandResult(id, "device-a", "SUCCEEDED", now, now, now)
        CommandReceiptStore(context).put(CommandReceipt(id, "SYNC_MANIFEST", "device-a", CommandReceiptPhase.ACK_PENDING, now.plusSeconds(30), result, now.toEpochMilli()))

        val restored = CommandReceiptStore(context).get(id)
        assertNotNull(restored)
        assertEquals(CommandReceiptPhase.ACK_PENDING, restored?.phase)
        assertEquals("device-a", restored?.deviceId)
        assertEquals(result, restored?.result)
    }

    @Test fun missingReceiptRemainsUnknownAndIsNotTreatedAsAcknowledged() {
        val context = RuntimeEnvironment.getApplication()
        assertNull(CommandReceiptStore(context).get("00000000-0000-0000-0000-000000000003"))
    }

    @Test fun receiptCleanupRemovesOldAcknowledgedRowsButKeepsPendingResults() {
        val context = RuntimeEnvironment.getApplication()
        context.getSharedPreferences("ooro_command_receipts_v1", 0).edit().clear().commit()
        val store = CommandReceiptStore(context, maxEntries = 1)
        val now = Instant.parse("2026-11-16T00:00:00Z")
        val oldId = "00000000-0000-0000-0000-000000000004"
        val recentId = "00000000-0000-0000-0000-000000000005"
        val pendingId = "00000000-0000-0000-0000-000000000006"
        fun receipt(id: String, phase: CommandReceiptPhase, at: Long) = CommandReceipt(id, "HEALTH_CHECK", "device-a", phase, null,
            CommandResult(id, "device-a", "SUCCEEDED", now, now, now), at)
        store.put(receipt(oldId, CommandReceiptPhase.ACKED, 1))
        store.put(receipt(recentId, CommandReceiptPhase.ACKED, 2))
        store.put(receipt(pendingId, CommandReceiptPhase.ACK_PENDING, 3))
        assertNull(store.get(oldId))
        assertNotNull(store.get(recentId))
        assertEquals(CommandReceiptPhase.ACK_PENDING, store.get(pendingId)?.phase)
    }
}
