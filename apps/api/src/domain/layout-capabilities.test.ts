import test from 'node:test'
import assert from 'node:assert/strict'
import { MBOX_PROFILE_ID, mboxProfile, certificationChecks, layoutCapabilityIssues, widgetCertified } from './layout-studio.js'
import { layoutDraftSchema, standardV3Draft, validateLayoutDraft, type LayoutDraft } from './layout-studio.js'
import { deliverableLayoutContract } from './layout-manifest.js'

export function candidateDraft(): LayoutDraft {
  return { ...standardV3Draft(), mode: 'CUSTOM', preset: 'CUSTOM_CANVAS', profileId: MBOX_PROFILE_ID, capabilityProfileVersion: 1, screenType: 'AUTO_SCREEN', zones: [{
    id: 'image', type: 'IMAGE', label: 'Approved image', schemaVersion: 1, geometry: { x: 0, y: 0, width: 1, height: 1 }, zIndex: 0, fit: 'FIT', visible: true,
    contentBinding: { kind: 'APPROVED_CREATIVE', referenceId: '22222222-2222-4222-8222-222222222222' },
  }] }
}

test('MBOX profile round-trips its exact type/resolution/version without claiming certification', () => {
  const draft = candidateDraft()
  assert.deepEqual(layoutDraftSchema.parse(JSON.parse(JSON.stringify(draft))), draft)
  assert.equal(mboxProfile.hardware.apiLevel, 29)
  assert.equal(mboxProfile.hardware.abi, 'armeabi-v7a')
  assert.ok(layoutCapabilityIssues(draft).some(issue => issue.code === 'WIDGET_CERTIFICATION_REQUIRED'))
  assert.ok(layoutCapabilityIssues(draft).some(issue => issue.code === 'PROFILE_RESOURCE_BUDGET_UNVERIFIED'))
  assert.equal(layoutDraftSchema.safeParse({ ...draft, certification: { approved: true } }).success, false)
})

test('every acceptance category and evidence are required; a renderer alone never certifies a widget', () => {
  const passed = { provider: 'test-only provider', reason: '', checks: { renderer: true, resources: true, offlineFallback: true, playback: true, proofIsolation: true }, evidence: ['test-only evidence'] }
  assert.equal(widgetCertified(passed), true)
  for (const check of certificationChecks) assert.equal(widgetCertified({ ...passed, checks: { ...passed.checks, [check]: false } }), false)
  assert.equal(widgetCertified({ ...passed, evidence: [] }), false)
  assert.equal(widgetCertified({ ...passed, provider: null }), false)
  assert.equal(widgetCertified(mboxProfile.widgets.IMAGE), false)
})

test('profile revision, screen type, resource envelope and missing providers remain blocked', () => {
  const unsupportedSchema = candidateDraft(); const zone = unsupportedSchema.zones[0]!
  assert.ok(validateLayoutDraft({ ...unsupportedSchema, zones: [{ ...zone, schemaVersion: 2 }] }).issues.some(issue => issue.code === 'SCHEMA_INVALID'))
  assert.ok(validateLayoutDraft({ ...unsupportedSchema, zones: [{ ...zone, geometry: { ...zone.geometry, width: 1.0000001 } }] }).issues.some(issue => issue.code === 'ZONE_OUT_OF_BOUNDS'))
  assert.ok(validateLayoutDraft({ ...candidateDraft(), capabilityProfileVersion: 2 }).issues.some(issue => issue.code === 'PROFILE_VERSION_MISMATCH'))
  assert.ok(validateLayoutDraft({ ...candidateDraft(), screenType: 'RETAIL_EVENT' }).issues.some(issue => issue.code === 'PROFILE_TARGET_MISMATCH'))
  assert.ok(validateLayoutDraft({ ...candidateDraft(), target: { width: 720, height: 1280 } }).issues.some(issue => issue.code === 'PROFILE_TARGET_MISMATCH'))
  for (const type of ['CLOCK', 'WEATHER', 'TICKER', 'NAVIGATION_MAP'] as const) {
    const draft = candidateDraft(); draft.zones[0]!.type = type; draft.zones[0]!.contentBinding = { kind: 'NONE' }
    assert.ok(validateLayoutDraft(draft).issues.some(issue => issue.code === 'WIDGET_PROVIDER_UNAVAILABLE'))
  }
})

test('manually published or previously published uncertified Custom contracts never enter manifests', () => {
  const draft = candidateDraft()
  assert.equal(deliverableLayoutContract(draft), null)
  assert.equal(deliverableLayoutContract({ ...draft, profileId: 'OORO_PREMIUM' }), null)
  assert.equal(deliverableLayoutContract({ ...draft, zones: [] }), null)
  assert.equal(deliverableLayoutContract({}), null)
})
