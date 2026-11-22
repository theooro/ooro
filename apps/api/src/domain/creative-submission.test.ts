import test from 'node:test'
import assert from 'node:assert/strict'
import { creativeSubmissionPermission, pendingCreativeSubmissionState } from './creative-submission.js'
import { creativeSubmissionSchedulingPermission } from './creative-submission-scheduling.js'

test('verified Brand accounts may submit creative files for review', () => {
  assert.equal(creativeSubmissionPermission({ accountType: 'BRAND', organizationType: 'BRAND', verificationStatus: 'VERIFIED' }).allowed, true)
})

test('approved and active Agencies may submit, while unapproved Agencies are denied', () => {
  const base = { accountType: 'AGENCY', organizationType: 'AGENCY', verificationStatus: 'VERIFIED' }
  assert.equal(creativeSubmissionPermission({ ...base, agencyApplicationStatus: 'APPROVED' }).allowed, true)
  assert.equal(creativeSubmissionPermission({ ...base, agencyApplicationStatus: 'ACTIVE' }).allowed, true)
  assert.equal(creativeSubmissionPermission({ ...base, agencyApplicationStatus: 'APPLICATION_RECEIVED' }).code, 'AGENCY_APPROVAL_REQUIRED')
})

test('unverified Brands, mismatched organizations, and unrelated account types cannot upload', () => {
  assert.equal(creativeSubmissionPermission({ accountType: 'BRAND', organizationType: 'BRAND', verificationStatus: 'PENDING_REVIEW' }).code, 'BRAND_VERIFICATION_REQUIRED')
  assert.equal(creativeSubmissionPermission({ accountType: 'BRAND', organizationType: 'AGENCY', verificationStatus: 'VERIFIED' }).allowed, false)
  assert.equal(creativeSubmissionPermission({ accountType: 'BUSINESS', organizationType: 'BRAND', verificationStatus: 'VERIFIED' }).code, 'CREATIVE_UPLOAD_FORBIDDEN')
})

test('a submitted creative remains pending and has no scheduling or playback authorization', () => {
  assert.deepEqual(pendingCreativeSubmissionState(), { status: 'PENDING_REVIEW', scheduled: false, playbackEligible: false })
})

test('only an approved, unlinked submission is eligible for explicit admin scheduling', () => {
  assert.equal(creativeSubmissionSchedulingPermission('APPROVED', null).allowed, true)
  assert.equal(creativeSubmissionSchedulingPermission('PENDING_REVIEW', null).code, 'CREATIVE_SUBMISSION_NOT_APPROVED')
  assert.equal(creativeSubmissionSchedulingPermission('REJECTED', null).allowed, false)
  assert.equal(creativeSubmissionSchedulingPermission('ARCHIVED', null).code, 'CREATIVE_SUBMISSION_ARCHIVED')
  assert.equal(creativeSubmissionSchedulingPermission('APPROVED', 'creative-id').code, 'CREATIVE_SUBMISSION_ALREADY_SCHEDULED')
})
