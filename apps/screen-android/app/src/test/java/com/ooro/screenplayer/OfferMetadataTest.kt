package com.ooro.screenplayer

import com.ooro.screenplayer.model.OfferMetadata
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OfferMetadataTest {
    private val validTrackingUrl = "https://theooro.com/go/abcdefghijklmnopqrstuvwxyzABCDEF"

    @Test fun acceptsOnlyEnabledCanonicalPublicTrackingQr() {
        assertEquals(validTrackingUrl, OfferMetadata(qrUrl = " $validTrackingUrl ", qrEnabled = true).consumerQrUrl)
        assertNull(OfferMetadata(qrUrl = validTrackingUrl, qrEnabled = false).consumerQrUrl)
    }

    @Test fun missingDisabledAndInvalidQrNeverFallsBackToCta() {
        assertNull(OfferMetadata(ctaUrl = validTrackingUrl).consumerQrUrl)
        assertNull(OfferMetadata(qrUrl = validTrackingUrl).consumerQrUrl)
        assertNull(OfferMetadata(qrUrl = validTrackingUrl, qrEnabled = false, ctaUrl = validTrackingUrl).consumerQrUrl)
        assertNull(OfferMetadata(qrUrl = "javascript:alert(1)", qrEnabled = true, ctaUrl = validTrackingUrl).consumerQrUrl)
        assertNull(OfferMetadata(qrUrl = "https://merchant.example/offer", qrEnabled = true).consumerQrUrl)
    }

    @Test fun apiAndStagingDestinationsAreNeverQrPayloads() {
        listOf("https://api.theooro.com/go/abcdefghijklmnopqrstuvwxyzABCDEF", "https://api-staging.theooro.com/go/abcdefghijklmnopqrstuvwxyzABCDEF", "https://staging.theooro.com/go/abcdefghijklmnopqrstuvwxyzABCDEF")
            .forEach { assertNull("accepted forbidden QR destination", OfferMetadata(qrUrl = it, qrEnabled = true).consumerQrUrl) }
    }
}
