package com.ooro.screenplayer

import com.ooro.screenplayer.api.ManifestCodec
import com.ooro.screenplayer.api.DeviceApi
import com.ooro.screenplayer.api.DeviceApiException
import com.ooro.screenplayer.api.DeviceFailureKind
import com.ooro.screenplayer.model.CreativeType
import com.ooro.screenplayer.model.DeviceCredentials
import com.ooro.screenplayer.model.DeviceManifest
import com.ooro.screenplayer.model.DisplayLayout
import com.ooro.screenplayer.model.FitMode
import com.ooro.screenplayer.model.ManifestItem
import com.ooro.screenplayer.player.downloadVerifiedAsset
import com.ooro.screenplayer.player.sha256
import com.ooro.screenplayer.player.ScheduleEngine
import com.ooro.screenplayer.player.isVerifiedCachedAsset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import kotlinx.coroutines.runBlocking

class OfflinePlaybackRulesTest {
    private val now = Instant.parse("2026-11-05T10:00:00Z")
    private fun item(id: String, priority: Int = 0, intervalSeconds: Double = 0.0) = ManifestItem(
        id = id, campaignId = "campaign-$id", creativeId = "creative-$id", type = CreativeType.IMAGE,
        url = "https://assets.example/$id.png", checksum = "a".repeat(64), durationSeconds = 10,
        priority = priority, startAt = now.minusSeconds(86_400), endAt = now.plusSeconds(86_400), daysOfWeek = emptySet(),
        startTime = null, endTime = null, assetId = "asset-$id", fitMode = FitMode.FIT,
        intervalSeconds = intervalSeconds,
        deliveryQuota = com.ooro.screenplayer.model.DeliveryQuota("campaign-$id:screen-test", 1, 100, false),
    )
    private fun manifest(items: List<ManifestItem>, validUntil: Instant? = now.plusSeconds(900)) =
        DeviceManifest(7, "screen-test", "UTC", items, validUntil, generatedAt = now.minusSeconds(1), authenticatedServerTime = now)

    @Test fun freshVerifiedAssetRemainsSelectableWhenNetworkIsUnavailable() {
        val directory = kotlin.io.path.createTempDirectory("ooro-offline-playlist-").toFile()
        val target = File(directory, "asset-a")
        val temp = File(directory, "asset-a.part")
        val payload = "authorized fixture bytes".toByteArray()
        val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        val serverThread = Thread {
            runCatching {
                server.accept().use { socket ->
                    val reader = socket.getInputStream().bufferedReader()
                    reader.readLine()
                    while (!reader.readLine().isNullOrEmpty()) { }
                    socket.getOutputStream().use { output ->
                        output.write("HTTP/1.1 200 OK\r\nContent-Length: ${payload.size}\r\nConnection: close\r\n\r\n".toByteArray())
                        output.write(payload)
                    }
                }
            }
        }.apply { isDaemon = true; start() }
        try {
            val downloaded = downloadVerifiedAsset("http://127.0.0.1:${server.localPort}/asset", temp, target, null)
            val creative = item("a").copy(checksum = sha256(downloaded))
            assertTrue(isVerifiedCachedAsset(downloaded, creative.checksum))
            server.close() // subsequent selection has no network dependency
            assertEquals("a", nextVerifiedManifestItem(manifest(listOf(creative)), ScheduleEngine(), now, 0, setOf("a"))?.id)
        } finally {
            runCatching { server.close() }
            serverThread.join(1_000)
            directory.deleteRecursively()
        }
    }

    @Test fun restartCanReconstructManifestAndLocalAssetEligibility() {
        val original = manifest(listOf(item("a")))
        val afterRestart = ManifestCodec.parse(ManifestCodec.encode(original))
        val newScheduler = ScheduleEngine()
        assertEquals("a", nextVerifiedManifestItem(afterRestart, newScheduler, now, 0, setOf("a"))?.id)
    }

    @Test fun refreshFailureDoesNotAuthorizeCommitOfAnUnverifiedCandidate() {
        assertFalse(canCommitDownloadedManifest(requiredCount = 2, verifiedCount = 1))
        assertTrue(canCommitDownloadedManifest(requiredCount = 2, verifiedCount = 2))
    }

    @Test fun halfDownloadedOrMissingAssetIsNotInVerifiedSelection() {
        assertNull(nextVerifiedManifestItem(manifest(listOf(item("a"))), ScheduleEngine(), now, 0, emptySet()))
    }

    @Test fun checksumMismatchAndCorruptedCacheAreExcluded() {
        val available = setOf("good")
        val candidates = manifest(listOf(item("bad"), item("good")))
        assertEquals("good", nextVerifiedManifestItem(candidates, ScheduleEngine(), now, 0, available)?.id)
    }

    @Test fun legitimateEmptyManifestCanReplacePreviousPlaylist() {
        assertTrue(canCommitDownloadedManifest(requiredCount = 0, verifiedCount = 0))
        assertNull(nextVerifiedManifestItem(manifest(emptyList()), ScheduleEngine(), now, 0, emptySet()))
    }

    @Test fun manifestExpiresAtExclusiveBoundaryWithoutOfflineGrace() {
        assertTrue(manifestIsAuthorizedAt(manifest(listOf(item("a")), now.plusSeconds(30)), now))
        assertFalse(manifestIsAuthorizedAt(manifest(listOf(item("a")), now), now))
        assertFalse(manifestIsAuthorizedAt(manifest(listOf(item("a")), now.minusNanos(1)), now))
    }

    @Test fun offlineLeaseUsesAuthenticatedServerDateAndMonotonicTimeRatherThanWallClock() {
        val expiry = now.plusSeconds(900)
        val lease = issueOfflineAuthorization("screen-test", now.minusSeconds(2), expiry, now, 50_000L, 17)
        assertNotNull(lease)
        assertEquals(895_000L, offlineAuthorizationRemainingMillis(lease, "screen-test", 50_000L, 17))
        // Wall-clock values are intentionally absent from the evaluator; time only moves monotonically.
        assertEquals(595_000L, offlineAuthorizationRemainingMillis(lease, "screen-test", 350_000L, 17))
        assertEquals(0L, offlineAuthorizationRemainingMillis(lease, "screen-test", 945_000L, 17))
    }

    @Test fun rebootInvalidatesTrustedScheduleTimeUntilAuthenticatedReconnect() {
        val lease = issueOfflineAuthorization("screen-test", now.minusSeconds(1), now.plusSeconds(600), now, 10_000L, 8)
        assertEquals(now, trustedScheduleTime(lease, "screen-test", 10_000L, 8))
        assertNull(trustedScheduleTime(lease, "screen-test", 11_000L, 9))
        val renewed = issueOfflineAuthorization("screen-test", now, now.plusSeconds(600), now.plusSeconds(2), 1_000L, 9)
        assertEquals(now.plusSeconds(2), trustedScheduleTime(renewed, "screen-test", 1_000L, 9))
    }

    @Test fun trustedTimeDiagnosticSeparatesExpiredLeaseFromRebootInvalidation() {
        val lease = OfflineAuthorization("screen-test", 10_000L, 8, 895_000L, now.toEpochMilli())
        assertEquals(
            "Trusted time unavailable: the authenticated schedule-time lease expired. Reconnect to renew it before playback.",
            trustedTimeUnavailableMessage(lease, "screen-test", 905_001L, 8),
        )
        assertEquals(
            "Trusted time unavailable: device reboot invalidated the authenticated time anchor. Reconnect to renew it before playback.",
            trustedTimeUnavailableMessage(lease, "screen-test", 500L, 9),
        )
        assertTrue(trustedTimeUnavailableMessage(null, "screen-test", 500L, 9).contains("no authenticated schedule-time anchor"))
        assertTrue(trustedTimeUnavailableMessage(null, null, 500L, 9).contains("unpaired"))
    }

    @Test fun campaignDatesAreInclusiveByCalendarDayAndExclusiveAtNextMidnight() {
        val creative = item("date-window").copy(
            startAt = Instant.parse("2026-11-05T00:00:00Z"),
            endAt = Instant.parse("2026-11-07T00:00:00Z"),
            // Old daily-hour fields are no longer campaign controls.
            daysOfWeek = emptySet(), startTime = null, endTime = null,
        )
        val scheduler = ScheduleEngine()
        val start = requireNotNull(creative.startAt)
        val end = requireNotNull(creative.endAt)
        val eligibleIds = setOf(creative.id)
        assertNull(scheduler.next(manifest(listOf(creative)), start.minusNanos(1), 0, eligibleIds))
        assertEquals(creative.id, scheduler.next(manifest(listOf(creative)), start, 0, eligibleIds)?.id)
        assertEquals(creative.id, scheduler.next(manifest(listOf(creative)), end.minusNanos(1), 0, eligibleIds)?.id)
        assertNull(scheduler.next(manifest(listOf(creative)), end, 0, eligibleIds))
    }

    @Test fun asiaKolkataStartAndEndCalendarDatesAreInclusive() {
        val item = item("ist-window").copy(
            startAt = Instant.parse("2026-11-04T18:30:00Z"), // 2026-11-05 00:00 Asia/Kolkata
            endAt = Instant.parse("2026-11-06T18:30:00Z"), // exclusive next midnight after inclusive Nov 6
        )
        val scheduler = ScheduleEngine()
        val cached = manifest(listOf(item))
        val start = requireNotNull(item.startAt)
        val end = requireNotNull(item.endAt)
        assertNull(scheduler.next(cached, start.minusNanos(1), 0, setOf(item.id)))
        assertEquals(item.id, scheduler.next(cached, start, 0, setOf(item.id))?.id)
        assertEquals(item.id, scheduler.next(cached, end.minusNanos(1), 0, setOf(item.id))?.id)
        assertNull(scheduler.next(cached, end, 0, setOf(item.id)))
    }

    @Test fun cachedCreativeContinuesLoopingAfterPerPlayCounterIsExhaustedOnlyInOfflineMode() {
        val exhausted = item("cached-loop").copy(deliveryQuota = com.ooro.screenplayer.model.DeliveryQuota("grant", 2, 0, false))
        val cached = manifest(listOf(exhausted))
        val scheduler = ScheduleEngine()
        assertNull(scheduler.next(cached, now, 0, setOf(exhausted.id)))
        assertEquals(exhausted.id, nextVerifiedCachedItem(cached, scheduler, now, 0, setOf(exhausted.id))?.id)
        assertNull(nextVerifiedCachedItem(cached, scheduler, now.plusSeconds(2 * 86_400), 0, setOf(exhausted.id)))
        assertNull(nextVerifiedCachedItem(cached, scheduler, now, 0, emptySet()))
        assertNull(nextVerifiedCachedItem(cached, scheduler, now, 0, setOf(exhausted.id), allowExhaustedOfflineGrant = false))
    }

    @Test fun offlineLeaseFailsClosedForWrongScreenRebootRollbackMalformedOrOverlongWindow() {
        val expiry = now.plusSeconds(900)
        val lease = issueOfflineAuthorization("screen-test", now.minusSeconds(1), expiry, now, 10_000L, 3)
        assertEquals(0L, offlineAuthorizationRemainingMillis(lease, "other-screen", 11_000L, 3))
        assertEquals(0L, offlineAuthorizationRemainingMillis(lease, "screen-test", 11_000L, 4))
        assertEquals(0L, offlineAuthorizationRemainingMillis(lease, "screen-test", 9_999L, 3))
        assertNull(issueOfflineAuthorization("screen-test", null, expiry, now, 10_000L, 3))
        assertNull(issueOfflineAuthorization("screen-test", now, expiry, null, 10_000L, 3))
        assertNull(issueOfflineAuthorization("screen-test", now, now.plusSeconds(3_600), now, 10_000L, 3))
    }

    @Test fun authenticatedServerTimeRollbackCannotRenewAnOfflineLease() {
        val earlier = now.minusSeconds(2).toEpochMilli()
        assertTrue(serverTimeDoesNotRollback(earlier, now.toEpochMilli()))
        assertFalse(serverTimeDoesNotRollback(now.toEpochMilli(), earlier))
    }

    @Test fun consecutiveManifestResponsesAreComparedWithMonotonicExpectedTime() {
        val expected = expectedAuthenticatedServerTimeUtcMillis(10_000L, 1_000L, 7, 3_000L, 7)
        assertEquals(12_000L, expected)
        assertEquals(25L, authenticatedTimeDeltaMillis(expected, 12_025L))
        assertTrue(12_025L >= requireNotNull(expected))
    }

    @Test fun smallServerClockSkewIsDetectedAgainstRequestStartExpectation() {
        val previous = 10_000L
        val expected = expectedAuthenticatedServerTimeUtcMillis(previous, 1_000L, 7, 3_000L, 7)
        val slightlyBehind = 11_999L
        assertTrue(serverTimeDoesNotRollback(previous, slightlyBehind))
        assertEquals(-1L, authenticatedTimeDeltaMillis(expected, slightlyBehind))
        assertFalse(slightlyBehind >= requireNotNull(expected))
    }

    @Test fun actualAuthenticatedServerTimeRollbackIsRejected() {
        val previous = 12_000L
        val expected = expectedAuthenticatedServerTimeUtcMillis(previous, 1_000L, 7, 3_000L, 7)
        val rolledBack = 10_000L
        assertEquals(-4_000L, authenticatedTimeDeltaMillis(expected, rolledBack))
        assertFalse(serverTimeDoesNotRollback(previous, rolledBack))
    }

    @Test fun rebootRecoveryUsesFreshAuthenticatedTimeWithoutOldBootElapsedClock() {
        val previous = 10_000L
        val expected = expectedAuthenticatedServerTimeUtcMillis(previous, 90_000L, 7, 500L, 8)
        assertEquals(previous, expected)
        assertTrue(serverTimeDoesNotRollback(expected, 10_001L))
        assertEquals(0L, offlineAuthorizationRemainingMillis(
            OfflineAuthorization("screen-test", 90_000L, 7, 300_000L, previous),
            "screen-test", 500L, 8,
        ))
    }

    @Test fun missingOrMalformedAuthenticatedTimeNeverCreatesAnAuthorization() {
        val expiry = now.plusSeconds(600)
        assertNull(issueOfflineAuthorization("screen-test", now, expiry, null, 1_000L, 9))
        val malformed = runCatching { java.time.Instant.parse("not-a-time") }.getOrNull()
        assertNull(issueOfflineAuthorization("screen-test", now, expiry, malformed, 1_000L, 9))
    }

    @Test fun eligibilityMessageNamesMissingQuotaInsteadOfCampaignSchedule() {
        val noGrant = manifest(listOf(item("legacy").copy(deliveryQuota = null)))
        val message = offlineEmptyMessage(noGrant, now, setOf("legacy"))
        assertTrue(message.contains("no per-screen delivery quota"))
        assertFalse(message.contains("schedule"))
    }

    @Test fun sponsoredOfflineAssetRequiresV3GrantImageAndVerifiedChecksum() {
        val sponsor = item("sponsor").copy(startAt = now.minusSeconds(5), endAt = now.plusSeconds(50))
        val v3 = manifest(emptyList()).copy(layout = DisplayLayout.FOUR_ZONE, layoutContractVersion = 3, sponsoredItem = sponsor)
        assertEquals("sponsor", eligibleSponsoredItem(v3, now, setOf("sponsor"))?.id)
        assertNull(eligibleSponsoredItem(v3, now, emptySet()))
        assertEquals("sponsor", eligibleSponsoredItem(v3.copy(validUntil = now), now, setOf("sponsor"))?.id)
        assertNull(eligibleSponsoredItem(v3, now.plusSeconds(50), setOf("sponsor")))
        assertNull(eligibleSponsoredItem(v3.copy(sponsoredItem = sponsor.copy(deliveryQuota = sponsor.deliveryQuota?.copy(remainingPlays = 0))), now, setOf("sponsor")))
        assertNull(eligibleSponsoredItem(v3.copy(layoutContractVersion = 2), now, setOf("sponsor")))
        assertNull(eligibleSponsoredItem(v3.copy(sponsoredItem = sponsor.copy(type = CreativeType.VIDEO)), now, setOf("sponsor")))
    }

    @Test fun manifestRefreshIsScheduledTwoMinutesBeforeTheServerLeaseExpires() {
        assertEquals(13 * 60_000L, manifestRefreshDelayMillis(now.plusSeconds(15 * 60L), now))
        assertEquals(0L, manifestRefreshDelayMillis(now.plusSeconds(60), now))
        assertNull(manifestRefreshDelayMillis(now, now))
        assertNull(manifestRefreshDelayMillis(null, now))
    }

    @Test fun onlineManifestUpdateChecksAreSpacedThreeMinutesApart() {
        assertTrue(shouldPollForManifestUpdate(1_000L, 0L))
        assertFalse(shouldPollForManifestUpdate(180_999L, 1_000L))
        assertTrue(shouldPollForManifestUpdate(181_000L, 1_000L))
    }

    @Test fun campaignDateMetadataGatesPlaybackAtInclusiveDateBoundaries() {
        val scheduled = item("starts-soon").copy(startAt = now.plusSeconds(300), endAt = now.minusSeconds(1))
        assertNull(nextVerifiedCachedItem(manifest(listOf(scheduled)), ScheduleEngine(), now, 0, setOf(scheduled.id)))
        assertNull(nextVerifiedCachedItem(manifest(listOf(scheduled)), ScheduleEngine(), now.plusSeconds(3600), 0, setOf(scheduled.id)))
    }

    @Test fun staleColdStartClockCanSelectCachedCampaignAfterSystemTimeCorrection() {
        val correctedTime = Instant.parse("2026-11-17T16:00:00Z")
        val campaign = item("active-after-time-sync").copy(startAt = correctedTime.minusSeconds(60), endAt = correctedTime.plusSeconds(3_600))
        val cached = manifest(listOf(campaign), correctedTime.plusSeconds(900))
        val staleClock = correctedTime.minusSeconds(459L * 24 * 60 * 60)
        assertNull(nextVerifiedCachedItem(cached, ScheduleEngine(), staleClock, 0, setOf(campaign.id)))
        assertEquals(campaign.id, nextVerifiedCachedItem(cached, ScheduleEngine(), correctedTime, 0, setOf(campaign.id))?.id)
        assertEquals(60_000L, scheduleReevaluationDelayMillis(cached, correctedTime))
    }

    @Test fun manifestReconnectBackoffIsBoundedAndExponential() {
        assertEquals(2_000L, syncRetryDelayMillis(1, 0))
        assertEquals(4_999L, syncRetryDelayMillis(2, 999))
        assertEquals(256_999L, syncRetryDelayMillis(8, 999))
        assertEquals(256_999L, syncRetryDelayMillis(20, 999))
    }

    @Test fun networkRecoveryRefreshIsThrottledForThirtySecondsUsingElapsedTime() {
        assertTrue(shouldRefreshAfterNetworkRecovery(1_000L, 0L))
        assertFalse(shouldRefreshAfterNetworkRecovery(30_999L, 1_000L))
        assertTrue(shouldRefreshAfterNetworkRecovery(31_000L, 1_000L))
    }

    @Test fun campaignEndDateStopsPlaybackAtExclusiveNextMidnight() {
        val item = item("allocated-slot").copy(startAt = now.minusSeconds(60), endAt = now.plusSeconds(600))
        val refreshed = manifest(listOf(item), now.plusSeconds(900))
        assertTrue(manifestIsAuthorizedAt(refreshed, now.plusSeconds(599)))
        assertNull(nextVerifiedManifestItem(refreshed, ScheduleEngine(), now.plusSeconds(600), 0, setOf(item.id)))
        assertNull(nextVerifiedManifestItem(refreshed, ScheduleEngine(), now.plusSeconds(86_400), 0, setOf(item.id)))
    }

    @Test fun missingRefreshExpiryDoesNotGatePreviouslyAcceptedCachedStateGrant() {
        val cached = manifest(listOf(item("a")), null)
        assertFalse(manifestIsAuthorizedAt(cached, now))
        assertFalse(canCommitManifestResponse(cached, 1, 1, now))
        assertEquals("a", nextVerifiedCachedItem(cached, ScheduleEngine(), now, 0, setOf("a"))?.id)
    }

    @Test fun playlistTransitionsOnlyAcrossVerifiedScheduledItems() {
        val list = manifest(listOf(item("a"), item("b"), item("c")))
        val scheduler = ScheduleEngine()
        val verified = setOf("a", "c")
        assertEquals("a", nextVerifiedManifestItem(list, scheduler, now, 0, verified)?.id)
        assertEquals("c", nextVerifiedManifestItem(list, scheduler, now, 1, verified)?.id)
        assertEquals("a", nextVerifiedManifestItem(list, scheduler, now, 2, verified)?.id)
    }

    @Test fun legacyPacingMetadataDoesNotGateStateAndQuotaEligibleDelivery() {
        val paced = item("paced", priority = 1, intervalSeconds = 600.0)
        val scheduler = ScheduleEngine()
        assertEquals("paced", nextVerifiedManifestItem(manifest(listOf(paced)), scheduler, now, 0, setOf("paced"))?.id)
        scheduler.recordStarted(paced, now)
        assertEquals("paced", nextVerifiedManifestItem(manifest(listOf(paced)), scheduler, now.plusSeconds(20), 0, setOf("paced"))?.id)
    }

    @Test fun unavailableEmergencyCreativeDoesNotFallThroughToLowerPriorityAd() {
        val low = item("low", priority = 10)
        val emergency = item("emergency", priority = 1000)
        assertNull(nextVerifiedManifestItem(manifest(listOf(low, emergency)), ScheduleEngine(), now, 0, setOf("low")))
    }

    @Test fun cleanupKeepsNewPlaylistAndCurrentlyPlayingAsset() {
        assertEquals(setOf("new", "old-playing"), retainedAssetIds(setOf("new"), "old-playing"))
        assertEquals(setOf("new"), retainedAssetIds(setOf("new"), null))
    }

    @Test fun storagePressureCannotCommitManifestWithMissingAsset() {
        assertFalse(canCommitDownloadedManifest(requiredCount = 3, verifiedCount = 2))
        assertNull(nextVerifiedManifestItem(manifest(listOf(item("a"))), ScheduleEngine(), now, 0, emptySet()))
    }

    @Test fun noPreviouslyCachedCreativeShowsEmptyContentState() {
        assertNull(nextVerifiedManifestItem(manifest(emptyList()), ScheduleEngine(), now, 0, emptySet()))
        assertNull(nextVerifiedManifestItem(manifest(listOf(item("not-cached"))), ScheduleEngine(), now, 0, emptySet()))
    }

    @Test fun emptyPlayerMessageExplainsMissingOrUnavailableAdsWithoutPromisingAutomaticResume() {
        val emptyServerManifest = manifest(emptyList())
        assertTrue(offlineEmptyMessage(emptyServerManifest, now, emptySet()).contains("No delivery is authorized for this screen"))
        assertTrue(offlineEmptyMessage(manifest(listOf(item("a"))), now, emptySet()).contains("No verified ads are cached"))
        assertTrue(offlineEmptyMessage(manifest(listOf(item("a").copy(deliveryQuota = com.ooro.screenplayer.model.DeliveryQuota("g", 1, 0, false)))), now, setOf("a")).contains("quota is exhausted"))
        assertTrue(offlineEmptyMessage(manifest(listOf(item("a").copy(deliveryQuota = null))), now, setOf("a")).contains("per-screen delivery quota"))
        assertFalse(offlineEmptyMessage(manifest(listOf(item("a")), now), now, emptySet(), allowExpiredCachedManifest = true).contains("campaign schedule"))
    }

    @Test fun onlineManifestTimeoutIsReportedAsSyncFailureInsteadOfMissingCampaign() {
        val fallback = DeviceManifest(0, "screen-test", "Asia/Kolkata", emptyList(), null)
        val failure = manifestSyncFailureMessage(DeviceApiException(DeviceFailureKind.TIMEOUT, endpoint = "/api/device/manifest"), networkValidated = true)
        val message = offlineEmptyMessage(fallback, now, emptySet(), networkValidated = true, syncFailure = failure, trustedTimeAvailable = false)
        assertTrue(message.contains("OORO API request timed out"))
        assertTrue(message.contains("No verified ads are cached"))
        assertTrue(message.contains("Trusted schedule time must be re-established"))
        assertFalse(message.contains("sync an approved campaign"))
    }

    @Test fun unvalidatedNetworkDiagnosticDoesNotFabricateAnHttpResult() {
        val failure = manifestSyncFailureMessage(null, networkValidated = false)
        val attempt = LastManifestAttemptDiagnostic(
            attemptedAtMillis = 1_795_328_149_822L,
            clientRequestId = "client-req-1",
            androidNetworkValidated = false,
            failureClass = "NETWORK_NOT_VALIDATED",
            failureStage = "NETWORK_GATE",
        )
        assertTrue(failure.contains("Internet connectivity is not validated"))
        assertEquals(false, attempt.androidNetworkValidated)
        assertEquals("NETWORK_NOT_VALIDATED", attempt.failureClass)
        assertEquals("NETWORK_GATE", attempt.failureStage)
        assertEquals(null, attempt.httpStatus)
        assertEquals(null, attempt.requestId)
    }

    @Test fun actualDnsFailureTakesPriorityOverAndroidUnvalidatedNotice() {
        val message = manifestSyncFailureMessage(
            DeviceApiException(DeviceFailureKind.DNS_ERROR, endpoint = "/api/device/manifest"),
            networkValidated = false,
        )
        assertTrue(message.contains("DNS lookup failed"))
        assertFalse(message.contains("Waiting for a usable network"))
    }

    @Test fun dnsTlsAndAuthenticationFailuresHaveDistinctMessages() {
        assertTrue(manifestSyncFailureMessage(DeviceApiException(DeviceFailureKind.DNS_ERROR, endpoint = "/api/device/manifest"), true).contains("DNS lookup failed"))
        assertTrue(manifestSyncFailureMessage(DeviceApiException(DeviceFailureKind.TLS_ERROR, endpoint = "/api/device/manifest"), true).contains("HTTPS connection"))
        assertTrue(manifestSyncFailureMessage(DeviceApiException(DeviceFailureKind.AUTH_INVALID, status = 401, endpoint = "/api/device/manifest"), true).contains("rejected this screen's authentication"))
    }

    @Test fun emptyManifestReportsDeliveryEligibilityRatherThanNetworkFailure() {
        val empty = manifest(emptyList()).copy(deliveryReasons = listOf("NO_ASSIGNMENT"))
        assertEquals("No campaign is assigned to this screen.", offlineEmptyMessage(empty, now, emptySet()))
    }

    @Test fun corruptOrMissingManifestAssetIsReportedWithoutMarkingItVerified() {
        val failure = manifestSyncFailureMessage(IllegalStateException("required assets are unavailable"), networkValidated = true)
        assertTrue(failure.contains("asset download or checksum verification failed"))
        assertFalse("broken", isVerifiedCachedAsset(File("/not/a/verified/asset"), "a".repeat(64)))
    }

    @Test fun authenticatedManifestRequestDoesNotWaitForUnauthenticatedHealthProbe() = runBlocking {
        var healthCalls = 0
        var manifestCalls = 0
        val response = manifest(listOf(item("server-approved")))
        val api = object : DeviceApi by com.ooro.screenplayer.api.MockDeviceApi() {
            override suspend fun health() { healthCalls++; error("health probe timeout") }
            override suspend fun manifest(credentials: DeviceCredentials, correlationId: String?): DeviceManifest { manifestCalls++; return response }
        }
        assertEquals(response, fetchAuthenticatedManifest(api, DeviceCredentials("device", "screen-test", "workspace", "redacted-test-only", "Screen")))
        assertEquals("health probe must not gate auth", 0, healthCalls)
        assertEquals(1, manifestCalls)
    }

    @Test fun cachedStartupSelectsVerifiedAuthorizedCreativeForThePairedScreenWithoutNetwork() {
        val playlist = manifest(listOf(item("cached")))
        val resolution = resolveCachedStartup(playlist, "screen-test", setOf("cached"), ScheduleEngine(), now)
        assertEquals(CachedStartupBlock.NONE, resolution.block)
        assertEquals("cached", resolution.firstItem?.id)
        assertEquals(playlist, resolution.manifest)
    }

    @Test fun cachedStartupFailsClosedForExpiredOrWrongScreenManifest() {
        val playlist = manifest(listOf(item("cached")))
        val expired = resolveCachedStartup(playlist.copy(validUntil = now), "screen-test", setOf("cached"), ScheduleEngine(), now)
        assertEquals(CachedStartupBlock.NONE, expired.block)
        assertEquals("cached", expired.firstItem?.id)
        val wrongScreen = resolveCachedStartup(playlist, "different-screen", setOf("cached"), ScheduleEngine(), now)
        assertEquals(CachedStartupBlock.SCREEN_ID_MISMATCH, wrongScreen.block)
        assertNull(wrongScreen.manifest)
        assertNull(wrongScreen.firstItem)
    }

    @Test fun cachedStartupContinuesPreviouslyAcceptedScheduledCreativeAfterManifestLeaseExpires() {
        val scheduled = item("cached").copy(
            startAt = now.minusSeconds(60),
            endAt = now.plusSeconds(60 * 60 * 24),
        )
        val expiredLease = manifest(listOf(scheduled), now.minusSeconds(1))
        val resolution = resolveCachedStartup(
            expiredLease,
            "screen-test",
            setOf("cached"),
            ScheduleEngine(),
            now,
            allowExpiredForOfflinePlayback = true,
        )
        assertEquals(CachedStartupBlock.NONE, resolution.block)
        assertEquals("cached", resolution.firstItem?.id)
        assertEquals("cached", nextVerifiedManifestItem(expiredLease, ScheduleEngine(), now, 0, setOf("cached"))?.id)
        assertEquals("cached", nextVerifiedCachedItem(expiredLease, ScheduleEngine(), now, 0, setOf("cached"))?.id)
    }

    @Test fun cachedCreativeStopsWhenInclusiveCampaignDateWindowEnds() {
        val item = item("ten-hour").copy(
            startAt = now.minusSeconds(60),
            endAt = now.plusSeconds(24 * 60 * 60),
        )
        val issued = manifest(listOf(item), validUntil = now.plusSeconds(15 * 60))
        val afterTenHours = now.plusSeconds(10 * 60 * 60)
        assertEquals(item.id, nextVerifiedManifestItem(issued, ScheduleEngine(), afterTenHours, 0, setOf(item.id))?.id)
        assertEquals(item.id, nextVerifiedCachedItem(issued, ScheduleEngine(), afterTenHours, 0, setOf(item.id))?.id)
        assertNull(nextVerifiedCachedItem(issued, ScheduleEngine(), now.plusSeconds(24 * 60 * 60), 0, setOf(item.id)))
    }

    @Test fun offlineCachedPlaybackHonorsCampaignEndDateAndScreenIdentity() {
        val ended = item("ended").copy(endAt = now.minusSeconds(1))
        val expiredLease = manifest(listOf(ended), now.minusSeconds(1))
        val endedResolution = resolveCachedStartup(expiredLease, "screen-test", setOf("ended"), ScheduleEngine(), now, allowExpiredForOfflinePlayback = true)
        assertEquals(CachedStartupBlock.NO_ELIGIBLE_VERIFIED_ASSET, endedResolution.block)
        val wrongScreen = resolveCachedStartup(expiredLease, "different-screen", setOf("ended"), ScheduleEngine(), now, allowExpiredForOfflinePlayback = true)
        assertEquals(CachedStartupBlock.SCREEN_ID_MISMATCH, wrongScreen.block)
        assertNull(wrongScreen.firstItem)
    }

    @Test fun cachedStartupDistinguishesUnpairedAndNoManifestStates() {
        assertEquals(CachedStartupBlock.NO_MANIFEST, resolveCachedStartup(null, "screen-test", emptySet(), ScheduleEngine(), now).block)
        assertEquals(CachedStartupBlock.UNPAIRED, resolveCachedStartup(manifest(listOf(item("cached"))), null, setOf("cached"), ScheduleEngine(), now).block)
    }

    @Test fun cachedStartupSkipsMissingOrCorruptAssetsAndDoesNotCreateProofs() {
        val playlist = manifest(listOf(item("missing"), item("corrupt")))
        val resolution = resolveCachedStartup(playlist, "screen-test", emptySet(), ScheduleEngine(), now)
        assertEquals(CachedStartupBlock.NO_ELIGIBLE_VERIFIED_ASSET, resolution.block)
        assertNull(resolution.firstItem)
        // This resolver is selection-only; proof creation belongs to observed playback completion.
        assertTrue(acknowledgedProofEventIds(emptySet(), emptySet()).isEmpty())
    }

    @Test fun proofAcknowledgementDeletesOnlyStableSelectedIds() {
        val selected = setOf("event-a", "event-b")
        assertEquals(setOf("event-a"), acknowledgedProofEventIds(selected, setOf("event-a", "unselected-event")))
        assertTrue(acknowledgedProofEventIds(selected, emptySet()).isEmpty())
    }

    @Test fun offlineProofRowsRemainEligibleForRetryUntilAcknowledged() {
        assertTrue(com.ooro.screenplayer.sync.shouldRetryProofBatch(selectedCount = 2, acknowledgedCount = 0))
        assertTrue(com.ooro.screenplayer.sync.shouldRetryProofBatch(selectedCount = 2, acknowledgedCount = 1))
        assertFalse(com.ooro.screenplayer.sync.shouldRetryProofBatch(selectedCount = 2, acknowledgedCount = 2))
    }

    @Test fun duplicateProofEventIdsRemainStableAcrossReconciliationRetries() {
        val eventId = "stable-event-123"
        assertEquals(setOf(eventId), acknowledgedProofEventIds(setOf(eventId), setOf(eventId)))
        assertEquals(setOf(eventId), acknowledgedProofEventIds(setOf(eventId), setOf(eventId)))
    }
}
