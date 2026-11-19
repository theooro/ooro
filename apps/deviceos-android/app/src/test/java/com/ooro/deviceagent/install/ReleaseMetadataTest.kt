package com.ooro.deviceagent.install

import com.ooro.deviceagent.model.Release
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class ReleaseMetadataTest {
    private val release = Release("release-id", "com.ooro.screenplayer", 12, "1.2.0", 26, 35, "a".repeat(64), "b".repeat(64), 1024)

    @Test fun acceptsValidAssignedReleaseMetadata() {
        validateReleaseMetadata(release, deviceSdk = 29, installedVersionCode = 11)
        validateReleaseMetadata(release, ApkArchiveMetadata(release.packageName, 12, "1.2.0", 26, 35, "b".repeat(64)), deviceSdk = 29, installedVersionCode = 11)
    }

    @Test fun rejectsInvalidReleaseAndArchiveMetadata() {
        assertRejected("RELEASE_PACKAGE_INVALID") { validateReleaseMetadata(release.copy(packageName = "not a package"), 29) }
        assertRejected("RELEASE_VERSION_INVALID") { validateReleaseMetadata(release.copy(versionCode = 0), 29) }
        assertRejected("RELEASE_VERSION_INVALID") { validateReleaseMetadata(release.copy(versionName = " "), 29) }
        assertRejected("RELEASE_SDK_METADATA_INVALID") { validateReleaseMetadata(release.copy(targetSdk = 25), 29) }
        assertRejected("RELEASE_SHA256_INVALID") { validateReleaseMetadata(release.copy(sha256 = "invalid"), 29) }
        assertRejected("RELEASE_CERTIFICATE_INVALID") { validateReleaseMetadata(release.copy(certificateSha256 = "invalid"), 29) }
        assertRejected("RELEASE_SIZE_INVALID") { validateReleaseMetadata(release.copy(sizeBytes = 0), 29) }
        assertRejected("APK_MIN_SDK_UNSUPPORTED") { validateReleaseMetadata(release, 25) }
        assertRejected("APK_DOWNGRADE_BLOCKED") { validateReleaseMetadata(release, 29, installedVersionCode = 13) }
        val archive = ApkArchiveMetadata(release.packageName, 12, "1.2.0", 26, 35, "b".repeat(64))
        assertRejected("APK_PACKAGE_MISMATCH") { validateReleaseMetadata(release, archive.copy(packageName = "com.attacker.app"), 29) }
        assertRejected("APK_VERSION_NAME_MISMATCH") { validateReleaseMetadata(release, archive.copy(versionName = "other"), 29) }
        assertRejected("APK_SDK_METADATA_MISMATCH") { validateReleaseMetadata(release, archive.copy(targetSdk = 34), 29) }
        assertRejected("APK_CERTIFICATE_MISMATCH") { validateReleaseMetadata(release, archive.copy(certificateSha256 = "c".repeat(64)), 29) }
    }

    private fun assertRejected(expected: String, block: () -> Unit) {
        try { block(); fail("Expected $expected") }
        catch (error: IllegalStateException) { assertEquals(expected, error.message) }
    }
}
