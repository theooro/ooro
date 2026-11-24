package com.ooro.screenplayer

import android.content.Context
import android.content.ContextWrapper
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.testing.TestListenableWorkerBuilder
import com.ooro.screenplayer.api.*
import com.ooro.screenplayer.data.*
import com.ooro.screenplayer.model.*
import com.ooro.screenplayer.player.AssetManager
import com.ooro.screenplayer.player.ScheduleEngine
import com.ooro.screenplayer.repository.ProofOfPlayRepository
import com.ooro.screenplayer.sync.SyncWorker
import com.ooro.screenplayer.sync.SyncWorkerDependencies
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.net.ServerSocket
import java.security.MessageDigest
import java.time.Instant
import kotlin.concurrent.thread

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class OfflinePersistenceIntegrationTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val name = "offline-${System.nanoTime()}.db"
    private var db: OoroDatabase? = null
    private val credentials = DeviceCredentials("device-test", "screen-test", "workspace-test", "fake", "Test")
    private fun open() = Room.databaseBuilder(context, OoroDatabase::class.java, name).allowMainThreadQueries().build().also { db = it }
    private fun authorizedResponse(manifest: DeviceManifest): DeviceManifest {
        val serverNow = Instant.now()
        return manifest.copy(generatedAt = serverNow.minusSeconds(1), validUntil = serverNow.plusSeconds(900), authenticatedServerTime = serverNow)
    }
    @After fun clean() { SyncWorkerDependencies.reset(); db?.close(); context.deleteDatabase(name) }

    @Test fun versionTwoDatabaseMissingQuotaTablesMigratesWithoutLosingManifestOrProofs() = runBlocking {
        val databaseFile = context.getDatabasePath(name).also { it.parentFile?.mkdirs() }
        val legacy = SQLiteDatabase.openOrCreateDatabase(databaseFile, null)
        legacy.execSQL("CREATE TABLE campaign_manifest (id TEXT NOT NULL PRIMARY KEY, version INTEGER NOT NULL, timezone TEXT NOT NULL, validUntil TEXT, json TEXT NOT NULL)")
        legacy.execSQL("CREATE TABLE proof_of_play (eventId TEXT NOT NULL PRIMARY KEY, payload TEXT NOT NULL, synced INTEGER NOT NULL, createdAt INTEGER NOT NULL)")
        legacy.execSQL("CREATE TABLE app_error (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, message TEXT NOT NULL, createdAt INTEGER NOT NULL)")
        legacy.execSQL("INSERT INTO campaign_manifest (id, version, timezone, validUntil, json) VALUES ('active', 17, 'Asia/Kolkata', NULL, '{}')")
        legacy.execSQL("INSERT INTO proof_of_play (eventId, payload, synced, createdAt) VALUES ('proof-preserved', '{}', 0, 1)")
        legacy.version = 2
        legacy.close()

        val migrated = Room.databaseBuilder(context, OoroDatabase::class.java, name)
            .addMigrations(OoroDatabase.MIGRATION_1_2, OoroDatabase.MIGRATION_2_3, OoroDatabase.MIGRATION_3_4, OoroDatabase.MIGRATION_4_5)
            .allowMainThreadQueries().build()
        db = migrated
        migrated.openHelper.writableDatabase

        assertEquals(5, migrated.openHelper.readableDatabase.version)
        assertEquals(17L, migrated.manifestDao().active()?.version)
        assertEquals(1, migrated.proofDao().pendingCount())
        assertTrue(migrated.deliveryQuotaDao().all().isEmpty())
    }

    @Test fun checksumNamedLegacyAssetsAreVerifiedAndReusedWithoutNetworkOrCopy() = runBlocking {
        val isolatedFilesDir = File(context.cacheDir, "legacy-reuse-${System.nanoTime()}").also { it.mkdirs() }
        val isolatedContext = object : ContextWrapper(context) { override fun getFilesDir() = isolatedFilesDir }
        val cache = File(isolatedFilesDir, "creative-cache").also { it.mkdirs() }
        val bytes = "legacy content addressed image".toByteArray()
        val checksum = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        val legacy = File(cache, "sha256-$checksum").apply { writeBytes(bytes) }
        val first = ManifestItem(
            "schedule-item-one-${System.nanoTime()}", "campaign", "creative", CreativeType.IMAGE,
            "http://127.0.0.1:0/unreachable", checksum, 10, 0, null, null, emptySet(), null, null, "asset-one",
        )
        val second = first.copy(id = "schedule-item-two-${System.nanoTime()}", assetId = "asset-two")
        val manager = AssetManager(isolatedContext)
        try {
            assertEquals("offline ensure should reuse the verified content-addressed file", legacy, manager.ensure(first))
            assertEquals(legacy.absolutePath, manager.ensure(second)?.absolutePath)
            assertEquals(setOf(first.id, second.id), manager.verifiedItemIds(listOf(first, second)))
            assertFalse(File(cache, first.id).exists())
            assertFalse(File(cache, second.id).exists())

            manager.cleanup(setOf(first.id, second.id), setOf(checksum))
            assertTrue("accepted legacy content remains retained during manifest cleanup", legacy.isFile)
            assertEquals(checksum, MessageDigest.getInstance("SHA-256").digest(legacy.readBytes()).joinToString("") { "%02x".format(it) })
        } finally {
            legacy.delete()
            File(cache, ".${first.id}.sha256").delete()
            File(cache, ".${second.id}.sha256").delete()
            isolatedFilesDir.deleteRecursively()
        }
    }

    @Test fun newerQuotaGrantKeepsOfflinePlaysReservedUntilTheirProofsAreAcknowledged() = runBlocking {
        val database = open()
        val quotas = database.deliveryQuotaDao()
        quotas.mergeIncoming(DeliveryQuotaEntity("campaign:screen", "campaign", 1, 5, false))
        assertTrue(quotas.consumeOnce("campaign:screen", 1, "offline-proof-1"))
        assertTrue(quotas.consumeOnce("campaign:screen", 1, "offline-proof-2"))
        quotas.mergeIncoming(DeliveryQuotaEntity("campaign:screen", "campaign", 2, 8, false))
        assertEquals(6, quotas.find("campaign:screen")?.remainingPlays)
        quotas.acknowledgeConsumptions(listOf("offline-proof-1"))
        quotas.mergeIncoming(DeliveryQuotaEntity("campaign:screen", "campaign", 3, 9, false))
        assertEquals(8, quotas.find("campaign:screen")?.remainingPlays)
        assertTrue("duplicate event must not decrement twice", quotas.consumeOnce("campaign:screen", 3, "offline-proof-2"))
        assertEquals(8, quotas.find("campaign:screen")?.remainingPlays)
    }

    @Test fun confirmedUnpairInvalidatesOldScreenLeaseWithoutDeletingManifestOrQueuedProofs() = runBlocking {
        val database = open()
        val lease = requireNotNull(issueOfflineAuthorization("screen-test", Instant.parse("2026-01-01T00:00:00Z"), Instant.parse("2026-01-01T00:10:00Z"), Instant.parse("2026-01-01T00:00:01Z"), 10_000L, 7))
        val manifest = DeviceManifest(7, "screen-test", "Asia/Kolkata", emptyList(), Instant.parse("2026-01-01T00:10:00Z"))
        database.manifestDao().put(ManifestEntity(version = 7, timezone = manifest.timezone, validUntil = manifest.validUntil.toString(), json = ManifestCodec.encode(manifest), authorizationReceivedElapsedMillis = lease.receivedElapsedMillis, authorizationBootCount = lease.bootCount, authorizationDurationMillis = lease.durationMillis, authorizationScreenId = lease.screenId, authorizationServerTimeUtcMillis = lease.serverTimeUtcMillis))
        database.proofDao().add(ProofEntity("queued-before-unpair", "{}"))

        // The production command path calls this only after OORO acknowledges UNPAIR.
        database.manifestDao().invalidateAuthorization()

        val persisted = requireNotNull(database.manifestDao().active())
        assertEquals(7L, persisted.version)
        assertEquals("screen-test", ManifestCodec.parse(persisted.json).screenId)
        assertNull(persisted.authorizationReceivedElapsedMillis)
        assertNull(persisted.authorizationBootCount)
        assertNull(persisted.authorizationDurationMillis)
        assertNull(persisted.authorizationScreenId)
        assertNull(persisted.authorizationServerTimeUtcMillis)
        assertEquals(listOf("queued-before-unpair"), database.proofDao().pending(10).map { it.eventId })
    }

    @Test fun failedAuthorizationCleanupRetainsCredentialAndProofAndStartupRetryFailsClosed() = runBlocking {
        val database = open()
        val preferencesName = "recovery-${System.nanoTime()}"
        val testCipher = object : CredentialCipherPort { override fun encrypt(value: String) = value; override fun decrypt(value: String) = value }
        val store = DeviceStore(context, preferencesName, testCipher)
        val credentialsReturnedByPair = DeviceCredentials("device-recovery", "screen-new", "workspace", "sensitive-token-not-logged", "Recovery")
        store.save(credentialsReturnedByPair)
        assertTrue(store.beginAuthorizationRevocation())
        val lease = requireNotNull(issueOfflineAuthorization("screen-old", Instant.parse("2026-01-01T00:00:00Z"), Instant.parse("2026-01-01T00:10:00Z"), Instant.parse("2026-01-01T00:00:01Z"), 10_000L, 7))
        val manifest = DeviceManifest(7, "screen-old", "Asia/Kolkata", emptyList(), Instant.parse("2026-01-01T00:10:00Z"))
        database.manifestDao().put(ManifestEntity(version = 7, timezone = manifest.timezone, validUntil = manifest.validUntil.toString(), json = ManifestCodec.encode(manifest), authorizationReceivedElapsedMillis = lease.receivedElapsedMillis, authorizationBootCount = lease.bootCount, authorizationDurationMillis = lease.durationMillis, authorizationScreenId = lease.screenId, authorizationServerTimeUtcMillis = lease.serverTimeUtcMillis))
        database.proofDao().add(ProofEntity("queued-recovery-proof", "{}"))
        database.openHelper.writableDatabase.execSQL("CREATE TRIGGER reject_authorization_cleanup BEFORE UPDATE OF authorizationReceivedElapsedMillis ON campaign_manifest BEGIN SELECT RAISE(ABORT, 'injected cleanup'); END")

        val failed = retryAuthorizationRevocation(store) { database.manifestDao().invalidateAuthorization() }
        assertTrue(failed is AuthorizationRevocationAttempt.Pending)
        assertEquals(credentialsReturnedByPair, store.credentials())
        assertTrue(store.authorizationRevocationPending())
        assertFalse(cachedAuthorizationMayBeUsed(store.authorizationRevocationPending(), 10_000L))
        assertEquals("queued-recovery-proof", database.proofDao().pending(10).single().eventId)
        assertTrue(store.authorizationRevocationFailure().orEmpty().contains("SQLiteConstraintException"))
        assertTrue(store.authorizationRevocationFailure().orEmpty().contains("SQLite code 19"))
        assertFalse(store.authorizationRevocationFailure().orEmpty().contains(credentialsReturnedByPair.token))

        database.openHelper.writableDatabase.execSQL("DROP TRIGGER reject_authorization_cleanup")
        database.close(); db = null
        val reopenedDatabase = open()
        val restartedStore = DeviceStore(context, preferencesName, testCipher)
        assertTrue(restartedStore.authorizationRevocationPending())
        assertEquals(credentialsReturnedByPair, restartedStore.credentials())
        assertEquals(AuthorizationRevocationAttempt.Cleared, retryAuthorizationRevocation(restartedStore) { reopenedDatabase.manifestDao().invalidateAuthorization() })
        assertFalse(restartedStore.authorizationRevocationPending())
        assertNull(reopenedDatabase.manifestDao().active()?.authorizationScreenId)
        assertEquals("queued-recovery-proof", reopenedDatabase.proofDao().pending(10).single().eventId)
    }

    @Test fun corruptChecksumNamedLegacyAssetFailsClosedAndIsNotCopiedToItemPath() = runBlocking {
        val isolatedFilesDir = File(context.cacheDir, "legacy-corrupt-${System.nanoTime()}").also { it.mkdirs() }
        val isolatedContext = object : ContextWrapper(context) { override fun getFilesDir() = isolatedFilesDir }
        val cache = File(isolatedFilesDir, "creative-cache").also { it.mkdirs() }
        val expected = "approved legacy bytes".toByteArray()
        val checksum = MessageDigest.getInstance("SHA-256").digest(expected).joinToString("") { "%02x".format(it) }
        val legacy = File(cache, "sha256-$checksum").apply { writeText("corrupt bytes") }
        val item = ManifestItem(
            "schedule-item-corrupt-${System.nanoTime()}", "campaign", "creative", CreativeType.IMAGE,
            "http://127.0.0.1:0/unreachable", checksum, 10, 0, null, null, emptySet(), null, null, "asset-corrupt",
        )
        val manager = AssetManager(isolatedContext)
        try {
            assertTrue(manager.verifiedItemIds(listOf(item)).isEmpty())
            assertNull("a filename that claims a digest cannot replace byte verification", manager.ensure(item))
            assertTrue("failed verification leaves the source cache entry untouched", legacy.isFile)
            assertFalse(File(cache, item.id).exists())
        } finally {
            legacy.delete()
            File(cache, ".${item.id}.sha256").delete()
            isolatedFilesDir.deleteRecursively()
        }
    }

    @Test fun verifiedManifestAssetAndOfflineProofSurviveDatabaseCloseAndReopen() = runBlocking {
        val first = open()
        val bytes = "synthetic-approved-creative".toByteArray()
        val checksum = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        val itemId = "creative-offline-${System.nanoTime()}"
        val server = ServerSocket(0)
        val serving = thread {
            server.accept().use { socket ->
                val request = socket.getInputStream().bufferedReader()
                while (!request.readLine().isNullOrEmpty()) { }
                socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
                socket.getOutputStream().write(bytes)
                socket.getOutputStream().flush()
            }
            server.close()
        }
        val item = ManifestItem(itemId, "campaign-approved", "creative-approved", CreativeType.IMAGE, "http://127.0.0.1:${server.localPort}/creative", checksum, 10, 1, Instant.parse("2020-01-01T00:00:00Z"), Instant.parse("2031-01-01T00:00:00Z"), emptySet(), null, null, deliveryQuota = DeliveryQuota("campaign-approved:${credentials.screenId}", 1, 5, false))
        val downloaded = AssetManager(context).ensure(item)
        serving.join()
        assertNotNull("production AssetManager should persist the downloaded asset", downloaded)
        assertTrue(com.ooro.screenplayer.player.isVerifiedCachedAsset(downloaded!!, checksum))
        val manifest = DeviceManifest(8, credentials.screenId, "UTC", listOf(item), Instant.parse("2030-01-01T00:00:00Z"), generatedAt = Instant.parse("2029-12-31T23:58:59Z"), authenticatedServerTime = Instant.parse("2029-12-31T23:59:00Z"))
        val entity = ManifestEntity(version = 8, timezone = "UTC", validUntil = manifest.validUntil.toString(), json = ManifestCodec.encode(manifest))
        first.manifestDao().put(entity)
        assertEquals("Downloading and selecting media must not fabricate proof", 0, first.proofDao().pendingCount())
        val proof = ProofOfPlay(eventId = "event-1", screenId = credentials.screenId, deviceId = credentials.deviceId, campaignId = "campaign", creativeId = "creative", scheduleItemId = "item", startedAt = Instant.parse("2026-01-01T00:00:00Z"), endedAt = Instant.parse("2026-01-01T00:00:10Z"), actualPlayedMs = 10_000, appVersion = "test")
        ProofOfPlayRepository(first).record(proof)
        ProofOfPlayRepository(first).record(proof) // Stable event ID makes recording idempotent.
        first.close(); db = null
        val reopened = open()
        assertEquals(entity, reopened.manifestDao().active())
        assertEquals("event-1", reopened.proofDao().pending(10).single().eventId)
        val restored = ManifestCodec.parse(reopened.manifestDao().active()!!.json)
        val now = Instant.parse("2026-01-01T00:00:00Z")
        val proofsBeforeSelection = reopened.proofDao().pendingCount()
        assertTrue(manifestIsAuthorizedAt(restored, now))
        val restoredAssets = AssetManager(context).verifiedItemIds(restored.items)
        assertEquals(setOf(item.id), restoredAssets)
        val startup = resolveCachedStartup(restored, credentials.screenId, restoredAssets, ScheduleEngine(), now)
        assertEquals(CachedStartupBlock.NONE, startup.block)
        assertEquals(item.id, startup.firstItem?.id)
        assertEquals("cached selection must not create another proof", proofsBeforeSelection, reopened.proofDao().pendingCount())
        File(context.filesDir, "creative-cache/${item.id}").delete()
        File(context.filesDir, "creative-cache/.$itemId.sha256").delete()
        Unit
    }

    @Test fun missingAndCorruptCachedFilesAreNotEligibleAfterOfflineRestart() = runBlocking {
        val directory = File(context.filesDir, "creative-cache").also { it.mkdirs() }
        val assetManager = AssetManager(context)
        val now = Instant.parse("2026-11-05T10:00:00Z")
        val missing = ManifestItem("offline-missing-${System.nanoTime()}", "c", "missing", CreativeType.IMAGE, "https://invalid.test/missing", "a".repeat(64), 10, 0, null, null, emptySet(), null, null)
        val corrupt = ManifestItem("offline-corrupt-${System.nanoTime()}", "c", "corrupt", CreativeType.IMAGE, "https://invalid.test/corrupt", "a".repeat(64), 10, 0, null, null, emptySet(), null, null)
        val corruptFile = File(directory, corrupt.id).apply { writeText("corrupt-content") }
        val items = listOf(missing, corrupt)
        val manifest = DeviceManifest(5, credentials.screenId, "UTC", items, now.plusSeconds(600))
        val database = open()
        database.manifestDao().put(ManifestEntity(version = 5, timezone = "UTC", validUntil = manifest.validUntil.toString(), json = ManifestCodec.encode(manifest)))
        database.close(); db = null

        val reopened = open()
        val restored = ManifestCodec.parse(reopened.manifestDao().active()!!.json)
        val verified = assetManager.verifiedItemIds(restored.items)
        assertTrue("missing and checksum-corrupt files must not be marked verified", verified.isEmpty())
        val resolution = resolveCachedStartup(restored, credentials.screenId, verified, ScheduleEngine(), now)
        assertEquals(CachedStartupBlock.NO_ELIGIBLE_VERIFIED_ASSET, resolution.block)
        assertNull(resolution.firstItem)
        assertEquals(0, reopened.proofDao().pendingCount())
        corruptFile.delete()
        File(directory, ".${corrupt.id}.sha256").delete()
        File(directory, missing.id).delete()
        File(directory, ".${missing.id}.sha256").delete()
        Unit
    }

    @Test fun cachedStartupRejectsAnotherDisplayAndExpiredAuthorizationAfterDatabaseReopen() = runBlocking {
        val database = open()
        val now = Instant.parse("2026-11-05T10:00:00Z")
        val item = ManifestItem("identity-item", "campaign", "creative", CreativeType.IMAGE, "https://invalid.test/media", "a".repeat(64), 10, 0, now.minusSeconds(60), now.plusSeconds(600), emptySet(), null, null, deliveryQuota = DeliveryQuota("campaign:${credentials.screenId}", 1, 5, false))
        val cached = DeviceManifest(2, credentials.screenId, "UTC", listOf(item), now.plusSeconds(600))
        database.manifestDao().put(ManifestEntity(version = cached.version, timezone = cached.timezone, validUntil = cached.validUntil.toString(), json = ManifestCodec.encode(cached)))
        database.close(); db = null

        val reopened = open()
        val restored = ManifestCodec.parse(reopened.manifestDao().active()!!.json)
        assertEquals(CachedStartupBlock.SCREEN_ID_MISMATCH, resolveCachedStartup(restored, "other-screen", setOf(item.id), ScheduleEngine(), now).block)
        assertEquals(CachedStartupBlock.NONE, resolveCachedStartup(restored.copy(validUntil = now), credentials.screenId, setOf(item.id), ScheduleEngine(), now).block)
        assertEquals(0, reopened.proofDao().pendingCount())
    }

    @Test fun persistedOfflineLeaseSurvivesRoomReopenButExpiresWithinItsBoundedWindow() = runBlocking {
        val issueTime = Instant.parse("2026-01-01T00:00:00Z")
        val tenHoursLater = issueTime.plusSeconds(10 * 60 * 60)
        val campaignEnd = issueTime.plusSeconds(24 * 60 * 60)
        val item = ManifestItem("i", "c", "cr", CreativeType.IMAGE, "file://cached", "a".repeat(64), 10, 1, issueTime.minusSeconds(60), campaignEnd, emptySet(), null, null, deliveryQuota = DeliveryQuota("c:screen", 1, 10, false))
        val expiry = issueTime.plusSeconds(15 * 60)
        val expired = DeviceManifest(1, "screen", "UTC", listOf(item), expiry, generatedAt = issueTime, authenticatedServerTime = issueTime)
        val lease = issueOfflineAuthorization("screen", issueTime, expiry, issueTime, 10_000L, 7)!!
        val database = open()
        database.manifestDao().put(ManifestEntity(version = 1, timezone = "UTC", validUntil = expiry.toString(), json = ManifestCodec.encode(expired), authorizationReceivedElapsedMillis = lease.receivedElapsedMillis, authorizationBootCount = lease.bootCount, authorizationDurationMillis = lease.durationMillis, authorizationScreenId = lease.screenId, authorizationServerTimeUtcMillis = lease.serverTimeUtcMillis))
        database.close(); db = null
        val reopened = open()
        val persistedEntity = reopened.manifestDao().active()!!
        val persisted = ManifestCodec.parse(persistedEntity.json)
        assertEquals("i", nextVerifiedCachedItem(persisted, ScheduleEngine(), tenHoursLater, 0, setOf("i"))?.id)
        assertEquals(CachedStartupBlock.NONE, resolveCachedStartup(persisted, "screen", setOf("i"), ScheduleEngine(), tenHoursLater, allowExpiredForOfflinePlayback = true).block)
        val restoredLease = OfflineAuthorization(persistedEntity.authorizationScreenId!!, persistedEntity.authorizationReceivedElapsedMillis!!, persistedEntity.authorizationBootCount!!, persistedEntity.authorizationDurationMillis!!, persistedEntity.authorizationServerTimeUtcMillis!!)
        assertTrue("bad device wall clock does not affect the elapsed lease", offlineAuthorizationRemainingMillis(restoredLease, "screen", 500_000L, 7) > 0L)
        assertEquals(0L, offlineAuthorizationRemainingMillis(restoredLease, "screen", 10_000L + 10 * 60 * 60_000L, 7))
        assertEquals(0L, offlineAuthorizationRemainingMillis(restoredLease, "screen", 20_000L, 8))
        assertEquals(0L, offlineAuthorizationRemainingMillis(restoredLease, "screen", lease.receivedElapsedMillis + (tenHoursLater.toEpochMilli() - issueTime.toEpochMilli()), lease.bootCount))
    }

    @Test fun coldStartReevaluatesPersistedCampaignWhenAndroidCorrectsClock() = runBlocking {
        val correctedTime = Instant.parse("2026-11-17T16:00:00Z")
        val staleClock = correctedTime.minusSeconds(459L * 24 * 60 * 60)
        val item = ManifestItem(
            "clock-corrected-campaign", "campaign", "creative", CreativeType.IMAGE,
            "file://verified-cache", "a".repeat(64), 10, 1,
            correctedTime.minusSeconds(60), correctedTime.plusSeconds(3_600), emptySet(), null, null, deliveryQuota = DeliveryQuota("campaign:screen-test", 1, 10, false),
        )
        val cached = DeviceManifest(12, credentials.screenId, "UTC", listOf(item), correctedTime.minusSeconds(30))
        val first = open()
        first.manifestDao().put(ManifestEntity(version = cached.version, timezone = cached.timezone, validUntil = cached.validUntil.toString(), json = ManifestCodec.encode(cached)))
        first.close(); db = null
        val reopened = open()
        val restored = ManifestCodec.parse(reopened.manifestDao().active()!!.json)
        val proofsBefore = reopened.proofDao().pendingCount()
        assertEquals(CachedStartupBlock.NO_ELIGIBLE_VERIFIED_ASSET,
            resolveCachedStartup(restored, credentials.screenId, setOf(item.id), ScheduleEngine(), staleClock, allowExpiredForOfflinePlayback = true).block)
        val afterClockCorrection = resolveCachedStartup(
            restored, credentials.screenId, setOf(item.id), ScheduleEngine(), correctedTime,
            allowExpiredForOfflinePlayback = true,
        )
        assertEquals(CachedStartupBlock.NONE, afterClockCorrection.block)
        assertEquals(item.id, afterClockCorrection.firstItem?.id)
        assertEquals("schedule reevaluation must not fabricate proof", proofsBefore, reopened.proofDao().pendingCount())
    }

    @Test fun legitimateEmptyManifestReplacesPreviouslyPlayableManifest() = runBlocking {
        val database = open()
        val item = ManifestItem("old", "campaign", "creative", CreativeType.IMAGE, "file://old", "a".repeat(64), 10, 1, null, null, emptySet(), null, null, deliveryQuota = DeliveryQuota("campaign:screen-test", 1, 10, false))
        val active = DeviceManifest(1, credentials.screenId, "UTC", listOf(item), Instant.parse("2030-01-01T00:00:00Z"))
        database.manifestDao().put(ManifestEntity(version = 1, timezone = "UTC", validUntil = active.validUntil.toString(), json = ManifestCodec.encode(active)))
        val revoked = DeviceManifest(2, credentials.screenId, "UTC", emptyList(), Instant.parse("2030-01-01T00:00:00Z"))
        val api = FakeApi().apply { manifestResponse = revoked }
        val response = api.manifest(credentials)
        assertTrue(canCommitManifestResponse(response, requiredCount = 0, verifiedCount = 0, now = Instant.parse("2026-01-01T00:00:00Z")))
        database.manifestDao().put(ManifestEntity(version = response.version, timezone = "UTC", validUntil = response.validUntil.toString(), json = ManifestCodec.encode(response)))
        database.close(); db = null
        val reopened = open()
        val persisted = ManifestCodec.parse(reopened.manifestDao().active()!!.json)
        assertEquals(2L, persisted.version)
        assertTrue(persisted.items.isEmpty())
        assertNull(nextVerifiedManifestItem(persisted, ScheduleEngine(), Instant.parse("2026-01-01T00:00:00Z"), 0, emptySet()))
    }

    private inner class FakeApi(var acknowledgements: Set<String> = emptySet(), var failUpload: Boolean = false) : DeviceApi {
        val submittedIds = mutableListOf<List<String>>()
        var manifestResponse: DeviceManifest? = null
        var manifestFailure: Throwable? = null
        override suspend fun health() = Unit
        override suspend fun pair(request: PairRequest) = error("unused")
        override suspend fun manifest(credentials: DeviceCredentials, correlationId: String?): DeviceManifest {
            manifestFailure?.let { throw it }
            val response = manifestResponse ?: error("no fake manifest configured")
            return if (response.generatedAt != null && response.authenticatedServerTime != null && response.validUntil != null) response else authorizedResponse(response)
        }
        override suspend fun heartbeat(credentials: DeviceCredentials, status: PlayerStatus, manifestVersion: Long, telemetry: HeartbeatTelemetry) = Unit
        override suspend fun uploadProof(credentials: DeviceCredentials, events: List<ProofOfPlay>): ProofUploadResult { submittedIds += events.map { it.eventId }; if (failUpload) error("offline"); return ProofUploadResult(acknowledgements.size, acknowledgements) }
        override suspend fun unpair(credentials: DeviceCredentials) = Unit
    }

    @Test fun failedManifestRefreshKeepsCachedPlaybackBeyondLegacyCampaignDates() = runBlocking {
        val database = open()
        val now = Instant.parse("2026-11-05T10:00:00Z")
        val item = ManifestItem("still-authorized", "campaign", "creative", CreativeType.IMAGE, "https://asset.invalid/media", "a".repeat(64), 10, 1, now.minusSeconds(60), now.plusSeconds(3_600), emptySet(), null, null, deliveryQuota = DeliveryQuota("campaign:${credentials.screenId}", 1, 5, false))
        val cached = DeviceManifest(1, credentials.screenId, "UTC", listOf(item), now.plusSeconds(900))
        val cachedEntity = ManifestEntity(version = 1, timezone = "UTC", validUntil = cached.validUntil.toString(), json = ManifestCodec.encode(cached))
        database.manifestDao().put(cachedEntity)

        val api = FakeApi().apply { manifestFailure = java.net.SocketTimeoutException("fixture timeout") }
        assertTrue(runCatching { api.manifest(credentials) }.isFailure)
        assertEquals(cachedEntity, database.manifestDao().active())
        val reopened = run { database.close(); db = null; open() }
        val lastKnownGood = ManifestCodec.parse(reopened.manifestDao().active()!!.json)
        assertEquals(item.id, nextVerifiedManifestItem(lastKnownGood, ScheduleEngine(), now.plusSeconds(300), 0, setOf(item.id))?.id)
        assertEquals(item.id, nextVerifiedManifestItem(lastKnownGood, ScheduleEngine(), now.plusSeconds(900), 0, setOf(item.id))?.id)
        assertEquals(item.id, nextVerifiedCachedItem(lastKnownGood, ScheduleEngine(), now.plusSeconds(900), 0, setOf(item.id))?.id)
        assertNull(nextVerifiedCachedItem(lastKnownGood, ScheduleEngine(), now.plusSeconds(3_600), 0, setOf(item.id)))
    }

    @Test fun successfulRefreshExtendsManifestLeaseWithoutApplyingLegacyItemDates() = runBlocking {
        val database = open()
        val now = Instant.parse("2026-11-05T10:00:00Z")
        val item = ManifestItem("campaign-end-bound", "campaign", "creative", CreativeType.IMAGE, "https://asset.invalid/media", "a".repeat(64), 10, 1, now.minusSeconds(60), now.plusSeconds(600), emptySet(), null, null, deliveryQuota = DeliveryQuota("campaign:${credentials.screenId}", 1, 5, false))
        val previous = DeviceManifest(1, credentials.screenId, "UTC", listOf(item), now.plusSeconds(120))
        database.manifestDao().put(ManifestEntity(version = 1, timezone = "UTC", validUntil = previous.validUntil.toString(), json = ManifestCodec.encode(previous)))
        val refreshed = DeviceManifest(2, credentials.screenId, "UTC", listOf(item), now.plusSeconds(900))
        val api = FakeApi().apply { manifestResponse = refreshed }
        val response = api.manifest(credentials)
        assertTrue(canCommitManifestResponse(response, requiredCount = 1, verifiedCount = 1, now = now))
        database.manifestDao().put(ManifestEntity(version = response.version, timezone = response.timezone, validUntil = response.validUntil.toString(), json = ManifestCodec.encode(response)))
        val committed = ManifestCodec.parse(database.manifestDao().active()!!.json)
        assertTrue(manifestIsAuthorizedAt(committed, now.plusSeconds(899)))
        assertNull(nextVerifiedManifestItem(committed, ScheduleEngine(), now.plusSeconds(600), 0, setOf(item.id)))
    }

    @Test fun productionWorkerKeepsPartialAcknowledgementsForRetryAndDeduplicatesIds() = runBlocking {
        val database = open()
        SyncWorkerDependencies.validatedInternet = { true }
        database.proofDao().add(ProofEntity("accepted", "{\"screenId\":\"${credentials.screenId}\",\"deviceId\":\"${credentials.deviceId}\",\"campaignId\":\"c\",\"creativeId\":\"a\",\"scheduleItemId\":\"i\",\"startedAt\":\"2026-01-01T00:00:00Z\",\"endedAt\":\"2026-01-01T00:00:10Z\",\"success\":true,\"appVersion\":\"test\"}"))
        database.proofDao().add(ProofEntity("retry", "{\"screenId\":\"${credentials.screenId}\",\"deviceId\":\"${credentials.deviceId}\",\"campaignId\":\"c\",\"creativeId\":\"b\",\"scheduleItemId\":\"i\",\"startedAt\":\"2026-01-01T00:00:00Z\",\"endedAt\":\"2026-01-01T00:00:10Z\",\"success\":true,\"appVersion\":\"test\"}"))
        val api = FakeApi(setOf("accepted"))
        SyncWorkerDependencies.credentials = { credentials }
        SyncWorkerDependencies.database = { database }
        SyncWorkerDependencies.api = { _, _ -> api }
        val firstResult = TestListenableWorkerBuilder<SyncWorker>(context).build().doWork()
        assertEquals(androidx.work.ListenableWorker.Result.retry(), firstResult)
        assertEquals(listOf("retry"), database.proofDao().pending(10).map { it.eventId })
        database.close(); db = null
        val reopened = open()
        assertEquals(listOf("retry"), reopened.proofDao().pending(10).map { it.eventId })
        api.acknowledgements = setOf("retry")
        SyncWorkerDependencies.database = { reopened }
        assertEquals(androidx.work.ListenableWorker.Result.success(), TestListenableWorkerBuilder<SyncWorker>(context).build().doWork())
        assertEquals(0, reopened.proofDao().pendingCount())
    }

    @Test fun failedUploadSurvivesWorkerRecreationAndRetriesWithSameEventId() = runBlocking {
        val database = open()
        SyncWorkerDependencies.validatedInternet = { true }
        database.proofDao().add(ProofEntity("stable-retry-id", "{\"screenId\":\"${credentials.screenId}\",\"deviceId\":\"${credentials.deviceId}\",\"campaignId\":\"c\",\"creativeId\":\"a\",\"scheduleItemId\":\"i\",\"startedAt\":\"2026-01-01T00:00:00Z\",\"endedAt\":\"2026-01-01T00:00:10Z\",\"success\":true,\"appVersion\":\"test\"}"))
        val api = FakeApi(failUpload = true)
        SyncWorkerDependencies.credentials = { credentials }
        SyncWorkerDependencies.database = { database }
        SyncWorkerDependencies.api = { _, _ -> api }
        assertEquals(androidx.work.ListenableWorker.Result.retry(), TestListenableWorkerBuilder<SyncWorker>(context).build().doWork())
        assertEquals(1, database.proofDao().pendingCount())
        database.close(); db = null

        val reopened = open()
        api.failUpload = false
        api.acknowledgements = setOf("stable-retry-id")
        SyncWorkerDependencies.database = { reopened }
        assertEquals(androidx.work.ListenableWorker.Result.success(), TestListenableWorkerBuilder<SyncWorker>(context).build().doWork())
        assertEquals(listOf(listOf("stable-retry-id"), listOf("stable-retry-id")), api.submittedIds)
        assertEquals(0, reopened.proofDao().pendingCount())
    }
}
