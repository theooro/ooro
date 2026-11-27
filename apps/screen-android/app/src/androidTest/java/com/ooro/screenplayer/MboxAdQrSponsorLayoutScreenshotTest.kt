package com.ooro.screenplayer

import android.content.Intent
import android.graphics.BitmapFactory
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.google.zxing.BinaryBitmap
import com.google.zxing.MultiFormatReader
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class MboxAdQrSponsorLayoutScreenshotTest {
    private val destination = "https://theooro.com/go/abcdefghijklmnopqrstuvwxyzABCDEF"

    @Test fun rendersThreeZonesAndDecodableQrAt1280x720() {
        assumeDisposableEmulator()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val device = UiDevice.getInstance(instrumentation)
        prepareDisposableEmulatorUi(device)
        val oldWidth = device.displayWidth
        val oldHeight = device.displayHeight
        try {
            device.executeShellCommand("wm size 1280x720")
            android.os.SystemClock.sleep(700)
            val context = instrumentation.targetContext
            val intent = Intent(context, RenderTestActivity::class.java)
                .putExtra("scenario", "MBOX_AD_QR_SPONSOR")
                .putExtra("layout", "MBOX_AD_QR_SPONSOR_V1")
                .putExtra("controls", false)
                .putExtra("map", true)
                .putExtra("ticker", true)
                .putExtra("qr", true)
            ActivityScenario.launch<RenderTestActivity>(intent).use {
                assertTrue("main ad zone missing", device.wait(Until.hasObject(By.desc("MboxAdQrSponsorRegion:main-ad")), 10_000))
                assertTrue("QR offer zone missing", device.wait(Until.hasObject(By.desc("MboxAdQrSponsorRegion:qr-offer")), 10_000))
                assertTrue("sponsored zone missing", device.wait(Until.hasObject(By.desc("MboxAdQrSponsorRegion:sponsored-ad")), 10_000))
                assertTrue("the layout must not render a navigation map", device.findObject(By.textContains("Map unavailable")) == null)
                assertTrue("the layout must not expose a navigation zone", device.findObject(By.desc("OoroV3Region:navigation")) == null)
                val main = requireNotNull(device.findObject(By.desc("MboxAdQrSponsorRegion:main-ad"))?.visibleBounds)
                val qrZone = requireNotNull(device.findObject(By.desc("MboxAdQrSponsorRegion:qr-offer"))?.visibleBounds)
                val sponsor = requireNotNull(device.findObject(By.desc("MboxAdQrSponsorRegion:sponsored-ad"))?.visibleBounds)
                assertBounds(main.left, main.top, main.right, main.bottom, 0, 0, 832, 720)
                assertBounds(qrZone.left, qrZone.top, qrZone.right, qrZone.bottom, 832, 0, 1280, 540)
                assertBounds(sponsor.left, sponsor.top, sponsor.right, sponsor.bottom, 832, 540, 1280, 720)
                assertTrue("QR should be visible at the supported profile", device.wait(Until.hasObject(By.desc("Brand offer QR code")), 10_000))
                val qr = requireNotNull(device.findObject(By.desc("Brand offer QR code"))?.visibleBounds)
                assertTrue("QR must remain square", kotlin.math.abs(qr.width() - qr.height()) <= 2)
                assertTrue("QR must meet the minimum scan size", qr.width() >= 170)
                device.waitForIdle()
                val outputDir = File(context.getExternalFilesDir(null), "mbox-ad-qr-screenshots")
                assertTrue(outputDir.mkdirs() || outputDir.isDirectory)
                val screenshot = File(outputDir, "mbox-ad-qr-sponsor-1280x720.png")
                assertTrue("screenshot capture failed", device.takeScreenshot(screenshot))
                val bitmap = BitmapFactory.decodeFile(screenshot.absolutePath)
                val pixels = IntArray(bitmap.width * bitmap.height)
                bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
                val decoded = MultiFormatReader().decode(BinaryBitmap(HybridBinarizer(RGBLuminanceSource(bitmap.width, bitmap.height, pixels))))
                assertEquals(destination, decoded.text)
                instrumentation.sendStatus(0, android.os.Bundle().apply { putString("scenario", "MBOX_AD_QR_SPONSOR"); putString("screenshot", screenshot.absolutePath); putString("decodedQr", decoded.text) })
            }
        } finally {
            device.executeShellCommand("wm size ${oldWidth}x${oldHeight}")
            android.os.SystemClock.sleep(500)
        }
    }

    @Test fun blocksThePresetAtSmallerResolutionWithAnExplicitReason() {
        assumeDisposableEmulator()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val device = UiDevice.getInstance(instrumentation)
        prepareDisposableEmulatorUi(device)
        val intent = Intent(instrumentation.targetContext, RenderTestActivity::class.java)
            .putExtra("scenario", "MBOX_AD_QR_SPONSOR")
            .putExtra("layout", "MBOX_AD_QR_SPONSOR_V1")
            .putExtra("controls", false)
            .putExtra("qr", true)
            .putExtra("renderWindowWidthPx", 854)
            .putExtra("renderWindowHeightPx", 480)
        ActivityScenario.launch<RenderTestActivity>(intent).use {
            assertTrue("unsupported resolution must explain the scan-size limitation", device.wait(Until.hasObject(By.textContains("needs at least 1280×720 pixels")), 10_000))
            assertTrue("unsupported screen must not partially render the layout", device.findObject(By.desc("MboxAdQrSponsorRegion:main-ad")) == null)
            assertTrue("unsupported screen must not render a QR", device.findObject(By.desc("Brand offer QR code")) == null)
        }
    }

    private fun assertBounds(left: Int, top: Int, right: Int, bottom: Int, expectedLeft: Int, expectedTop: Int, expectedRight: Int, expectedBottom: Int) {
        assertTrue("left bound $left != $expectedLeft", kotlin.math.abs(left - expectedLeft) <= 2)
        assertTrue("top bound $top != $expectedTop", kotlin.math.abs(top - expectedTop) <= 2)
        assertTrue("right bound $right != $expectedRight", kotlin.math.abs(right - expectedRight) <= 2)
        assertTrue("bottom bound $bottom != $expectedBottom", kotlin.math.abs(bottom - expectedBottom) <= 2)
    }
}
