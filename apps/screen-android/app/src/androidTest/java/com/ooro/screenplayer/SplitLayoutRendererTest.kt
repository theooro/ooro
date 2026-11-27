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
        for (scenario in listOf("OFFER_BRAND", "OFFER_LONG_BRAND", "OFFER_LONG_TITLE", "OFFER_LONG_CTA", "OFFER_BRAND_ONLY", "OFFER_MINIMAL_FIELDS")) {
            capture("SPLIT_50_25_25", scenario)
        }
    }

    @Test fun fourZoneAndFullscreenKeepTheirGeometryAndCreativeAspectRatio() {
        listOf("OFFER_BRAND", "OFFER_LONG_BRAND", "OFFER_LONG_TITLE", "OFFER_LONG_CTA", "OFFER_BRAND_ONLY", "OFFER_MINIMAL_FIELDS")
            .forEach { capture("FOUR_ZONE", it) }
        capture("FULLSCREEN_AD", "OFFER_BRAND")
    }

    @Test fun splitLayoutNeverInventsQrForDisabledMissingOrInvalidDestination() {
        listOf("OFFER_DISABLED_QR", "OFFER_MISSING_QR", "OFFER_INVALID_QR", "OFFER_STALE_QR").forEach { scenario ->
            captureWithoutQr(scenario)
        }
    }

    private fun captureWithoutQr(scenario: String) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        assertEquals(1280, device.displayWidth); assertEquals(720, device.displayHeight); assertEquals(0, device.displayRotation)
        val intent = Intent(context, RenderTestActivity::class.java)
            .putExtra("layout", "SPLIT_50_25_25").putExtra("scenario", scenario).putExtra("asset", "landscape")
            .putExtra("controls", false).putExtra("map", false).putExtra("qr", true)
        ActivityScenario.launch<RenderTestActivity>(intent).use {
            compose.waitUntil(12_000) { compose.onAllNodesWithTag("offer-qr-error").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("offer-qr").assertDoesNotExist()
            compose.onNodeWithTag("offer-qr-error").assertTextEquals("Offer link unavailable")
            assertBounds("split-main", Rect(0f, 0f, 640f, 720f))
            assertBounds("split-navigation", Rect(640f, 0f, 960f, 720f))
            assertBounds("split-offer", Rect(960f, 0f, 1280f, 720f))
        }
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
                compose.waitUntil(10_000) {
                    compose.onAllNodesWithTag("offer-qr").fetchSemanticsNodes().isNotEmpty() ||
                        compose.onAllNodesWithTag("offer-qr-unsupported").fetchSemanticsNodes().isNotEmpty()
                }
                val hasQr = compose.onAllNodesWithTag("offer-qr").fetchSemanticsNodes().isNotEmpty() ||
                    compose.onAllNodesWithTag("offer-qr-unsupported").fetchSemanticsNodes().isNotEmpty()
                assertTrue("offer QR must render or report an unsupported size", hasQr)
                val panel = if (layout == "SPLIT_50_25_25") Rect(960f, 0f, 1280f, 720f) else Rect(1024f, 0f, 1280f, 360f)
                val tags = mutableListOf("offer-ooro-brand", "offer-brand", "offer-headline")
                if (layout == "SPLIT_50_25_25" && scenario != "OFFER_BRAND_ONLY" && scenario != "OFFER_MINIMAL_FIELDS") tags.add("offer-copy")
                if (scenario != "OFFER_MINIMAL_FIELDS") tags.add("offer-value")
                if (compose.onAllNodesWithTag("offer-qr").fetchSemanticsNodes().isNotEmpty()) tags.addAll(listOf("offer-qr", "offer-cta"))
                else tags.add("offer-qr-unsupported")
                tags.add("offer-support")
                var bottom = panel.top
                tags.forEach { tag ->
                    val node = compose.onNodeWithTag(tag)
                    assertTrue("$layout / $scenario is missing expected card node $tag", compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty())
                    val bounds = node.fetchSemanticsNode().boundsInRoot
                    assertTrue("$layout / $scenario $tag is clipped or has no visible bounds: $bounds", bounds.width > 0 && bounds.height > 0)
                    assertTrue("$tag escaped $panel: $bounds", panel.contains(bounds.topLeft) && bounds.right <= panel.right && bounds.bottom <= panel.bottom)
                    assertTrue("$tag overlaps preceding content", bounds.top >= bottom - 1f)
                    bottom = bounds.bottom
                    if (tag != "offer-qr") {
                        val results = mutableListOf<TextLayoutResult>()
                        node.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(results) }
                        val text = results.single()
                        assertTrue("$tag has clipped line box", text.getLineBottom(text.lineCount - 1) <= bounds.height + 1f)
                        assertTrue(text.lineCount <= if (layout == "SPLIT_50_25_25") 3 else 2)
                    }
                }
                compose.onNodeWithTag("offer-ooro-brand").assertTextEquals("OORO")
                if (scenario == "OFFER_BRAND") {
                    compose.onNodeWithTag("offer-brand").assertTextEquals("SYNTHETIC TEST BRAND")
                    compose.onNodeWithTag("offer-headline").assertTextEquals("Find your next favourite")
                    compose.onNodeWithTag("offer-value").assertTextEquals("10% OFF")
                    if (layout == "SPLIT_50_25_25") {
                        compose.onNodeWithTag("offer-copy").assertTextEquals("Try something made for you")
                        compose.onNodeWithTag("offer-cta").assertTextEquals("SCAN TO GET 10% OFF")
                        compose.onNodeWithTag("offer-support").assertTextEquals("Open camera • Scan • Explore")
                    }
                }
                if (scenario == "OFFER_MINIMAL_FIELDS") {
                    compose.onNodeWithTag("offer-brand").assertTextEquals("A local favourite")
                    compose.onNodeWithTag("offer-headline").assertTextEquals("Find your next favourite")
                    if (compose.onAllNodesWithTag("offer-qr").fetchSemanticsNodes().isNotEmpty()) {
                        compose.onNodeWithTag("offer-cta").assertTextEquals("SCAN TO EXPLORE")
                    }
                }
                if (layout == "SPLIT_50_25_25") {
                    assertTrue("CTA pill must be prominent green", isOfferGreen(compose.onRoot().captureToImage().asAndroidBitmap(), compose.onNodeWithTag("offer-cta-pill").fetchSemanticsNode().boundsInRoot))
                    val qr = compose.onNodeWithTag("offer-qr").fetchSemanticsNode().boundsInRoot
                    assertEquals("QR must stay square", qr.width, qr.height, 1f)
                    // The quarter-width zone is exactly 320 physical px. At MBOX density,
                    // the pale card and quiet zone leave a ~225 px square symbol; decoding
                    // the full-resolution screenshot below is the scanability acceptance.
                    assertTrue("split QR must preserve a large square in its 320px zone: $qr", qr.width >= 220f)
                    val screenshot = compose.onRoot().captureToImage().asAndroidBitmap()
                    val qrScreenshot = Bitmap.createBitmap(screenshot, qr.left.toInt(), qr.top.toInt(), qr.width.toInt(), qr.height.toInt())
                    assertQr(qrScreenshot, qrDestination(scenario))
                } else if (compose.onAllNodesWithTag("offer-qr-unsupported").fetchSemanticsNodes().isNotEmpty()) {
                    compose.onNodeWithTag("offer-qr-unsupported").assertTextEquals("Use split 50/25/25 for QR")
                } else {
                    val qr = compose.onNodeWithTag("offer-qr").fetchSemanticsNode().boundsInRoot
                    assertEquals("QR must stay square", qr.width, qr.height, 1f)
                    assertTrue("four-zone QR below supported minimum", qr.width >= 160f)
                    val screenshot = compose.onRoot().captureToImage().asAndroidBitmap()
                    assertQr(Bitmap.createBitmap(screenshot, qr.left.toInt(), qr.top.toInt(), qr.width.toInt(), qr.height.toInt()), qrDestination(scenario))
                }
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
        assertEquals(path, decoded.text)
    }

    private fun qrDestination(scenario: String): String = when (scenario) {
        "OFFER_LONG_BRAND" -> "https://theooro.com/go/bcdefghijklmnopqrstuvwxyzABCDEFG"
        "OFFER_LONG_TITLE" -> "https://theooro.com/go/cdefghijklmnopqrstuvwxyzABCDEFGH"
        "OFFER_LONG_CTA" -> "https://theooro.com/go/defghijklmnopqrstuvwxyzABCDEFGHI"
        "OFFER_BRAND_ONLY" -> "https://theooro.com/go/efghijklmnopqrstuvwxyzABCDEFGHIJ"
        else -> "https://theooro.com/go/abcdefghijklmnopqrstuvwxyzABCDEF"
    }

    private fun isOfferGreen(bitmap: Bitmap, bounds: Rect): Boolean {
        val x = (bounds.left + 3f).toInt().coerceIn(0, bitmap.width - 1)
        val y = bounds.center.y.toInt().coerceIn(0, bitmap.height - 1)
        val color = bitmap.getPixel(x, y)
        return android.graphics.Color.green(color) > android.graphics.Color.red(color) * 1.25f && android.graphics.Color.green(color) > 70
    }
}
