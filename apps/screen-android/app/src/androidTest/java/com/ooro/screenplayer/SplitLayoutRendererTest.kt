package com.ooro.screenplayer

import android.content.Intent
import android.graphics.Bitmap
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.google.zxing.*
import com.google.zxing.common.HybridBinarizer
import java.io.File
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Local synthetic preview only: no pairing, manifest requests, settings overrides or proof writes. */
@RunWith(AndroidJUnit4::class)
class SplitLayoutRendererTest {
    @get:Rule val compose = createEmptyComposeRule()

    @Test fun splitOfferFitsLongCopyAndQrDecodesAt1280x720() {
        for (scenario in listOf("OFFER_BRAND", "OFFER_LONG_BRAND", "OFFER_LONG_TITLE", "OFFER_LONG_CTA", "OFFER_BRAND_ONLY")) {
            capture("SPLIT_50_25_25", scenario)
        }
    }

    @Test fun fourZoneAndFullscreenKeepTheirGeometryAndCreativeAspectRatio() {
        capture("FOUR_ZONE", "OFFER_LONG_TITLE")
        capture("FULLSCREEN_AD", "OFFER_BRAND")
    }

    private fun capture(layout: String, scenario: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val device = UiDevice.getInstance(instrumentation)
        // Fail explicitly on another hardware profile; never change a fleet display's settings.
        assertEquals(1280, device.displayWidth)
        assertEquals(720, device.displayHeight)
        assertEquals("Natural landscape must remain upright", 0, device.displayRotation)
        val intent = Intent(context, RenderTestActivity::class.java)
            .putExtra("layout", layout).putExtra("scenario", scenario).putExtra("asset", "landscape")
            .putExtra("controls", false).putExtra("map", false).putExtra("qr", true)
        ActivityScenario.launch<RenderTestActivity>(intent).use {
            compose.waitUntil(15_000) { compose.onAllNodesWithContentDescription("OORO creative").fetchSemanticsNodes().isNotEmpty() }
            val creative = compose.onNodeWithContentDescription("OORO creative").fetchSemanticsNode().boundsInRoot
            if (layout == "SPLIT_50_25_25") {
                assertBounds("split-main", Rect(0f, 0f, 640f, 720f))
                assertBounds("split-navigation", Rect(640f, 0f, 960f, 720f))
                assertBounds("split-offer", Rect(960f, 0f, 1280f, 720f))
                assertEquals(640f, creative.width, 1f)
            } else if (layout == "FOUR_ZONE") {
                assertEquals(1024f, creative.width, 1f)
                assertEquals(612f, creative.height, 1f)
            } else {
                assertEquals(Rect(0f, 0f, 1280f, 720f), creative)
                compose.onNodeWithTag("offer-qr").assertDoesNotExist()
            }
            if (layout != "FULLSCREEN_AD") {
                compose.waitUntil(10_000) { compose.onAllNodesWithTag("offer-qr").fetchSemanticsNodes().isNotEmpty() }
                val panel = if (layout == "SPLIT_50_25_25") Rect(960f, 0f, 1280f, 720f) else Rect(1024f, 0f, 1280f, 360f)
                val tags = if (scenario == "OFFER_BRAND_ONLY") listOf("offer-brand", "offer-qr", "offer-cta") else listOf("offer-brand", "offer-copy", "offer-qr", "offer-cta")
                var bottom = panel.top
                tags.forEach { tag ->
                    val node = compose.onNodeWithTag(tag)
                    node.assertIsDisplayed()
                    val bounds = node.fetchSemanticsNode().boundsInRoot
                    assertTrue("$tag escaped $panel: $bounds", panel.contains(bounds.topLeft) && bounds.right <= panel.right && bounds.bottom <= panel.bottom)
                    assertTrue("$tag overlaps preceding content", bounds.top >= bottom - 1f)
                    bottom = bounds.bottom
                    if (tag != "offer-qr") {
                        val results = mutableListOf<TextLayoutResult>()
                        node.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(results) }
                        val text = results.single()
                        assertTrue("$tag has clipped line box", text.getLineBottom(text.lineCount - 1) <= bounds.height + 1f)
                        assertTrue(text.lineCount <= if (tag == "offer-copy" && layout == "SPLIT_50_25_25") 3 else 2)
                    }
                }
                val qr = compose.onNodeWithTag("offer-qr").fetchSemanticsNode().boundsInRoot
                assertEquals("QR must stay square", qr.width, qr.height, 1f)
                assertTrue("QR too small for this certified profile", qr.width >= if (layout == "SPLIT_50_25_25") 260f else 160f)
                val qrBitmap = compose.onNodeWithTag("offer-qr").captureToImage().asAndroidBitmap()
                assertQr(qrBitmap, when (scenario) {
                    "OFFER_LONG_BRAND" -> "long-brand"
                    "OFFER_LONG_TITLE" -> "long-title"
                    "OFFER_LONG_CTA" -> "long-cta"
                    "OFFER_BRAND_ONLY" -> "brand-only"
                    else -> "offer"
                })
            }
            val screenshot = compose.onRoot().captureToImage().asAndroidBitmap()
            assertEquals(1280, screenshot.width); assertEquals(720, screenshot.height)
            // The cyan fixture frame must survive FIT on every edge of the 16:9 creative.
            // Checking the contained frame also catches sideways or stretched image rendering.
            val fittedHeight = creative.width * 9f / 16f
            val top = creative.top + (creative.height - fittedHeight) / 2
            fun cyan(x: Int, y: Int) {
                val pixel = screenshot.getPixel(x, y)
                assertTrue("creative frame cropped or rotated at $x,$y", android.graphics.Color.green(pixel) > 180 && android.graphics.Color.blue(pixel) > 180 && android.graphics.Color.red(pixel) < 80)
            }
            val frameInset = creative.width * 10f / 1920f
            cyan((creative.left + creative.width / 2).toInt(), (top + frameInset).toInt())
            cyan((creative.left + creative.width / 2).toInt(), (top + fittedHeight - frameInset).toInt())
            cyan((creative.left + frameInset).toInt(), (top + fittedHeight / 2).toInt())
            cyan((creative.right - frameInset).toInt(), (top + fittedHeight / 2).toInt())
            val directory = File(context.getExternalFilesDir(null), "split-renderer-screenshots").apply { mkdirs() }
            File(directory, "$layout-$scenario.png").outputStream().use { output -> screenshot.compress(Bitmap.CompressFormat.PNG, 100, output) }
        }
    }

    private fun assertBounds(tag: String, expected: Rect) {
        assertEquals(expected, compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot)
    }

    private fun assertQr(bitmap: Bitmap, path: String) {
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        for (inset in 0..3) for (i in inset until bitmap.width - inset) {
            assertEquals("QR quiet zone top", -1, bitmap.getPixel(i, inset))
            assertEquals("QR quiet zone bottom", -1, bitmap.getPixel(i, bitmap.height - 1 - inset))
            assertEquals("QR quiet zone left", -1, bitmap.getPixel(inset, i))
            assertEquals("QR quiet zone right", -1, bitmap.getPixel(bitmap.width - 1 - inset, i))
        }
        val decoded = MultiFormatReader().decode(BinaryBitmap(HybridBinarizer(RGBLuminanceSource(bitmap.width, bitmap.height, pixels))))
        assertEquals("https://example.invalid/$path", decoded.text)
    }
}
