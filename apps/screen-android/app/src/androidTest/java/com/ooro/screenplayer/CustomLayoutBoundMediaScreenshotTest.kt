package com.ooro.screenplayer

import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CustomLayoutBoundMediaScreenshotTest {
    @Test fun legacyCustomCreativeIdBindingsAreWithheldAndBuiltInFallbackRendersWithoutProof() {
        captureLegacyBindingFallback("landscape", "legacy-bound-image-withheld.png")
    }

    @Test fun legacyCustomVideoBindingIsWithheldAndBuiltInFallbackRendersWithoutProof() {
        captureLegacyBindingFallback("video-landscape-720p", "legacy-bound-video-withheld.png")
    }

    private fun captureLegacyBindingFallback(asset: String, filename: String) {
        assumeDisposableEmulator()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val device = UiDevice.getInstance(instrumentation)
        prepareDisposableEmulatorUi(device)
        val intent = Intent(context, RenderTestActivity::class.java)
            .putExtra("scenario", "LAYOUT_STUDIO_BOUND_MEDIA")
            .putExtra("asset", asset)
            .putExtra("controls", false)
            .putExtra("qr", true)
        ActivityScenario.launch<RenderTestActivity>(intent).use {
            assertTrue("custom creative-ID contract must fall back to the built-in V3 main region", device.wait(Until.hasObject(By.desc("OoroV3Region:main-ad")), 10_000))
            assertTrue("custom creative-ID contract must not render custom-bound regions", device.findObject(By.desc("LayoutStudioZone:custom-main")) == null)
            assertTrue("built-in V3 sponsor slot remains independently rendered", device.wait(Until.hasObject(By.desc("Sponsored test advertisement")), 10_000))
            device.waitForIdle()
            val outputDir = File(context.getExternalFilesDir(null), "layout-studio-bound-media")
            assertTrue(outputDir.mkdirs() || outputDir.isDirectory)
            val output = File(outputDir, filename)
            assertTrue("Unable to capture custom media screenshot", device.takeScreenshot(output))
            assertTrue(output.length() > 0)
            instrumentation.sendStatus(0, android.os.Bundle().apply {
                putString("screenshot", output.absolutePath)
                putString("creative", asset)
                putString("proofs", "disabled")
                putString("network", "disabled")
            })
        }
    }
}
