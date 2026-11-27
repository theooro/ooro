package com.ooro.screenplayer

import android.os.Build
import androidx.test.uiautomator.UiDevice
import org.junit.Assume.assumeTrue

/** Keep UI fixtures and permission-mutating tests off physical signage boards. */
internal fun assumeDisposableEmulator() {
    assumeTrue(
        "This instrumentation test must run on a disposable emulator",
        Build.FINGERPRINT.contains("generic", ignoreCase = true) ||
            Build.MODEL.contains("emulator", ignoreCase = true) ||
            Build.PRODUCT.startsWith("sdk_", ignoreCase = true) ||
            Build.DEVICE.startsWith("emu", ignoreCase = true),
    )
}

/** Prevent Android's first immersive-mode education overlay from covering UI acceptance fixtures. */
internal fun prepareDisposableEmulatorUi(device: UiDevice) {
    assumeDisposableEmulator()
    // A previous screenshot fixture may have failed between `wm size` and its
    // cleanup. Normalize disposable AVDs before each fixture so test ordering
    // cannot leak an overridden resolution into the next renderer test.
    device.executeShellCommand("wm size reset")
    device.executeShellCommand("settings put secure immersive_mode_confirmations confirmed")
    device.waitForIdle()
}
