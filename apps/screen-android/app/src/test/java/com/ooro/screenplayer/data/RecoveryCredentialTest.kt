package com.ooro.screenplayer.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.ooro.screenplayer.model.DeviceCredentials
import com.ooro.screenplayer.sync.shouldFinalizeAcknowledgedUnpair
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class RecoveryCredentialTest {
    @Test fun repairMarkerWithHistoricalUnpairNeverClearsCurrentCredentials() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val cipher = object : CredentialCipherPort {
            override fun encrypt(value: String) = value
            override fun decrypt(value: String) = value
        }
        val store = DeviceStore(context, UUID.randomUUID().toString(), cipher)
        val old = DeviceCredentials("device", "screen", "workspace", UUID.randomUUID().toString(), "Screen")
        store.save(old)
        assertTrue(store.beginAuthorizationRevocation())
        assertFalse(shouldFinalizeAcknowledgedUnpair(store.confirmedUnpairPending(), true))
        assertTrue(store.credentials() == old)
        assertTrue(store.beginAuthorizationRevocation(forUnpair = true))
        assertTrue(store.completeAuthorizationRevocation())
        assertTrue(shouldFinalizeAcknowledgedUnpair(store.confirmedUnpairPending(), true))
        val repaired = old.copy(token = UUID.randomUUID().toString())
        store.save(repaired)
        store.clearIfCurrent(old)
        assertTrue(store.credentials() == repaired)
        assertFalse(store.confirmedUnpairPending())
    }
}
