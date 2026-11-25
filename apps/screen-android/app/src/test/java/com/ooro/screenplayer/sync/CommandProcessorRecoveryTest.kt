package com.ooro.screenplayer.sync

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CommandProcessorRecoveryTest {
    @Test
    fun acknowledgedUnpairIsNotReplayedAfterFreshPairing() {
        assertFalse(shouldFinalizeAcknowledgedUnpair(confirmedUnpairPending = false, hasAcknowledgedUnpair = true))
    }

    @Test
    fun acknowledgedUnpairStillCompletesInterruptedRevocation() {
        assertTrue(shouldFinalizeAcknowledgedUnpair(confirmedUnpairPending = true, hasAcknowledgedUnpair = true))
    }

    @Test fun repairMarkerAndHistoricalReceiptNeverClearCredentials() {
        assertFalse(shouldFinalizeAcknowledgedUnpair(confirmedUnpairPending = false, hasAcknowledgedUnpair = true))
    }

    @Test
    fun pendingMarkerWithoutAcknowledgedUnpairDoesNotClearCredentials() {
        assertFalse(shouldFinalizeAcknowledgedUnpair(confirmedUnpairPending = true, hasAcknowledgedUnpair = false))
    }
}
