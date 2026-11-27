package com.ooro.screenplayer.player

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.testTag
import com.ooro.screenplayer.RuntimeDiagnostics
import com.ooro.screenplayer.model.ManifestItem
import com.ooro.screenplayer.qrBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.roundToInt

private val CardInk = Color(0xFF182A27)
private val CardMuted = Color(0xFF50615C)
private val CardPale = Color(0xFFF4F4E9)
private val OfferGreen = Color(0xFF087B52)
private const val MIN_QR_SYMBOL_PIXELS = 150

/** Compact, reusable offer composition for the existing QR offer zone. */
@Composable
internal fun BrandedQrOfferCard(item: ManifestItem?, modifier: Modifier = Modifier) {
    SideEffect { RuntimeDiagnostics.increment(RuntimeDiagnostics.Counter.OFFER_COMPOSITION) }
    val offer = item?.offer
    val destination = offer?.consumerQrUrl
    val merchant = offer?.brandName?.trim()?.takeIf(String::isNotBlank) ?: "A local favourite"
    val headline = sequenceOf(offer?.offerTitle, offer?.promotionalText, offer?.offerSubtitle)
        .mapNotNull { it?.trim()?.takeIf(String::isNotBlank) }
        .firstOrNull() ?: "Find your next favourite"
    val supportingOffer = sequenceOf(offer?.promotionalText, offer?.offerSubtitle)
        .mapNotNull { it?.trim()?.takeIf(String::isNotBlank) }
        .firstOrNull { it != headline }
    val offerValue = offer?.offerValue?.trim()?.takeIf(String::isNotBlank)
    val cta = offer?.ctaLabel?.trim()?.takeIf(String::isNotBlank)
        ?: if (offerValue != null) "SCAN TO CLAIM OFFER" else "SCAN TO EXPLORE"

    BoxWithConstraints(
        modifier
            .background(CardPale)
            .clip(RoundedCornerShape(18.dp))
            .semantics {
                contentDescription = when {
                    item == null -> "OoroOfferState:fallback"
                    destination == null -> "OoroOfferState:destination-unavailable"
                    else -> "OoroOfferState:brand"
                }
            }
    ) {
        val edgeInset = if (maxWidth < 170.dp) 4.dp else 7.dp
        Surface(
            modifier = Modifier.fillMaxSize().padding(edgeInset),
            color = CardPale,
            contentColor = CardInk,
            shape = RoundedCornerShape(16.dp),
            shadowElevation = 0.dp,
            border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFD9E1D4)),
        ) {
            BoxWithConstraints(Modifier.fillMaxSize().padding(horizontal = 8.dp, vertical = 7.dp)) {
                // The legacy four-zone QR pane is only 20% of a 1280x720 canvas
                // and 50% of its height. Compact before text and CTA can crowd it.
                val compact = maxWidth < 175.dp || maxHeight < 400.dp
                val contentPadding = if (compact) 3.dp else 5.dp
                val quietPadding = if (compact) 5.dp else 7.dp
                val density = LocalDensity.current
                val contentMaxWidth = maxWidth
                val headlineLines = if (compact) 1 else 2
                val headlineLineHeight = if (compact) 16 else 19
                val supportingLines = if (compact) 1 else 2
                val supportingLineHeight = if (compact) 12 else 14
                val ctaLineHeight = if (compact) 12 else 14
                val showSupportingOffer = supportingOffer != null && !compact
                val reservedTextDp = if (compact) {
                    (19 + 1 + 11 + 2 + headlineLineHeight + (if (offerValue != null) 16 else 0) + 4 + 20 + 2 + 10 + 14).dp
                } else {
                    (22 + 4 + 16 + 4 + headlineLineHeight * headlineLines +
                        (if (showSupportingOffer) 3 + supportingLineHeight * supportingLines else 0) +
                        (if (offerValue != null) 3 + 18 else 0) + 6 + 32 + 3 + 12 + 14).dp
                }
                val qrSize = minOf(
                    maxWidth - contentPadding * 2,
                    // Compact legacy panes have shorter font metrics than the
                    // Compose text boxes consume. Reserve extra vertical slack so
                    // the CTA/support text never clips; if that leaves too little
                    // square for the QR, show the explicit unsupported-size state.
                    maxHeight - reservedTextDp - if (compact) 48.dp else 0.dp,
                ).coerceAtLeast(0.dp)
                val qrSymbolPixels = with(density) { (qrSize - quietPadding * 2).toPx().roundToInt() }
                val qrCanFit = destination != null && qrSymbolPixels >= MIN_QR_SYMBOL_PIXELS
                val qrState = produceState<Bitmap?>(null, destination, qrSymbolPixels, qrCanFit) {
                    value = null
                    if (qrCanFit && destination != null) {
                        value = withContext(Dispatchers.IO) { qrBitmap(destination, qrSymbolPixels) }
                    }
                }
                val qrImage = remember(qrState.value) { qrState.value?.asImageBitmap() }

                Column(
                    modifier = Modifier.fillMaxSize().clipToBounds(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    if (item == null) {
                        Text("OORO", color = OfferGreen, fontSize = if (compact) 20.sp else 24.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1)
                        Spacer(Modifier.height(5.dp))
                        Text("Advertise your business here", color = CardInk, fontSize = if (compact) 12.sp else 15.sp, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
                        Spacer(Modifier.height(7.dp))
                        Text("+91 7981399132", color = OfferGreen, fontSize = if (compact) 14.sp else 18.sp, fontWeight = FontWeight.Bold, maxLines = 1)
                        Spacer(Modifier.height(2.dp))
                        Text("For advertisements", color = CardMuted, fontSize = if (compact) 10.sp else 12.sp, maxLines = 1)
                    } else {
                    Text(
                        "OORO",
                        color = OfferGreen,
                        fontSize = if (compact) 17.sp else 20.sp,
                        fontWeight = FontWeight.ExtraBold,
                        letterSpacing = 1.2.sp,
                        maxLines = 1,
                        modifier = Modifier.testTag("offer-ooro-brand"),
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        merchant,
                        color = CardMuted,
                        fontSize = if (compact) 9.sp else 10.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.testTag("offer-brand"),
                    )
                    Spacer(Modifier.height(3.dp))
                    Text(
                        headline,
                        color = CardInk,
                        fontSize = if (compact) 13.sp else 15.sp,
                        lineHeight = headlineLineHeight.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = headlineLines,
                        overflow = TextOverflow.Ellipsis,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.widthIn(max = contentMaxWidth).testTag("offer-headline"),
                    )
                    if (showSupportingOffer) {
                        Spacer(Modifier.height(2.dp))
                        Text(
                            supportingOffer.orEmpty(),
                            color = CardMuted,
                            fontSize = if (compact) 9.sp else 10.sp,
                            lineHeight = supportingLineHeight.sp,
                            maxLines = supportingLines,
                            overflow = TextOverflow.Ellipsis,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.widthIn(max = contentMaxWidth).testTag("offer-copy"),
                        )
                    }
                    if (offerValue != null) {
                        Spacer(Modifier.height(3.dp))
                        Text(
                            offerValue,
                            color = OfferGreen,
                            fontSize = if (compact) 11.sp else 12.sp,
                            fontWeight = FontWeight.ExtraBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.testTag("offer-value"),
                        )
                    }
                    Spacer(Modifier.height(6.dp))
                    when {
                        qrImage != null -> Image(
                            bitmap = qrImage,
                            contentDescription = "Brand offer QR code",
                            modifier = Modifier
                                .size(qrSize)
                                .background(Color.White, RoundedCornerShape(5.dp))
                                .padding(quietPadding)
                                .testTag("offer-qr"),
                            contentScale = ContentScale.Fit,
                            filterQuality = androidx.compose.ui.graphics.FilterQuality.None,
                        )
                        destination != null && !qrCanFit -> Text(
                            "Use split 50/25/25 for QR",
                            color = CardInk,
                            fontSize = if (compact) 10.sp else 12.sp,
                            fontWeight = FontWeight.Bold,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.size(qrSize).semantics { contentDescription = "QR unsupported at this panel size" }.testTag("offer-qr-unsupported"),
                        )
                        destination != null -> Text(
                            "QR unavailable",
                            color = CardInk,
                            fontSize = 10.sp,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.size(qrSize).testTag("offer-qr-error"),
                        )
                        else -> Text(
                            "Offer link unavailable",
                            color = CardInk,
                            fontSize = 10.sp,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.testTag("offer-qr-error"),
                        )
                    }
                    Spacer(Modifier.height(5.dp))
                    if (qrImage != null) {
                        Surface(
                            color = OfferGreen,
                            contentColor = Color.White,
                            shape = CircleShape,
                            modifier = Modifier.widthIn(max = contentMaxWidth).testTag("offer-cta-pill"),
                        ) {
                            Text(
                                cta,
                                color = Color.White,
                                fontSize = if (compact) 9.sp else 10.sp,
                                lineHeight = ctaLineHeight.sp,
                                fontWeight = FontWeight.ExtraBold,
                                letterSpacing = 0.25.sp,
                                textAlign = TextAlign.Center,
                                maxLines = if (compact) 1 else 2,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = if (compact) 4.dp else 6.dp).testTag("offer-cta"),
                            )
                        }
                    }
                    Spacer(Modifier.height(3.dp))
                    Text(
                        if (qrImage != null) "Open camera • Scan • Explore" else "Ask staff about this offer",
                        color = CardMuted,
                        fontSize = if (compact) 8.sp else 9.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.testTag("offer-support"),
                    )
                    }
                }
            }
        }
    }
}
