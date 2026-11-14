import assert from 'node:assert/strict'
import test from 'node:test'
import { assertApprovedScreenPlayerRelease, assertApkMetadataCompatibility, assertSigningCertificateContinuity, decodeApkBase64, inspectApk } from './apk-release.js'

const hasCode = (code: string) => (error: unknown): boolean => error !== null && typeof error === 'object' && 'code' in error && error.code === code

test('APK inspection rejects an empty upload before invoking external tooling', async () => {
  await assert.rejects(inspectApk(Buffer.alloc(0)), hasCode('APK_SIZE_INVALID'))
})

test('APK inspection rejects non-ZIP content', async () => {
  await assert.rejects(inspectApk(Buffer.from('this is not an apk')), hasCode('INVALID_APK'))
})

test('APK inspection reports unavailable metadata tooling for a ZIP-shaped invalid APK', async () => {
  await assert.rejects(inspectApk(Buffer.from('PK\x03\x04not-a-real-apk')), hasCode('APK_METADATA_UNAVAILABLE'))
})

test('APK release lineage rejects signing certificate changes', () => {
  assert.doesNotThrow(() => assertSigningCertificateContinuity('ab'.repeat(32), 'AB'.repeat(32)))
  assert.throws(() => assertSigningCertificateContinuity('ab'.repeat(32), 'cd'.repeat(32)), hasCode('APK_SIGNING_CERTIFICATE_CHANGED'))
  assert.doesNotThrow(() => assertSigningCertificateContinuity(undefined, 'cd'.repeat(32)))
})

test('APK metadata rejects non-positive versions and inconsistent SDK levels', () => {
  assert.throws(() => assertApkMetadataCompatibility({ versionCode: 0n, minSdk: 26, targetSdk: 35 }), hasCode('INVALID_APK_METADATA'))
  assert.throws(() => assertApkMetadataCompatibility({ versionCode: 1n, minSdk: 35, targetSdk: 34 }), hasCode('INVALID_APK_METADATA'))
  assert.doesNotThrow(() => assertApkMetadataCompatibility({ versionCode: 1n, minSdk: 26, targetSdk: 35 }))
})

test('fleet release validation requires approved signed OORO package, HTTPS URL, version and device compatibility', () => {
  const release = { packageName: 'com.ooro.screenplayer', approvalStatus: 'APPROVED', versionCode: 42n, versionName: '4.2.0', downloadUrl: 'https://api-staging.theooro.com/private/release.apk?sig=short-lived', sha256: 'ab'.repeat(32), signingIdentity: 'cd'.repeat(32), minSdk: 29, deviceSdk: 35 }
  assert.doesNotThrow(() => assertApprovedScreenPlayerRelease(release))
  assert.throws(() => assertApprovedScreenPlayerRelease({ ...release, packageName: 'com.example.other' }), hasCode('RELEASE_PACKAGE_MISMATCH'))
  assert.throws(() => assertApprovedScreenPlayerRelease({ ...release, approvalStatus: 'DRAFT' }), hasCode('RELEASE_NOT_APPROVED'))
  assert.throws(() => assertApprovedScreenPlayerRelease({ ...release, downloadUrl: 'http://download.example/release.apk' }), hasCode('INVALID_RELEASE_URL'))
  assert.throws(() => assertApprovedScreenPlayerRelease({ ...release, sha256: 'not-a-sha' }), hasCode('INVALID_RELEASE_METADATA'))
  assert.throws(() => assertApprovedScreenPlayerRelease({ ...release, minSdk: 36 }), hasCode('RELEASE_DEVICE_INCOMPATIBLE'))
  assert.throws(() => assertApprovedScreenPlayerRelease({ ...release, versionCode: 0n }), hasCode('INVALID_RELEASE_METADATA'))
})

test('APK base64 decoding rejects malformed input instead of silently truncating it', () => {
  assert.deepEqual(decodeApkBase64(Buffer.from('PK').toString('base64')), Buffer.from('PK'))
  assert.throws(() => decodeApkBase64('not-base64!'), hasCode('APK_ENCODING_INVALID'))
  assert.throws(() => decodeApkBase64('AAAA==='), hasCode('APK_ENCODING_INVALID'))
})
