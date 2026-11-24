package com.ooro.screenplayer.data

import android.content.Context
import android.os.Build
import com.ooro.screenplayer.model.DeviceCredentials
import java.util.UUID
import android.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec
import java.security.KeyStore
import android.util.Log
import android.database.sqlite.SQLiteAccessPermException
import android.database.sqlite.SQLiteCantOpenDatabaseException
import android.database.sqlite.SQLiteConstraintException
import android.database.sqlite.SQLiteDatabaseCorruptException
import android.database.sqlite.SQLiteDatabaseLockedException
import android.database.sqlite.SQLiteDiskIOException
import android.database.sqlite.SQLiteException
import android.database.sqlite.SQLiteFullException
import android.database.sqlite.SQLiteReadOnlyDatabaseException
import android.database.sqlite.SQLiteTableLockedException

internal interface CredentialCipherPort { fun encrypt(value: String): String; fun decrypt(value: String): String }

class DeviceStore internal constructor(context: Context, preferencesName: String, private val cipher: CredentialCipherPort) {
    constructor(context: Context) : this(context, "ooro_device", CredentialCipher())
    constructor(context: Context, preferencesName: String) : this(context, preferencesName, CredentialCipher())
    private val prefs = context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)
    val deviceId: String get() = prefs.getString("device_id", null) ?: "ooro-${UUID.randomUUID()}".also { prefs.edit().putString("device_id", it).apply() }
    fun credentials(): DeviceCredentials? = prefs.getString("token", null)?.let { encrypted -> runCatching { DeviceCredentials(prefs.getString("device_id", deviceId)!!, prefs.getString("screen_id", "")!!, prefs.getString("workspace_id", "")!!, cipher.decrypt(encrypted), prefs.getString("device_name", "OORO Screen")!!) }.onFailure { Log.w("OoroScreen", "credential read failed; treating device as unpaired") }.getOrNull() }
    fun save(credentials: DeviceCredentials) {
        val encrypted = cipher.encrypt(credentials.token)
        check(prefs.edit().putString("device_id", credentials.deviceId).putString("screen_id", credentials.screenId).putString("workspace_id", credentials.workspaceId).putString("token", encrypted).putString("device_name", credentials.name).commit()) { "credential preferences commit failed" }
        Log.i("OoroScreen", "credentials persisted displayId=${credentials.screenId} tokenPresent=${encrypted.isNotBlank()} paired=${credentials.screenId.isNotBlank()}")
    }
    fun clear() { prefs.edit().remove("screen_id").remove("workspace_id").remove("token").remove("device_name").remove("last_successful_manifest_sync").commit() }
    fun beginAuthorizationRevocation(): Boolean = prefs.edit().putBoolean(KEY_AUTHORIZATION_REVOCATION_PENDING, true).remove(KEY_AUTHORIZATION_REVOCATION_FAILURE).commit()
    fun authorizationRevocationPending(): Boolean = prefs.getBoolean(KEY_AUTHORIZATION_REVOCATION_PENDING, false)
    fun completeAuthorizationRevocation(): Boolean = prefs.edit().putBoolean(KEY_AUTHORIZATION_REVOCATION_PENDING, false).remove(KEY_AUTHORIZATION_REVOCATION_FAILURE).commit()
    fun authorizationRevocationFailure(): String? = prefs.getString(KEY_AUTHORIZATION_REVOCATION_FAILURE, null)
    internal fun recordAuthorizationRevocationFailure(error: Throwable, stage: AuthorizationCleanupStage): String {
        val safe = safeAuthorizationRevocationFailure(error, stage, safeAuthorizationFailureOrigin(error))
        prefs.edit().putString(KEY_AUTHORIZATION_REVOCATION_FAILURE, safe).commit()
        return safe
    }
    fun recordSuccessfulManifestSync(atMillis: Long = System.currentTimeMillis()) {
        check(prefs.edit().putLong("last_successful_manifest_sync", atMillis).commit()) { "manifest sync timestamp could not be persisted" }
    }
    fun lastSuccessfulManifestSyncAt(): Long? = prefs.getLong("last_successful_manifest_sync", 0L).takeIf { it > 0L }
    fun deviceInfo() = mapOf("deviceId" to deviceId, "manufacturer" to Build.MANUFACTURER, "model" to Build.MODEL, "androidVersion" to Build.VERSION.RELEASE)

    companion object {
        private const val KEY_AUTHORIZATION_REVOCATION_PENDING = "authorization_revocation_pending"
        private const val KEY_AUTHORIZATION_REVOCATION_FAILURE = "authorization_revocation_failure"
    }
}

internal enum class AuthorizationCleanupStage { ROOM_INVALIDATE, REVOCATION_MARKER_CLEAR }

internal data class AuthorizationRevocationFailure(val exceptionClass: String, val sqliteCode: Int?, val stage: AuthorizationCleanupStage, val origin: String) {
    val safeMessage get() = if (sqliteCode == null) "Authorization cleanup pending [${stage.name}] ($exceptionClass; origin=$origin)." else "Authorization cleanup pending [${stage.name}] ($exceptionClass, SQLite code $sqliteCode; origin=$origin)."
}

internal fun safeAuthorizationFailureOrigin(error: Throwable): String {
    val frame = error.stackTrace.firstOrNull {
        it.className.startsWith("androidx.room.") || it.className.startsWith("androidx.sqlite.") || it.className.startsWith("android.database.")
    } ?: error.stackTrace.firstOrNull { it.className.startsWith("com.ooro.screenplayer.data.") }
    if (frame == null) return "unknown"
    val className = frame.className.substringAfterLast('.')
    return "$className#${frame.methodName}"
}

internal fun safeAuthorizationRevocationFailure(error: Throwable, stage: AuthorizationCleanupStage, origin: String): String {
    val sqlite = generateSequence(error) { it.cause }.firstOrNull { it is SQLiteException }
    val name = (sqlite ?: error).javaClass.simpleName.takeIf { it.matches(Regex("[A-Za-z][A-Za-z0-9]{0,79}")) } ?: "UnknownDatabaseFailure"
    val code = sqlite?.let(::sqliteFailureCode)
    val safeOrigin = origin.takeIf { it.matches(Regex("[A-Za-z0-9_.$#]{1,160}")) } ?: "unknown"
    return AuthorizationRevocationFailure(name, code, stage, safeOrigin).safeMessage
}

private fun sqliteFailureCode(error: Throwable): Int? = when (error) {
    is SQLiteDatabaseLockedException -> 5
    is SQLiteTableLockedException -> 6
    is SQLiteDatabaseCorruptException -> 11
    is SQLiteFullException -> 13
    is SQLiteCantOpenDatabaseException -> 14
    is SQLiteConstraintException -> 19
    is SQLiteDiskIOException -> 10
    is SQLiteReadOnlyDatabaseException -> 8
    is SQLiteAccessPermException -> 23
    else -> Regex("\\b(?:SQLite error|code)\\s*[:=]?\\s*(\\d{1,3})\\b", RegexOption.IGNORE_CASE).find(error.message.orEmpty())?.groupValues?.getOrNull(1)?.toIntOrNull()?.takeIf { it in 0..255 }
}

private class CredentialCipher : CredentialCipherPort {
    private val alias = "ooro-device-token"
    private val key get() = (KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.getKey(alias, null) ?: KeyGenerator.getInstance("AES", "AndroidKeyStore").apply { init(android.security.keystore.KeyGenParameterSpec.Builder(alias, android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or android.security.keystore.KeyProperties.PURPOSE_DECRYPT).setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE).build()) }.generateKey())
    override fun encrypt(value: String): String = runCatching { encryptWithKey(value) }.getOrElse { error ->
        Log.w("OoroScreen", "credential key unusable; rotating local key", error)
        KeyStore.getInstance("AndroidKeyStore").apply { load(null); if (containsAlias(alias)) deleteEntry(alias) }
        encryptWithKey(value)
    }
    private fun encryptWithKey(value: String): String { val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, key); return Base64.encodeToString(c.iv + c.doFinal(value.toByteArray()), Base64.NO_WRAP) }
    override fun decrypt(value: String): String { val raw = Base64.decode(value, Base64.NO_WRAP); val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, raw.copyOfRange(0, 12))); return String(c.doFinal(raw.copyOfRange(12, raw.size))) }
}
