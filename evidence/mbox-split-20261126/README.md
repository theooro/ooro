# MBOX split renderer acceptance

Tested on the USB MBOX, Android 10, native 1280×720, density 213 dpi. Base: `e281bb7` (current main including PR #124). APK: versionCode **4**, versionName **0.2.2-staging.split**, real staging API `https://api-staging.theooro.com`, mocks disabled.

## Cause and change

`ManifestCodec` accepts a string layout or `layout.type`, normalizes its name and resolves `DisplayLayout`. `Player` handles `SPLIT_50_25_25` independently of four-zone geometry overrides. Its Compose Row uses weights 2:1:1, resulting in 640×720 main, 320×720 navigation and 320×720 offer regions.

The offer column incorrectly used the legacy horizontal text/QR strip, leaving about half of an already narrow column for each. It now uses the vertical offer card. The card budgets the maximum brand, offer and CTA line heights, including font scaling, before allocating a square QR inside its actual bounds. Compact panels use smaller type and fewer offer lines. Long text ends with ellipses rather than escaping the card. The QR retains the encoder's four-module quiet zone plus white outer padding, uses a bitmap sized to its inner bounds, and avoids filtered resampling. Bitmap generation remains capped at 512px and fails closed below 64px.

Main creative FIT behavior and the outer split proportions are unchanged. Explicit CENTER_CROP remains an opt-in manifest policy; no new cropping or stretching was introduced.

## Orientation evidence

Both the existing MainActivity and debug render activity request landscape. `dumpsys display` reports the built-in display as 1280×720, hardware rotation 0, `mCurrentOrientation=0`, and logical rotation 0. `user_rotation=0`. Digital before/after screenshots are upright; the fixture labels and all four creative edges are visible. No orientation setting, panel rotation or global transform was changed. Media EXIF/video rotation handling remains scoped to the creative's own metadata.

The referenced original photos were not available in this conversation, so their capture orientation and the physical mounting cannot be independently determined. The observed Android compositor is not rotating the composition sideways on this MBOX.

## Verified results

- `testDebugUnitTest assembleDebug assembleDebugAndroidTest`: passed, Java 17, staging URL, `useMockBackend=false`.
- Unit tests: 193 total, **192 passed, 1 skipped**, no failures/errors. Added string/object/round-trip split-manifest coverage.
- Physical MBOX `SplitLayoutRendererTest`: **2 tests passed**, covering seven screenshot cases.
- Tests assert display rotation 0, 1280×720 root, exact split panel bounds, existing four-zone/fullscreen bounds, text line boxes and limits, non-overlapping contained content, square QR bounds, quiet-zone pixels, and decoding the displayed QR to the exact synthetic destination.
- A cyan frame in the 16:9 creative verifies containment on all four edges, catching cropping, stretching and sideways media. Split landscape media occupies 640×360 centered inside the 640×720 main region.
- Observed QR cards are about 293×293px in split and 209×209px in four-zone, including their white border. All synthetic QR cases decode.
- Installed and candidate APK signer digests match: `b280092ff7c8fe377336ec371f68efc3f66af37ad65daf83f9cdaf0ef0ab5e33` (established Android debug signer). `adb install -r` returned `Success`.
- Credential preferences remain byte-identical; screen/device identity and creative-cache file hashes are unchanged. Room schema remains 6 and the accepted manifest still has two items. No pairing operation, manual database edit, migration, clear-data or uninstall was performed. Normal background proof delivery continued: diagnostics report acknowledged uploads before local removal, with unacknowledged rows retained.

All screenshots use local synthetic content through the production renderer, with preview proof recording and manifest fetching disabled. Navigation is deliberately inactive in this fixture; live route/map-tile delivery is not certified here. Custom Layout Studio publication remains blocked by `CAPABILITY_PROFILE_UNVERIFIED`; these preset tests do not certify Custom layouts. Nothing was merged or deployed to production.

## Reproduce the physical renderer check

```sh
cd apps/screen-android
JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 \
ANDROID_HOME=/home/varneeth/Android/Sdk \
./gradlew -PdeviceApiBaseUrl=https://api-staging.theooro.com \
  -PuseMockBackend=false testDebugUnitTest assembleDebug assembleDebugAndroidTest

# Verify installed/candidate signers before any update; never uninstall or clear data.
adb -s 6c001040f441c941d94 install -r app/build/outputs/apk/debug/app-debug.apk
adb -s 6c001040f441c941d94 install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s 6c001040f441c941d94 shell am instrument -w \
  -e class com.ooro.screenplayer.SplitLayoutRendererTest \
  com.ooro.screenplayer.test/androidx.test.runner.AndroidJUnitRunner
adb -s 6c001040f441c941d94 shell am start -n com.ooro.screenplayer/.MainActivity
```

## Synthetic screenshots

Before: [legacy split](before-SPLIT_50_25_25.png).

After: [split, long offer](SPLIT_50_25_25-OFFER_LONG_TITLE.png), [long brand](SPLIT_50_25_25-OFFER_LONG_BRAND.png), [long CTA](SPLIT_50_25_25-OFFER_LONG_CTA.png), [brand only](SPLIT_50_25_25-OFFER_BRAND_ONLY.png), [standard](SPLIT_50_25_25-OFFER_BRAND.png).

Regression captures: [four-zone](FOUR_ZONE-OFFER_LONG_TITLE.png), [full-screen](FULLSCREEN_AD-OFFER_BRAND.png).
