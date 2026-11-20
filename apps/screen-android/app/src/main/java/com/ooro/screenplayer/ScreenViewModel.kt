package com.ooro.screenplayer

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.room.withTransaction
import com.ooro.screenplayer.api.*
import com.ooro.screenplayer.data.*
import com.ooro.screenplayer.model.*
import com.ooro.screenplayer.player.AssetManager
import com.ooro.screenplayer.player.ScheduleEngine
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.random.Random
import com.ooro.screenplayer.repository.ProofOfPlayRepository
import com.ooro.screenplayer.player.ProofPolicy
import com.ooro.screenplayer.player.PlaybackStateTracker
import com.ooro.screenplayer.sync.CommandProcessor
import com.ooro.screenplayer.sync.RESTART_RESUME_EXTRA
import com.ooro.screenplayer.sync.ProofSyncScheduler
import android.util.Log
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Network
import android.os.SystemClock
import android.provider.Settings
import com.ooro.screenplayer.location.LocationReporter
import com.ooro.screenplayer.location.LocationSnapshot
import java.time.Instant

sealed interface ScreenState { data object Preparing : ScreenState; data class Setup(val message: String? = null, val repair: Boolean = false) : ScreenState; data class AuthRecovery(val kind: DeviceFailureKind, val message: String, val reconnecting: Boolean = false, val cachedManifest: DeviceManifest? = null) : ScreenState; data class Player(val manifest: DeviceManifest) : ScreenState; data class Admin(val manifest: DeviceManifest?) : ScreenState }
internal fun shouldEnqueueProofSync(pendingProofCount: Int): Boolean = pendingProofCount > 0

class ScreenViewModel(private val context: Context, private val store: DeviceStore, private val api: DeviceApi, private val db: OoroDatabase, private val assets: AssetManager) : ViewModel() {
    private val _pairedScreenId = MutableStateFlow(store.credentials()?.screenId)
    val pairedScreenId: StateFlow<String?> = _pairedScreenId
    private val _state = MutableStateFlow<ScreenState>(if (store.credentials() == null) ScreenState.Setup() else ScreenState.Preparing)
    val state: StateFlow<ScreenState> = _state
    private val _diagnostic = MutableStateFlow("Not synced yet")
    val diagnostic: StateFlow<String> = _diagnostic
    private val _diagnostics = MutableStateFlow(DiagnosticsState())
    val diagnostics: StateFlow<DiagnosticsState> = _diagnostics
    private val _reconnecting = MutableStateFlow(false)
    val reconnecting: StateFlow<Boolean> = _reconnecting
    private val _pairing = MutableStateFlow(false)
    val pairing: StateFlow<Boolean> = _pairing
    val deviceId get() = store.deviceId
    val isPaired get() = store.credentials() != null
    val screenId get() = store.credentials()?.screenId ?: "—"
    val manifestVersion get() = active?.version?.toString() ?: "—"
    fun refreshLocationPermission() {
        val granted = androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED || androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_COARSE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (granted) location.start() else location.stop()
        _location.value = location.current()
        if (_location.value == null && granted) _diagnostic.value = "Location fix unavailable · playback is unaffected"
        else if (!granted) _diagnostic.value = "Location permission unavailable for live screen tracking · playback is unaffected"
    }
    var online = false; private set
    private var active: DeviceManifest? = null
    private val scheduler = ScheduleEngine(); private val proof = ProofOfPlayRepository(db); private val playback = PlaybackStateTracker(); private val session get() = playback.current
    private var playbackPositionMs: Long? = null
    private val location = LocationReporter(context)
    private val _location = MutableStateFlow<LocationSnapshot?>(null)
    val latestLocation: StateFlow<LocationSnapshot?> = _location
    private val _navigation = MutableStateFlow(NavigationState())
    val navigation: StateFlow<NavigationState> = _navigation
    private val _mapTilesRendered = MutableStateFlow(false)
    val mapTilesRendered: StateFlow<Boolean> = _mapTilesRendered
    private val _mapTileError = MutableStateFlow<String?>(null)
    val mapTileError: StateFlow<String?> = _mapTileError
    private val _currentCreative = MutableStateFlow<ManifestItem?>(null)
    val currentCreative: StateFlow<ManifestItem?> = _currentCreative
    private val _cachedPlaybackAllowed = MutableStateFlow(false)
    /** True while the last committed manifest is being used as the offline fallback. */
    val cachedPlaybackAllowed: StateFlow<Boolean> = _cachedPlaybackAllowed
    private val _authorizationValid = MutableStateFlow(false)
    val authorizationValid: StateFlow<Boolean> = _authorizationValid.asStateFlow()
    private val _playbackOffset = MutableStateFlow(0)
    val playbackOffset: StateFlow<Int> = _playbackOffset
    private val _scheduleClock = MutableStateFlow(Instant.EPOCH)
    val scheduleClock: StateFlow<Instant> = _scheduleClock.asStateFlow()
    private val _verifiedAssetIds = MutableStateFlow<Set<String>>(emptySet())
    val verifiedAssetIds: StateFlow<Set<String>> = _verifiedAssetIds
    private var reconnectJob: Job? = null
    private var manifestRefreshJob: Job? = null
    private var authorizationExpiryJob: Job? = null
    private var activeAuthorization: OfflineAuthorization? = null
    private var trustedTimeFailureMessage: String? = null
    private var technicianSnapshotJob: Job? = null
    private var reconnectAttempt = 0
    private var lastNetworkRecoveryAt = 0L
    @Volatile private var networkRecoveryReady = false
    private val connectivityManager = context.getSystemService(ConnectivityManager::class.java)
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onLost(network: Network) {
            _cachedPlaybackAllowed.value = currentOfflineAuthorizationRemainingMillis() > 0L
        }
        override fun onAvailable(network: Network) {
            if (!isValidated(network)) return
            recoverNetworkNow()
        }
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
            if (capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) recoverNetworkNow()
        }
    }
    private fun recoverNetworkNow() {
            val now = SystemClock.elapsedRealtime()
            if (!networkRecoveryReady || !shouldRefreshAfterNetworkRecovery(now, lastNetworkRecoveryAt) || store.credentials() == null) return
            lastNetworkRecoveryAt = now
            reconnectJob?.cancel()
            reconnectJob = null
            sync()
    }
    private fun isValidated(network: Network): Boolean = runCatching { connectivityManager?.getNetworkCapabilities(network)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true }.getOrDefault(false)
    @Volatile private var repairMode = false
    private val syncMutex = Mutex()
    // The first network heartbeat can fail immediately after a reboot. Do not
    // let that failure publish an empty fallback playlist before Room and the
    // verified asset cache have been restored.
    private val cachedStartupReady = CompletableDeferred<Unit>()
    init {
        runCatching { connectivityManager?.registerDefaultNetworkCallback(networkCallback) }
        location.start()
        viewModelScope.launch {
            cachedStartupReady.await()
            while (true) {
                _scheduleClock.value = trustedScheduleTime(activeAuthorization, store.credentials()?.screenId, SystemClock.elapsedRealtime(), currentBootCount()) ?: Instant.EPOCH
                delay(1_000L)
            }
        }
        viewModelScope.launch {
            cachedStartupReady.await()
            while (true) {
                val fix = location.current()
                _location.value = fix
                _navigation.value = _navigation.value.copy(
                    currentLatitude = fix?.latitude,
                    currentLongitude = fix?.longitude,
                    updatedAt = fix?.occurredAt?.let(Instant::ofEpochMilli),
                )
                if (repairMode) { delay(BuildConfig.SYNC_INTERVAL_SECONDS * 1_000L); continue }
                val credentials = store.credentials()
                if (credentials != null) {
                    val current = session
                    runCatching {
                        api.heartbeat(credentials, if (current != null) PlayerStatus.PLAYING else PlayerStatus.READY,
                            db.manifestDao().active()?.version ?: 0,
                            withDeviceHealth(HeartbeatTelemetry(fix, current?.campaignId, current?.creativeId, current?.assetId,
                                current?.let { "PLAYING" } ?: "IDLE", current?.startedAt,
                                if (current != null) playbackPositionMs else null, current?.expectedDurationMs)))
                    }.onSuccess {
                        if (online) {
                            reconnectAttempt = 0
                            reconnectJob?.cancel()
                            reconnectJob = null
                        }
                        viewModelScope.launch {
                            if (shouldEnqueueProofSync(db.proofDao().pendingCount())) ProofSyncScheduler.enqueue(context, "heartbeat-with-pending-proofs")
                        }
                    }.onFailure { error ->
                        persistDiagnosticError(error)
                        if (error is DeviceApiException && error.kind.requiresRepair()) showRecovery(error)
                        else { keepCachedPlayback(); scheduleReconnect() }
                    }
                    runCatching { CommandProcessor(context, api, store).poll() }
                    delay(BuildConfig.SYNC_INTERVAL_SECONDS * 1_000L)
                } else delay(90_000)
            }
        }
        // Keep playback local and uninterrupted. Check the server for a newer
        // approved manifest every three minutes only while Android reports
        // validated internet; connectivity recovery still triggers an immediate sync.
        viewModelScope.launch {
            cachedStartupReady.await()
            var lastManifestUpdateCheck = SystemClock.elapsedRealtime()
            while (true) {
                delay(MANIFEST_UPDATE_POLL_INTERVAL_MILLIS)
                val now = SystemClock.elapsedRealtime()
                if (shouldPollForManifestUpdate(now, lastManifestUpdateCheck)) {
                    lastManifestUpdateCheck = now
                    if (store.credentials() != null && hasValidatedInternet()) {
                        Log.i("OoroScreen", "periodic manifest update check started intervalMs=$MANIFEST_UPDATE_POLL_INTERVAL_MILLIS")
                        sync()
                    }
                }
            }
        }
        viewModelScope.launch {
            try {
                val stored = db.manifestDao().active()
                val pairedScreenId = store.credentials()?.screenId
                val parsed = stored?.let { entity -> runCatching { ManifestCodec.parse(entity.json) }.onFailure { error ->
                    Log.e("OoroScreen", "cached manifest rejected; no cached playlist will be selected", error)
                }.getOrNull() }
                val identityMatched = parsed?.takeIf { it.screenId == pairedScreenId }?.let { hydrateDeliveryQuotas(it) }
                activeAuthorization = stored?.let { entity ->
                    val received = entity.authorizationReceivedElapsedMillis
                    val boot = entity.authorizationBootCount
                    val duration = entity.authorizationDurationMillis
                    val screen = entity.authorizationScreenId
                    val serverTime = entity.authorizationServerTimeUtcMillis
                    if (received != null && boot != null && duration != null && screen != null && serverTime != null) OfflineAuthorization(screen, received, boot, duration, serverTime) else null
                }
                val leaseRemaining = currentOfflineAuthorizationRemainingMillis()
                _authorizationValid.value = leaseRemaining > 0L
                _verifiedAssetIds.value = identityMatched?.let { manifest ->
                    runCatching { assets.verifiedItemIds(manifest.items + listOfNotNull(manifest.sponsoredItem)) }.getOrDefault(emptySet())
                } ?: emptySet()
                val trustedNow = trustedScheduleTime(activeAuthorization, pairedScreenId, SystemClock.elapsedRealtime(), currentBootCount()) ?: Instant.EPOCH
                _scheduleClock.value = trustedNow
                val startup = resolveCachedStartup(identityMatched, pairedScreenId, _verifiedAssetIds.value, scheduler, trustedNow, allowExpiredForOfflinePlayback = leaseRemaining > 0L)
                active = startup.manifest
                _cachedPlaybackAllowed.value = startup.manifest != null && startup.manifest.screenId == pairedScreenId && leaseRemaining > 0L
                scheduleAuthorizationExpiry()
                _diagnostics.value = _diagnostics.value.copy(manifestLastSyncAt = lastManifestSyncAt(context))
                Log.i("OoroScreen", "offline startup resolved paired=${pairedScreenId != null} manifestPresent=${parsed != null} manifestVersion=${parsed?.version ?: -1} itemCount=${parsed?.items?.size ?: 0} verifiedAssetCount=${_verifiedAssetIds.value.size} result=${startup.block}")
                if (startup.block == CachedStartupBlock.SCREEN_ID_MISMATCH) {
                    Log.w("OoroScreen", "cached manifest identity does not match paired screen; cached playlist withheld")
                }
                active?.let { cached ->
                    if (pairedScreenId != null) {
                        _state.value = ScreenState.Player(cached)
                        if (startup.block == CachedStartupBlock.NONE && leaseRemaining > 0L) {
                            _diagnostic.value = "Playing authorized cached delivery · refreshing manifest when connected"
                            scheduleManifestRefresh(cached)
                        } else if (leaseRemaining <= 0L) _diagnostic.value = "Trusted time unavailable — device reboot detected, reconnect to establish secure schedule time."
                        else if (startup.block == CachedStartupBlock.NO_ELIGIBLE_VERIFIED_ASSET) _diagnostic.value = offlineEmptyMessage(cached, Instant.now(), _verifiedAssetIds.value)
                    }
                }
            } catch (error: Exception) {
                Log.e("OoroScreen", "cached startup restore failed; playlist unavailable", error)
                _diagnostic.value = "Cached content could not be verified · reconnect to refresh approved content"
            } finally {
                // Network work, including the heartbeat loop, is allowed only
                // after persisted authorization and local checksums are resolved.
                cachedStartupReady.complete(Unit)
            }
            networkRecoveryReady = true
            if (store.credentials() != null) sync()
            ManifestRefreshBus.events.collect { sync() }
        }
    }
    fun pair(rawCode: String) { if (_pairing.value) return; val code = rawCode.trim().uppercase(); if (code.isBlank()) { _state.value = ScreenState.Setup("Enter a pairing code", true); return }; _pairing.value = true; viewModelScope.launch { try { runCatching { api.health(); val result = api.pair(PairRequest(code,deviceId,android.os.Build.MANUFACTURER,android.os.Build.MODEL,android.os.Build.VERSION.RELEASE,BuildConfig.VERSION_NAME)); store.save(result.credentials); _pairedScreenId.value = result.credentials.screenId; repairMode = false; Log.i("OoroScreen", "pairing succeeded displayId=${result.credentials.screenId} tokenPresent=${result.credentials.token.isNotBlank()} paired=true"); sync() }.onFailure { error -> Log.e("OoroScreen", "pairing failed displayId=$deviceId", error); val message = if (error is DeviceApiException) recoveryMessage(error.kind) else "Pairing failed. Check the code and network connection."; _state.value = ScreenState.Setup(message, true) } } finally { _pairing.value = false } } }
    fun reconnect() { if (_reconnecting.value) return; _reconnecting.value = true; val current = (_state.value as? ScreenState.AuthRecovery); if (current != null) _state.value = current.copy(reconnecting = true); viewModelScope.launch { try { sync() } finally { _reconnecting.value = false } } }
    fun beginRepair() { repairMode = true; _state.value = ScreenState.Setup("Enter a new pairing code. This keeps the existing screen identity and history.", true) }
    fun onActivityResumed(commandId: String?) {
        if (commandId.isNullOrBlank()) return
        viewModelScope.launch { runCatching { CommandProcessor(context, api, store).confirmRestartResumed(commandId) } }
    }
    fun onDeviceClockChanged(action: String?) {
        // Time and timezone changes are audit/telemetry facts only. Delivery uses
        // the authenticated campaign state and the remaining device quota.
        Log.i("OoroScreen", "device time metadata changed action=${action ?: "unknown"}; campaign delivery eligibility unchanged")
    }
    fun sync() { viewModelScope.launch { cachedStartupReady.await(); syncMutex.withLock { syncInternal() } } }
    private fun hasValidatedInternet(): Boolean = runCatching {
        val network = connectivityManager?.activeNetwork ?: return false
        connectivityManager.getNetworkCapabilities(network)
            ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
    }.getOrDefault(false)
    private suspend fun hydrateDeliveryQuotas(manifest: DeviceManifest): DeviceManifest {
        suspend fun hydrate(item: ManifestItem): ManifestItem {
            val grant = item.deliveryQuota ?: return item
            val dao = db.deliveryQuotaDao()
            dao.mergeIncoming(DeliveryQuotaEntity(grant.id, item.campaignId, grant.revision, grant.remainingPlays, grant.unlimited))
            val persisted = dao.find(grant.id) ?: return item
            return item.copy(deliveryQuota = DeliveryQuota(persisted.grantId, persisted.revision, persisted.remainingPlays, persisted.unlimited))
        }
        return manifest.copy(items = manifest.items.map { hydrate(it) }, sponsoredItem = manifest.sponsoredItem?.let { hydrate(it) })
    }
    private suspend fun refreshPersistedQuotas() {
        val manifest = active ?: return
        val quotas = db.deliveryQuotaDao().all().associateBy { it.grantId }
        fun update(item: ManifestItem): ManifestItem {
            val grant = item.deliveryQuota ?: return item
            val stored = quotas[grant.id] ?: return item
            return item.copy(deliveryQuota = DeliveryQuota(stored.grantId, stored.revision, stored.remainingPlays, stored.unlimited))
        }
        val updated = manifest.copy(items = manifest.items.map(::update), sponsoredItem = manifest.sponsoredItem?.let(::update))
        active = updated
        if (_state.value is ScreenState.Player) _state.value = ScreenState.Player(updated)
    }
    private suspend fun syncInternal() {
        manifestRefreshJob?.cancel()
        manifestRefreshJob = null
        val c = store.credentials() ?: run { Log.w("OoroScreen", "sync skipped tokenPresent=false paired=false"); return }
        Log.w("OoroScreen", "sync started displayId=${c.screenId} tokenPresent=true paired=true")
        if (active == null) _state.value = ScreenState.Preparing

        val health = runCatching { api.health() }
        if (health.isFailure) {
            val error = health.exceptionOrNull()
            if (error != null) persistDiagnosticError(error)
            online = false
            if (currentOfflineAuthorizationRemainingMillis() <= 0L) trustedTimeFailureMessage = trustedTimeFailure(error)
            if (error is DeviceApiException && error.kind.requiresRepair()) showRecovery(error)
            else { keepCachedPlayback(c); trustedTimeFailureMessage?.let { _diagnostic.value = it }; scheduleReconnect() }
            return
        }
        // Report liveness before any manifest or asset network work. A slow or
        // unavailable creative must not make a paired display look offline.
        runCatching {
            Log.w("OoroScreen", "heartbeat sending displayId=${c.screenId} tokenPresent=true paired=true")
            api.heartbeat(c, PlayerStatus.DEGRADED, active?.version ?: db.manifestDao().active()?.version ?: 0, withDeviceHealth(HeartbeatTelemetry()))
            Log.w("OoroScreen", "heartbeat accepted displayId=${c.screenId} tokenPresent=true paired=true")
            if (shouldEnqueueProofSync(db.proofDao().pendingCount())) ProofSyncScheduler.enqueue(context, "sync-heartbeat-success")
            _diagnostic.value = "Heartbeat accepted · display ${c.screenId}"
        }.onFailure { error ->
            if (error is DeviceApiException && error.kind.requiresRepair()) { showRecovery(error); return@onFailure }
            _diagnostic.value = "Heartbeat failed · connection unavailable"
            Log.w("OoroScreen", "heartbeat failed displayId=${c.screenId} tokenPresent=true paired=true", error)
        }

        val manifestResult = runCatching {
            val incoming = api.manifest(c)
            check(incoming.screenId == c.screenId) { "manifest is assigned to a different screen" }
            val receivedElapsed = SystemClock.elapsedRealtime()
            val bootCount = currentBootCount()
            val authorization = issueOfflineAuthorization(c.screenId, incoming.generatedAt, incoming.validUntil, incoming.authenticatedServerTime, receivedElapsed, bootCount)
                ?: error("authenticated offline authorization lease is missing, expired, or invalid")
            val previousServerTime = db.manifestDao().active()?.authorizationServerTimeUtcMillis
            check(serverTimeDoesNotRollback(previousServerTime, authorization.serverTimeUtcMillis)) { "authenticated server time moved backwards; previous authorization retained" }
            val currentlyPlayingItems = active?.items.orEmpty().filter { it.id == session?.itemId }
            val required = incoming.items.filter { it.url.isNotBlank() }
            val cachedMainIds = required.mapNotNull { item -> assets.ensure(item)?.let { item.id } }.toSet()
            val sponsorCached = incoming.sponsoredItem?.let { item -> runCatching { assets.ensure(item) }.getOrNull() != null } == true
            val cachedIds = cachedMainIds + if (sponsorCached) setOfNotNull(incoming.sponsoredItem?.id) else emptySet()
            if (!canCommitDownloadedManifest(required.size, cachedMainIds.size)) error("required assets are unavailable")
            if (offlineAuthorizationRemainingMillis(authorization, c.screenId, SystemClock.elapsedRealtime(), currentBootCount()) <= 0L) error("manifest authorization expired while assets were prepared")
            val quotaHydrated = db.withTransaction {
                (incoming.items + listOfNotNull(incoming.sponsoredItem)).mapNotNull { it.deliveryQuota }.distinctBy { it.id }.forEach { quota ->
                    db.deliveryQuotaDao().mergeIncoming(DeliveryQuotaEntity(quota.id, incoming.items.firstOrNull { it.deliveryQuota?.id == quota.id }?.campaignId ?: incoming.sponsoredItem?.takeIf { it.deliveryQuota?.id == quota.id }?.campaignId.orEmpty(), quota.revision, quota.remainingPlays, quota.unlimited))
                }
                db.manifestDao().put(ManifestEntity(version=incoming.version,timezone=incoming.timezone,validUntil=incoming.validUntil?.toString(),json=ManifestCodec.encode(incoming),authorizationReceivedElapsedMillis=authorization.receivedElapsedMillis,authorizationBootCount=authorization.bootCount,authorizationDurationMillis=authorization.durationMillis,authorizationScreenId=authorization.screenId,authorizationServerTimeUtcMillis=authorization.serverTimeUtcMillis))
                hydrateDeliveryQuotas(incoming)
            }
            recordManifestSync(context)
            active=quotaHydrated
            activeAuthorization = authorization
            trustedTimeFailureMessage = null
            _scheduleClock.value = trustedScheduleTime(authorization, c.screenId, SystemClock.elapsedRealtime(), currentBootCount()) ?: Instant.EPOCH
            _authorizationValid.value = true
            _cachedPlaybackAllowed.value = false
            scheduleAuthorizationExpiry()
            _verifiedAssetIds.value = cachedIds
            val retainedItems = incoming.items + listOfNotNull(incoming.sponsoredItem) + currentlyPlayingItems
            assets.cleanup(
                retainedAssetIds(cachedIds, session?.itemId),
                retainedItems.mapNotNull { it.checksum?.takeIf { checksum -> checksum.matches(Regex("[0-9a-fA-F]{64}")) } }.toSet(),
            )
            online=true
            reconnectAttempt = 0
            reconnectJob?.cancel(); reconnectJob = null
            scheduleManifestRefresh(incoming)
            Log.w("OoroScreen", "manifest accepted displayId=${c.screenId} version=${incoming.version} items=${incoming.items.size}")
        }.onFailure { error ->
            persistDiagnosticError(error)
            online=false
            if (currentOfflineAuthorizationRemainingMillis() <= 0L) trustedTimeFailureMessage = trustedTimeFailure(error)
            if (error is DeviceApiException && error.kind.requiresRepair()) showRecovery(error) else { keepCachedPlayback(c); trustedTimeFailureMessage?.let { _diagnostic.value = it }; scheduleReconnect() }
            Log.w("OoroScreen", "manifest unavailable; using LKG/fallback displayId=${c.screenId}", error)
        }
        if (_state.value !is ScreenState.AuthRecovery) _state.value = ScreenState.Player(active ?: fallback(c))
        runCatching {
            Log.w("OoroScreen", "heartbeat sending displayId=${c.screenId} tokenPresent=true paired=true")
            val current = session
            api.heartbeat(c, if (current != null) PlayerStatus.PLAYING else if (manifestResult.isSuccess) PlayerStatus.READY else PlayerStatus.DEGRADED, active?.version ?: 0, withDeviceHealth(HeartbeatTelemetry(location.current(), current?.campaignId, current?.creativeId, current?.assetId, current?.let { "PLAYING" } ?: "IDLE", current?.startedAt, playbackPositionMs, current?.expectedDurationMs)))
            Log.w("OoroScreen", "heartbeat accepted displayId=${c.screenId} tokenPresent=true paired=true")
            _diagnostic.value = trustedTimeFailureMessage ?: if (manifestResult.isSuccess) "Manifest accepted · heartbeat accepted" else "LKG/fallback active · heartbeat accepted"
        }.onFailure { error ->
            if (error is DeviceApiException && error.kind.requiresRepair()) showRecovery(error) else _diagnostic.value = "Heartbeat failed · cached content remains active"
            Log.w("OoroScreen", "heartbeat failed displayId=${c.screenId} tokenPresent=true paired=true", error)
        }
        runCatching { CommandProcessor(context, api, store).poll() }
            .onFailure { error -> Log.w("OoroScreen", "command poll failed displayId=${c.screenId}", error) }
    }
    private fun keepCachedPlayback(credentials: DeviceCredentials? = store.credentials()) {
        val authorized = credentials != null && active != null && currentOfflineAuthorizationRemainingMillis() > 0L
        _authorizationValid.value = authorized
        _diagnostic.value = if (authorized) "Authorized cached playback active · reconnecting" else trustedTimeFailureMessage ?: "Trusted time unavailable — device reboot detected, reconnect to establish secure schedule time."
        _cachedPlaybackAllowed.value = authorized
        if (_state.value !is ScreenState.AuthRecovery && credentials != null) _state.value = ScreenState.Player(active ?: fallback(credentials))
    }
    private fun scheduleManifestRefresh(manifest: DeviceManifest) {
        manifestRefreshJob?.cancel()
        val remaining = currentOfflineAuthorizationRemainingMillis()
        if (remaining <= 0L) {
            Log.w("OoroScreen", "offline authorization lease is invalid; authenticated sync is required")
            return
        }
        val delayMillis = (remaining - MANIFEST_REFRESH_LEAD_MILLIS).coerceAtLeast(0L)
        manifestRefreshJob = viewModelScope.launch {
            Log.i("OoroScreen", "manifest refresh scheduled before monotonic authorization expiry delayMs=$delayMillis")
            if (delayMillis > 0) delay(delayMillis)
            if (store.credentials() != null && hasValidatedInternet()) {
                Log.i("OoroScreen", "manifest authorization refresh due")
                sync()
            }
        }
    }
    private fun currentBootCount(): Int? = runCatching { Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT) }.getOrNull()
    private fun currentOfflineAuthorizationRemainingMillis(): Long = offlineAuthorizationRemainingMillis(activeAuthorization, store.credentials()?.screenId, SystemClock.elapsedRealtime(), currentBootCount())
    fun isOfflineAuthorizationValid(): Boolean = currentOfflineAuthorizationRemainingMillis() > 0L
    private fun scheduleAuthorizationExpiry() {
        authorizationExpiryJob?.cancel()
        val remaining = currentOfflineAuthorizationRemainingMillis()
        if (remaining <= 0L) {
            _authorizationValid.value = false
            _cachedPlaybackAllowed.value = false
            return
        }
        authorizationExpiryJob = viewModelScope.launch {
            delay(remaining)
            if (currentOfflineAuthorizationRemainingMillis() <= 0L) {
                _cachedPlaybackAllowed.value = false
                _authorizationValid.value = false
                _diagnostic.value = "Offline authorization lease expired · reconnect to refresh delivery"
                Log.w("OoroScreen", "cached delivery withheld because the server authorization lease expired")
            }
        }
    }
    private fun scheduleReconnect() {
        if (reconnectJob?.isActive == true || store.credentials() == null) return
        reconnectJob = viewModelScope.launch {
            reconnectAttempt = (reconnectAttempt + 1).coerceAtMost(8)
            delay(syncRetryDelayMillis(reconnectAttempt, Random.nextLong(0, 1_000)))
            if (store.credentials() != null) sync()
        }
    }
    private fun showRecovery(error: DeviceApiException) { _cachedPlaybackAllowed.value = false; _diagnostic.value = recoveryMessage(error.kind); _state.value = ScreenState.AuthRecovery(error.kind, recoveryMessage(error.kind), cachedManifest = active) }
    private fun trustedTimeFailure(error: Throwable?): String {
        if (!hasValidatedInternet()) return "Trusted time unavailable: connectivity is not validated for internet access."
        val kind = (error as? DeviceApiException)?.kind
        return when (kind) {
            DeviceFailureKind.DNS_ERROR -> "Trusted time unavailable: OORO API DNS lookup failed."
            DeviceFailureKind.TLS_ERROR -> "Trusted time unavailable: HTTPS/TLS validation failed."
            DeviceFailureKind.AUTH_EXPIRED, DeviceFailureKind.AUTH_INVALID, DeviceFailureKind.AUTH_REVOKED, DeviceFailureKind.PAIRING_REQUIRED -> "Trusted time unavailable: device authentication was rejected."
            DeviceFailureKind.NETWORK_UNAVAILABLE, DeviceFailureKind.CONNECTION_REFUSED, DeviceFailureKind.TIMEOUT -> "Trusted time unavailable: OORO API connection failed."
            else -> "Trusted time unavailable: authenticated server time response was missing, invalid, expired, or moved backwards."
        }
    }
    private fun recoveryMessage(kind: DeviceFailureKind): String = when (kind) {
        DeviceFailureKind.DNS_ERROR, DeviceFailureKind.CONNECTION_REFUSED, DeviceFailureKind.TIMEOUT, DeviceFailureKind.TLS_ERROR, DeviceFailureKind.NETWORK_UNAVAILABLE -> "Unable to reach OORO. Check the network connection and try again."
        DeviceFailureKind.AUTH_EXPIRED -> "Device session expired. Reconnect to request a fresh session."
        DeviceFailureKind.AUTH_INVALID, DeviceFailureKind.AUTH_REVOKED -> "Device authentication needs to be repaired."
        DeviceFailureKind.DEVICE_NOT_FOUND -> "This device is no longer registered with OORO."
        DeviceFailureKind.PAIRING_REQUIRED -> "This device needs to be paired again."
        DeviceFailureKind.SERVER_UNAVAILABLE -> "OORO is temporarily unavailable. Please try again."
        DeviceFailureKind.REQUEST_FAILED -> "We couldn't connect this screen to OORO. Please try again."
    }

    fun currentItem(manifest: DeviceManifest, offset: Int = _playbackOffset.value, verifiedIds: Set<String> = _verifiedAssetIds.value, allowCachedOffline: Boolean = _cachedPlaybackAllowed.value, now: Instant = _scheduleClock.value): ManifestItem? {
        if (currentOfflineAuthorizationRemainingMillis() <= 0L) {
            _cachedPlaybackAllowed.value = false
            _authorizationValid.value = false
            return null
        }
        val current = manifest.items.find { it.id == session?.itemId && it.id in verifiedIds && it.isCampaignDateEligibleAt(now) }
        val emergency = manifest.items.any { it.priority >= 1000 && it.hasAuthorizedDeliveryQuota && it.isCampaignDateEligibleAt(now) }
        return current?.takeIf { !emergency || it.priority >= 1000 }
            ?: if (allowCachedOffline) nextVerifiedCachedItem(manifest, scheduler, now, offset, verifiedIds)
                else nextVerifiedManifestItem(manifest, scheduler, now, offset, verifiedIds)
    }

    fun markAssetUnavailable(itemId: String) {
        if (itemId in _verifiedAssetIds.value) {
            _verifiedAssetIds.value = _verifiedAssetIds.value - itemId
            _playbackOffset.value += 1
            Log.w("OoroScreen", "cached asset unavailable; skipping unplayable item")
        }
    }
    /** The renderer and offer panel use the same manifest item for every frame. */
    fun activatePresentation(item: ManifestItem) { if (_currentCreative.value?.id != item.id) _currentCreative.value = item }
    private val startingItems = mutableSetOf<String>()
    fun creativeStarted(item: ManifestItem) {
        if (session?.itemId == item.id || !startingItems.add(item.id)) return
        val quota = item.deliveryQuota
        if (quota == null) { startingItems.remove(item.id); _diagnostic.value = "Delivery authorization missing · waiting for an authorized manifest"; return }
        val playbackSession = PlaybackSession(java.util.UUID.randomUUID().toString(), item.id, item.campaignId, item.creativeId, item.assetId, Instant.now(), item.durationSeconds * 1000L, quota.id, quota.revision)
        viewModelScope.launch {
            try {
                if (!db.deliveryQuotaDao().consumeOnce(quota.id, quota.revision, playbackSession.eventId)) {
                    _diagnostic.value = "Authorized delivery quota exhausted · waiting for a new server grant"
                    _playbackOffset.value += 1
                    return@launch
                }
                refreshPersistedQuotas()
                if (!playback.start(playbackSession)) return@launch
                scheduler.recordStarted(item)
                _currentCreative.value = item
                playbackPositionMs = 0
                reportPlayback(item, "PLAYING")
            } finally { startingItems.remove(item.id) }
        }
    }
    fun creativePosition(item: ManifestItem, positionMs: Long) { if (session?.itemId == item.id) playbackPositionMs = positionMs.coerceAtLeast(0) }
    fun creativeFinished(item: ManifestItem, actualMs: Long, success: Boolean, reason: String? = null) { val s = playback.finish(item.id) ?: return; val accepted = success && (item.type != CreativeType.VIDEO || ProofPolicy().videoSuccess(s.expectedDurationMs, actualMs)); reportPlayback(item, if (accepted) "IDLE" else "FAILED", actualMs); playbackPositionMs = null; if (_currentCreative.value?.id == item.id) _currentCreative.value = null; _playbackOffset.value = _playbackOffset.value + 1; viewModelScope.launch { proof.record(ProofOfPlay(eventId = s.eventId, screenId = store.credentials()?.screenId ?: "", deviceId = deviceId, campaignId = s.campaignId, creativeId = s.creativeId, scheduleItemId = s.itemId, startedAt = s.startedAt, endedAt = Instant.now(), expectedDurationMs = s.expectedDurationMs, actualPlayedMs = actualMs, success = accepted, failureReason = reason ?: if (!accepted) "PLAYBACK_BELOW_COMPLETION_POLICY" else null, appVersion = BuildConfig.VERSION_NAME, assetId = s.assetId, deliveryGrantId = item.deliveryQuota?.id, deliveryQuotaRevision = item.deliveryQuota?.revision)) } }
    fun sponsoredDisplayCompleted(item: ManifestItem, displayedMs: Long) {
        val credentials = store.credentials() ?: return
        if (displayedMs < 1_000L || item.type != CreativeType.IMAGE) return
        val quota = item.deliveryQuota ?: return
        val eventId = java.util.UUID.randomUUID().toString()
        viewModelScope.launch {
            if (!db.deliveryQuotaDao().consumeOnce(quota.id, quota.revision, eventId)) {
                Log.w("OoroPlayback", "sponsored delivery withheld: authorized quota unavailable campaignId=${item.campaignId} creativeId=${item.creativeId}")
                return@launch
            }
            refreshPersistedQuotas()
            val endedAt = Instant.now()
            proof.record(ProofOfPlay(eventId = eventId, screenId = credentials.screenId, deviceId = deviceId, campaignId = item.campaignId, creativeId = item.creativeId, scheduleItemId = item.id, startedAt = endedAt.minusMillis(displayedMs), endedAt = endedAt, expectedDurationMs = item.durationSeconds * 1_000L, actualPlayedMs = displayedMs, success = true, appVersion = BuildConfig.VERSION_NAME, assetId = item.assetId, slot = "SPONSORED", deliveryGrantId = quota.id, deliveryQuotaRevision = quota.revision))
        }
    }
    fun setNavigationState(state: NavigationState) { _navigation.value = state.copy(currentLatitude = _location.value?.latitude, currentLongitude = _location.value?.longitude) }
    fun reportMapHealth(rendered: Boolean, error: String? = null) { _mapTilesRendered.value = rendered; _mapTileError.value = error }
    private fun reportPlayback(item: ManifestItem, state: String, positionMs: Long? = null) { viewModelScope.launch { store.credentials()?.let { credentials -> runCatching { api.heartbeat(credentials, if (state == "PLAYING") PlayerStatus.PLAYING else if (state == "FAILED") PlayerStatus.ERROR else PlayerStatus.READY, db.manifestDao().active()?.version ?: 0, withDeviceHealth(HeartbeatTelemetry(location.current(), item.campaignId, item.creativeId, item.assetId, state, session?.startedAt, positionMs, item.durationSeconds * 1000L))) } } } }
    suspend fun localFile(item: ManifestItem): String? = assets.ensure(item)?.absolutePath
    fun showAdmin() {
        _state.value = ScreenState.Admin(active)
        // Entering technician mode should not start an unrequested network probe.
        // Populate local cache/proof counts first; the visible Refresh action performs
        // the explicit API/heartbeat check.
        technicianSnapshotJob?.cancel()
        technicianSnapshotJob = viewModelScope.launch {
            val stored = db.manifestDao().active()
            val manifest = active ?: stored?.let { runCatching { ManifestCodec.parse(it.json) }.getOrNull() }
            val counts = manifest?.let { assets.verify(it.items) } ?: (0 to 0)
            val queued = db.proofDao().pendingCount()
            val recentErrors = db.errorDao().recent(5)
            _diagnostics.value = _diagnostics.value.copy(
                verifiedAssets = counts.first,
                missingAssets = counts.second,
                proofQueued = queued,
                recentErrors = recentErrors,
            )
        }
    }
    fun closeAdmin() {
        val credentials = store.credentials()
        _state.value = when {
            active != null -> ScreenState.Player(active!!)
            credentials != null -> ScreenState.Player(fallback(credentials))
            else -> ScreenState.Setup()
        }
    }
    fun unpair() { repairMode = false; viewModelScope.launch { store.credentials()?.let { runCatching { api.unpair(it) } }; store.clear(); _pairedScreenId.value = null; active=null; _state.value=ScreenState.Setup("Screen unpaired") } }
    fun runDiagnostics() { viewModelScope.launch {
        _diagnostics.value = _diagnostics.value.copy(running = true, message = "Running network and device checks…")
        val probe = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { probeApi(BuildConfig.API_BASE_URL) }
        var result = _diagnostics.value.copy(running = false, probe = probe, message = null)
        result = if (probe.connected) result.copy(apiLastSuccessAt = System.currentTimeMillis(), apiLastError = null) else result.copy(apiLastError = probe.error ?: "Could not connect to host")
        val credentials = store.credentials()
        result = result.copy(heartbeatLastAttemptAt = System.currentTimeMillis())
        if (credentials != null && probe.connected) {
            runCatching { api.heartbeat(credentials, PlayerStatus.DEGRADED, active?.version ?: db.manifestDao().active()?.version ?: 0, withDeviceHealth(HeartbeatTelemetry(location.current()))) }
                .onSuccess { result = result.copy(heartbeatLastSuccessAt = System.currentTimeMillis(), heartbeatStatus = probe.httpStatus, heartbeatError = null) }
                .onFailure { error -> result = result.copy(heartbeatStatus = Regex("HTTP\\s+(\\d{3})").find(error.message.orEmpty())?.groupValues?.getOrNull(1)?.toIntOrNull(), heartbeatError = sanitizeDiagnosticError(error.message)) }
        } else if (credentials == null) result = result.copy(heartbeatError = "Device is not paired")
        val stored = db.manifestDao().active()
        val manifest = active ?: stored?.let { runCatching { ManifestCodec.parse(it.json) }.getOrNull() }
        val counts = manifest?.let { assets.verify(it.items) } ?: (0 to 0)
        val queued = db.proofDao().pendingCount()
        val recentErrors = db.errorDao().recent(5)
        _diagnostics.value = result.copy(manifestLastSyncAt = stored?.let { lastManifestSyncAt(context) }, manifestLastAttemptAt = System.currentTimeMillis(), manifestError = if (manifest == null) "No cached manifest" else null, verifiedAssets = counts.first, missingAssets = counts.second, proofQueued = queued, recentErrors = recentErrors, lastDiagnosis = diagnose(probe, credentials != null, result.heartbeatStatus, result.heartbeatError, manifest, counts.second, queued))
    } }
    private fun withDeviceHealth(telemetry: HeartbeatTelemetry): HeartbeatTelemetry {
        val network = networkInfo(context)
        val storage = android.os.StatFs(context.filesDir.absolutePath)
        return telemetry.copy(networkType = network.type, networkConnected = network.internet,
            storageFree = storage.availableBytes, storageTotal = storage.blockCountLong * storage.blockSizeLong)
    }
    private fun diagnose(probe: ApiProbe, paired: Boolean, heartbeatStatus: Int?, heartbeatError: String?, manifest: DeviceManifest?, missingAssets: Int, queued: Int): String = when {
        !probe.connected && probe.failureKind == "DNS_ERROR" -> "DNS_ERROR · API host could not be resolved"
        !probe.connected && probe.failureKind == "CONNECTION_REFUSED" -> "CONNECTION_REFUSED · API is not reachable on port 8080"
        !probe.connected && probe.failureKind == "TIMEOUT" -> "TIMEOUT · API did not respond"
        !probe.connected && probe.failureKind == "TLS_ERROR" -> "TLS_ERROR · secure connection failed"
        !probe.connected && BuildConfig.API_BASE_URL.startsWith("http://") -> "Development server IP may have changed or port 8080 is unreachable"
        !probe.connected -> "OORO server cannot be reached"
        paired && heartbeatStatus == 401 -> "Device authentication expired or invalid"
        paired && heartbeatStatus != null && heartbeatStatus >= 500 -> "OORO server error"
        location.current() == null -> "Waiting for GPS signal"
        manifest != null && missingAssets > 0 -> "Creative download failed"
        queued > 0 && !probe.connected -> "Proofs waiting for connection"
        else -> "No blocking issue detected"
    }
    fun diagnosticReport(): String { val d = _diagnostics.value; val n = networkInfo(context); val l = locationDiagnostics(context); val c = store.credentials(); val stat = android.os.StatFs(context.filesDir.absolutePath); val policy = context.getSystemService(android.app.admin.DevicePolicyManager::class.java); val owner = policy.isDeviceOwnerApp(context.packageName); val activity = context.getSystemService(android.app.ActivityManager::class.java); val lockTask = activity.lockTaskModeState != android.app.ActivityManager.LOCK_TASK_MODE_NONE; val home = runCatching { android.content.Intent(android.content.Intent.ACTION_MAIN).addCategory(android.content.Intent.CATEGORY_HOME).let { intent -> context.packageManager.resolveActivity(intent, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName } }.getOrNull(); return buildString {
        appendLine("OORO DIAGNOSTIC"); appendLine("Screen ID       ${c?.screenId ?: "UNPAIRED"}"); appendLine("Device ID       $deviceId"); appendLine("App version     ${BuildConfig.VERSION_NAME}"); appendLine("Android         ${android.os.Build.VERSION.RELEASE} (API ${android.os.Build.VERSION.SDK_INT})"); appendLine("Build identity  ${android.os.Build.FINGERPRINT}"); appendLine("Device model    ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}"); appendLine("API host        ${BuildConfig.API_BASE_URL}"); appendLine("Environment     ${backendEnvironment()}"); appendLine("Mock backend    ${if (BuildConfig.USE_MOCK_BACKEND) "ON" else "OFF"}"); appendLine("Network         ${n.type} · validated internet=${n.internet}"); appendLine("Device IP       ${n.ip ?: "unavailable"}"); appendLine("API             ${if (d.probe?.connected == true) "CONNECTED" else "UNREACHABLE"}"); appendLine("Pairing         ${if (c != null) "PAIRED" else "UNPAIRED"}"); appendLine("Manifest        ${active?.let { "v${it.version} · ${it.layout.name} · contract ${it.layoutContractVersion}" } ?: "UNKNOWN"}"); appendLine("Last sync       ${relativeTime(lastManifestSyncAt(context))}"); appendLine("Assets          ${d.verifiedAssets} verified, ${d.missingAssets} missing"); appendLine("Storage         ${stat.availableBytes} free / ${stat.blockCountLong * stat.blockSizeLong} bytes"); appendLine("Playback        ${_currentCreative.value?.creativeId ?: "Unknown"}"); appendLine("Proof queue     ${d.proofQueued} waiting"); appendLine("Home app        ${home ?: "Unknown"} · OORO=${home == context.packageName}"); appendLine("Device Owner    ${if (owner) "PRESENT" else "ABSENT"}"); appendLine("Lock Task       ${if (lockTask) "ACTIVE" else "INACTIVE"}"); appendLine("GPS             ${if (l.permission && (l.gps || l.network)) "AVAILABLE" else "UNAVAILABLE"}"); appendLine("Primary issue   ${d.lastDiagnosis ?: "Not run"}"); d.recentErrors.take(5).forEachIndexed { index, error -> appendLine("Recent error ${index + 1}  $error") }
    } }
    private suspend fun persistDiagnosticError(error: Throwable) {
        val message = sanitizeDiagnosticError(error.message)
        runCatching { db.errorDao().add(ErrorEntity(message = message)); db.errorDao().prune() }
    }
    fun retryQueue() { ProofSyncScheduler.enqueue(context, "diagnostic-retry") }
    private fun fallback(c: DeviceCredentials) = DeviceManifest(0,c.screenId,BuildConfig.DEFAULT_TIMEZONE,emptyList(),null)
    override fun onCleared() { runCatching { connectivityManager?.unregisterNetworkCallback(networkCallback) }; manifestRefreshJob?.cancel(); authorizationExpiryJob?.cancel(); reconnectJob?.cancel(); location.stop(); super.onCleared() }
    companion object { fun factory(context: Context) = object: ViewModelProvider.Factory { override fun <T:ViewModel> create(type:Class<T>):T = ScreenViewModel(context,DeviceStore(context),ApiProvider(DeviceStore(context)).api,OoroDatabase.get(context),AssetManager(context)) as T } }
}

private fun DeviceFailureKind.requiresRepair() = this in setOf(DeviceFailureKind.AUTH_EXPIRED, DeviceFailureKind.AUTH_INVALID, DeviceFailureKind.AUTH_REVOKED, DeviceFailureKind.DEVICE_NOT_FOUND, DeviceFailureKind.PAIRING_REQUIRED)
