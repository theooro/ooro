package com.ooro.screenplayer.sync

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CommandProcessorRecoveryTest {
    @Test
    fun acknowledgedUnpairIsNotReplayedAfterFreshPairing() {
        assertFalse(shouldFinalizeAcknowledgedUnpair(revocationPending = false, hasAcknowledgedUnpair = true))
    }

    @Test
    fun acknowledgedUnpairStillCompletesInterruptedRevocation() {
        assertTrue(shouldFinalizeAcknowledgedUnpair(revocationPending = true, hasAcknowledgedUnpair = true))
    }

    @Test
    fun pendingMarkerWithoutAcknowledgedUnpairDoesNotClearCredentials() {
        assertFalse(shouldFinalizeAcknowledgedUnpair(revocationPending = true, hasAcknowledgedUnpair = false))
    }
}
