export type CreativeSubmissionIdentity = {
  accountType?: string | null
  organizationType?: string | null
  verificationStatus?: string | null
  agencyApplicationStatus?: string | null
}

export type CreativeSubmissionPermission = {
  allowed: boolean
  code: string
  message: string
}

export function creativeSubmissionPermission(identity: CreativeSubmissionIdentity): CreativeSubmissionPermission {
  if (identity.accountType === 'BRAND') {
    if (identity.organizationType === 'BRAND' && identity.verificationStatus === 'VERIFIED') {
      return { allowed: true, code: 'CREATIVE_UPLOAD_ALLOWED', message: 'Submit creative files for review.' }
    }
    return { allowed: false, code: 'BRAND_VERIFICATION_REQUIRED', message: 'Brand verification must be approved before submitting creative files.' }
  }
  if (identity.accountType === 'AGENCY') {
    if (identity.organizationType === 'AGENCY' && identity.verificationStatus === 'VERIFIED' && ['APPROVED', 'ACTIVE'].includes(identity.agencyApplicationStatus ?? '')) {
      return { allowed: true, code: 'CREATIVE_UPLOAD_ALLOWED', message: 'Submit creative files for review.' }
    }
    return { allowed: false, code: 'AGENCY_APPROVAL_REQUIRED', message: 'Agency verification and application approval are required before submitting creative files.' }
  }
  return { allowed: false, code: 'CREATIVE_UPLOAD_FORBIDDEN', message: 'Creative submissions are available only to verified Brands and approved Agencies.' }
}

export function pendingCreativeSubmissionState() {
  return { status: 'PENDING_REVIEW' as const, scheduled: false as const, playbackEligible: false as const }
}
