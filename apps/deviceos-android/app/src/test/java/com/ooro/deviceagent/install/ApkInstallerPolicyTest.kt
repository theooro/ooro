package com.ooro.deviceagent.install

import android.content.pm.PackageInstaller
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import com.ooro.deviceagent.model.Release
import com.ooro.deviceagent.network.validateDownloadedArtifact
import com.ooro.deviceagent.network.requireValidHttpsDownloadUrl
import com.ooro.deviceagent.sync.silentInstallCapability
import java.io.File

class ApkInstallerPolicyTest {
    @Test
    fun pendingUserActionIsDurableAndNotReportedAsSuccess() {
        assertEquals("PENDING_USER_ACTION", installerCallbackState(PackageInstaller.STATUS_PENDING_USER_ACTION))
    }

    @Test
    fun packageInstallerSuccessIsSeparateFromHealth() {
        assertEquals("INSTALLED", installerCallbackState(PackageInstaller.STATUS_SUCCESS))
        assertEquals("FAILED", installerCallbackState(PackageInstaller.STATUS_FAILURE))
    }

    @Test
    fun rejectsIncompatibleOrIncompleteSignedReleaseMetadata() {
        val release = release()
        validateReleaseMetadata(release, 29)
        assertFails("APK_MIN_SDK_UNSUPPORTED") { validateReleaseMetadata(release.copy(minSdk = 35), 29) }
        assertFails("RELEASE_SIGNING_IDENTITY_INVALID") { validateReleaseMetadata(release.copy(certificateSha256 = ""), 29) }
        assertFails("RELEASE_SHA256_INVALID") { validateReleaseMetadata(release.copy(sha256 = "abc"), 29) }
    }

    @Test
    fun rejectsArtifactPackageVersionAndSigningIdentityMismatch() {
        val release = release()
        validateApkArtifactMetadata(release.packageName, release.versionCode, release.certificateSha256, release)
        assertFails("APK_PACKAGE_MISMATCH") { validateApkArtifactMetadata("com.other.app", release.versionCode, release.certificateSha256, release) }
        assertFails("APK_VERSION_MISMATCH") { validateApkArtifactMetadata(release.packageName, release.versionCode + 1, release.certificateSha256, release) }
        assertFails("APK_CERTIFICATE_MISMATCH") { validateApkArtifactMetadata(release.packageName, release.versionCode, "0".repeat(64), release) }
        validateInstalledSigner(release.certificateSha256, release)
        assertFails("APK_INSTALLED_SIGNER_MISMATCH") { validateInstalledSigner("0".repeat(64), release) }
        assertFails("APK_INSTALLED_SIGNER_UNVERIFIED") { validateInstalledSigner(null, release) }
    }

    @Test
    fun checksumAndSizeMustMatchBeforePromotingStagedApk() {
        val apk = File.createTempFile("ooro-release", ".apk")
        try {
            apk.writeText("signed apk bytes")
            val checksum = com.ooro.deviceagent.network.sha256(apk)
            validateDownloadedArtifact(apk, apk.length(), checksum)
            assertFails("APK_SIZE_MISMATCH") { validateDownloadedArtifact(apk, apk.length() + 1, checksum) }
            assertFails("APK_SHA256_MISMATCH") { validateDownloadedArtifact(apk, apk.length(), "0".repeat(64)) }
            assertFails("RELEASE_SHA256_INVALID") { validateDownloadedArtifact(apk, apk.length(), "unsigned") }
        } finally {
            apk.delete()
        }
    }

    @Test
    fun downloadMustRemainHttpsAndCannotEmbedCredentials() {
        requireValidHttpsDownloadUrl("https://storage.example.test/signed.apk?signature=abc")
        assertFails("DOWNLOAD_URL_NOT_APPROVED_HTTPS") { requireValidHttpsDownloadUrl("http://storage.example.test/signed.apk") }
        assertFails("DOWNLOAD_URL_NOT_APPROVED_HTTPS") { requireValidHttpsDownloadUrl("https://user:secret@storage.example.test/signed.apk") }
    }

    @Test
    fun unconfirmedDeviceOwnerMustUseOperatorMediatedInstallResult() {
        org.junit.Assert.assertNull(silentInstallCapability(deviceOwnerConfirmed = false))
        assertTrue(silentInstallCapability(deviceOwnerConfirmed = true))
        assertEquals("PENDING_USER_ACTION", installerCallbackState(PackageInstaller.STATUS_PENDING_USER_ACTION))
    }

    private fun release() = Release("88888888-8888-4888-8888-888888888888", "com.ooro.screenplayer", 2, "0.2.0", 26, 35,
        "a".repeat(64), "b".repeat(64), 1024)

    private fun assertFails(code: String, block: () -> Unit) {
        val error = try { block(); null } catch (failure: IllegalStateException) { failure }
        org.junit.Assert.assertEquals(code, error?.message)
    }
}
