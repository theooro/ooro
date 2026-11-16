package com.ooro.deviceagent.install

import android.content.pm.PackageInstaller
import com.ooro.deviceagent.model.Release
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.Assert.fail

class ApkInstallerPolicyTest {
    private val release = Release("release-1", "com.ooro.screenplayer", 12, "1.2.0", 26, 35, "a".repeat(64), "b".repeat(64), 1024)

    @Test
    fun pendingUserActionIsDurableAndNotReportedAsSuccess() {
        assertEquals("PENDING_USER_ACTION", installerCallbackState(PackageInstaller.STATUS_PENDING_USER_ACTION))
    }

    @Test
    fun packageInstallerSuccessIsSeparateFromHealth() {
        assertEquals("INSTALLED", installerCallbackState(PackageInstaller.STATUS_SUCCESS))
        assertEquals("FAILED", installerCallbackState(PackageInstaller.STATUS_FAILURE))
    }

    @Test fun approvedArtifactMetadataMustMatchPackageVersionHashSignerSdkAndSize() {
        validateReleaseArtifact(release, release.packageName, release.versionCode, release.sha256, release.certificateSha256, 29, release.sizeBytes)
        assertRejected("APK_SIZE_MISMATCH") { validateReleaseArtifact(release, release.packageName, 12, release.sha256, release.certificateSha256, 29, 1) }
        assertRejected("APK_SHA256_MISMATCH") { validateReleaseArtifact(release, release.packageName, 12, "c".repeat(64), release.certificateSha256, 29, release.sizeBytes) }
        assertRejected("APK_MIN_SDK_UNSUPPORTED") { validateReleaseArtifact(release, release.packageName, 12, release.sha256, release.certificateSha256, 25, release.sizeBytes) }
        assertRejected("APK_PACKAGE_MISMATCH") { validateReleaseArtifact(release, "com.attacker.app", 12, release.sha256, release.certificateSha256, 29, release.sizeBytes) }
        assertRejected("APK_VERSION_MISMATCH") { validateReleaseArtifact(release, release.packageName, 11, release.sha256, release.certificateSha256, 29, release.sizeBytes) }
        assertRejected("APK_SIGNATURE_MISSING") { validateReleaseArtifact(release, release.packageName, 12, release.sha256, null, 29, release.sizeBytes) }
        assertRejected("APK_CERTIFICATE_MISMATCH") { validateReleaseArtifact(release, release.packageName, 12, release.sha256, "c".repeat(64), 29, release.sizeBytes) }
    }

    private fun assertRejected(expected: String, block: () -> Unit) {
        try { block(); fail("Expected $expected") } catch (error: IllegalStateException) { assertEquals(expected, error.message) }
    }
}
